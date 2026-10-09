import { useSyncExternalStore } from "react";
import { byteLength, scanForSecrets } from "../ai/contextItems";
import { subscribeTerminalCommandRuns, type ObservedCommandRun } from "../ai/terminalContext";
import type { WorkflowTarget } from "./execution";
import type { Workflow } from "./store";

export type WorkflowRunPhase = "submitting" | "running" | "succeeded" | "failed" | "unavailable";
export type WorkflowRunKind = "workflow" | "script";
export function workflowRunKey(id: string, kind: WorkflowRunKind = "workflow"): string { return `${kind}:${id}`; }
export type WorkflowRunStatus = Readonly<{
  workflowId: string;
  kind: WorkflowRunKind;
  runId: string;
  phase: WorkflowRunPhase;
  submittedAt: number;
  completedAt?: number;
  terminal: Readonly<{ leafId: number; ptyId: number; cwd: string; host: string | null }>;
  exitCode?: number;
  output?: string;
  outputTruncated: boolean;
  outputUnavailableReason?: string;
}>;

export const WORKFLOW_RUN_RESULT_TIMEOUT_MS = 120_000;
export const WORKFLOW_RUN_MAX_OUTPUT_BYTES = 8 * 1024;
export const WORKFLOW_RUN_MAX_RECORDS = 100;
const SENSITIVE_OUTPUT = "Output was not retained because the command, inputs, or captured output may contain credentials.";
let snapshot: ReadonlyMap<string, WorkflowRunStatus> = new Map();
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let stopObserving: (() => void) | undefined;

function publish(next: Map<string, WorkflowRunStatus>): void {
  snapshot = next;
  for (const listener of listeners) listener();
}
function update(entry: WorkflowRunStatus): void {
  const next = new Map(snapshot);
  next.set(workflowRunKey(entry.workflowId, entry.kind), Object.freeze(entry));
  publish(next);
}
function clearTimer(runId: string): void {
  const timer = timers.get(runId);
  if (timer !== undefined) clearTimeout(timer);
  timers.delete(runId);
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useWorkflowRunStatuses(): ReadonlyMap<string, WorkflowRunStatus> {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
export function getWorkflowRunStatus(workflowId: string, kind: WorkflowRunKind = "workflow"): WorkflowRunStatus | undefined {
  return snapshot.get(workflowRunKey(workflowId, kind));
}

/** Results are deliberately session-only: no localStorage, native persistence,
 * provider calls, raw commands, or runtime input values are stored here. */
export function beginWorkflowRun(wf: Workflow, values: Record<string, string>, target: WorkflowTarget, command: string, runId: string, kind: WorkflowRunKind = "workflow"): void {
  if (target.scope.ptyId === null) return;
  stopObserving ??= subscribeTerminalCommandRuns(observeWorkflowRun);
  const key = workflowRunKey(wf.id, kind);
  const previous = snapshot.get(key);
  if (previous) clearTimer(previous.runId);
  const sensitive = wf.inputs?.some(input => input.type === "secret")
    || scanForSecrets("workflow command", command).length > 0
    || Object.entries(values).some(([name, value]) => scanForSecrets("workflow input", `${name}=${value}`).length > 0);
  const entry: WorkflowRunStatus = Object.freeze({
    workflowId: wf.id, kind, runId, phase: "submitting", submittedAt: Date.now(),
    terminal: Object.freeze({ leafId: target.leafId, ptyId: target.scope.ptyId, cwd: target.scope.cwd, host: target.scope.host }),
    outputTruncated: false,
    ...(sensitive ? { outputUnavailableReason: SENSITIVE_OUTPUT } : {}),
  });
  const next = new Map(snapshot);
  next.delete(key);
  next.set(key, entry);
  while (next.size > WORKFLOW_RUN_MAX_RECORDS) {
    const oldest = next.keys().next().value!;
    clearTimer(next.get(oldest)!.runId);
    next.delete(oldest);
  }
  publish(next);
  timers.set(runId, setTimeout(() => {
    timers.delete(runId);
    const current = snapshot.get(key);
    if (current?.runId !== runId || (current.phase !== "submitting" && current.phase !== "running")) return;
    update({ ...current, phase: "unavailable", outputUnavailableReason: current.outputUnavailableReason
      ?? "No confirmed completion was observed. The command may still be running; check its original terminal." });
  }, WORKFLOW_RUN_RESULT_TIMEOUT_MS));
}

/** 'running' means waiting for shell evidence, never inferred success. The UI
 * labels it 'Awaiting result' because IPC acknowledgement is not preexec. */
export function markWorkflowRunSubmitted(workflowId: string, runId: string, kind: WorkflowRunKind = "workflow"): void {
  const current = getWorkflowRunStatus(workflowId, kind);
  if (current?.runId === runId && current.phase === "submitting") update({ ...current, phase: "running" });
}
export function markWorkflowRunWriteFailed(workflowId: string, runId: string, kind: WorkflowRunKind = "workflow"): void {
  const current = getWorkflowRunStatus(workflowId, kind);
  if (current?.runId !== runId || current.completedAt !== undefined) return;
  clearTimer(runId);
  update({ ...current, phase: "unavailable", outputUnavailableReason: current.outputUnavailableReason === SENSITIVE_OUTPUT
    ? SENSITIVE_OUTPUT : "Command submission could not be confirmed. Inspect the original terminal before retrying." });
}

function boundedOutput(text: string): { output: string; outputTruncated: boolean } {
  if (byteLength(text) <= WORKFLOW_RUN_MAX_OUTPUT_BYTES) return { output: text, outputTruncated: false };
  let output = "";
  let size = 0;
  for (const character of text) {
    const bytes = byteLength(character);
    if (size + bytes > WORKFLOW_RUN_MAX_OUTPUT_BYTES) break;
    output += character;
    size += bytes;
  }
  return { output, outputTruncated: true };
}

function observeWorkflowRun(run: ObservedCommandRun): void {
  if (!run.runId || run.startedAt === undefined) return;
  const current = [...snapshot.values()].find(entry => entry.runId === run.runId);
  if (!current || current.completedAt !== undefined || run.terminalPtyId !== current.terminal.ptyId
    || run.cwd !== current.terminal.cwd || run.startedAt < current.submittedAt || run.at < run.startedAt) return;
  clearTimer(run.runId);
  const knownExit = run.exitCode !== null && Number.isInteger(run.exitCode) && run.exitCode >= 0;
  // Scan the complete observed capture BEFORE taking a bounded excerpt. Secret
  // detection is conservative, not a guarantee that arbitrary output is safe.
  const sensitive = current.outputUnavailableReason === SENSITIVE_OUTPUT
    || scanForSecrets("workflow command", run.command).length > 0
    || scanForSecrets("workflow output", run.output).length > 0;
  update({
    ...current, completedAt: run.at,
    phase: !knownExit ? "unavailable" : run.exitCode === 0 ? "succeeded" : "failed",
    ...(knownExit ? { exitCode: run.exitCode! } : {}),
    ...(sensitive ? { outputUnavailableReason: SENSITIVE_OUTPUT, output: undefined, outputTruncated: false }
      : { ...boundedOutput(run.output), outputUnavailableReason: knownExit ? undefined : "The shell did not report an exit status. The captured output is not proof of success or failure." }),
  });
}

export function clearWorkflowRunStatus(workflowId: string, kind: WorkflowRunKind = "workflow"): void {
  const key = workflowRunKey(workflowId, kind);
  const previous = snapshot.get(key);
  if (!previous) return;
  clearTimer(previous.runId);
  const next = new Map(snapshot);
  next.delete(key);
  publish(next);
}
export function clearWorkflowRunStatuses(): void {
  for (const runId of timers.keys()) clearTimer(runId);
  stopObserving?.();
  stopObserving = undefined;
  publish(new Map());
}
