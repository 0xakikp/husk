import { useSyncExternalStore } from "react";

import { scanForSecrets } from "../ai/contextItems";
import { getPrefs } from "../settings/preferences";
import { queryTimeline, type TimelineEvent } from "../timeline/store";
import { getWorkspaceRoot } from "../workspace/store";
import { loadWorkflows, type Workflow } from "./store";

const MIN_SEQUENCE_LENGTH = 2;
const MAX_SEQUENCE_LENGTH = 6;
const MIN_OCCURRENCES = 3;
const MIN_SESSIONS = 2;
const MAX_GAP_SECONDS = 30 * 60;

export type RecordedWorkflowCommand = {
  id: number;
  ts: number;
  command: string;
  cwd: string;
  terminalSessionId: string;
  failed: boolean;
};

type WorkflowSuggestionBase = {
  id: string;
  fingerprint: string;
  workspaceRoot: string;
  cwd: string;
  steps: string[];
  occurrences: number;
  sessionCount: number;
  lastSeen: number;
};

export type NewWorkflowSuggestion = WorkflowSuggestionBase & {
  kind: "new";
};

export type WorkflowEvolutionSuggestion = WorkflowSuggestionBase & {
  kind: "evolution";
  targetWorkflowId: string;
  targetWorkflowName: string;
  targetWorkflowDescription?: string;
  targetStopOnError: boolean;
  originalSteps: string[];
};

export type WorkflowSuggestion = NewWorkflowSuggestion | WorkflowEvolutionSuggestion;

/** Navigation, inspection, and shell housekeeping do not describe a routine. */
export function isMeaningfulWorkflowCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length < 3 || normalized.length > 480) return false;
  return !/^(?:cd|ls|ll|la|pwd|clear|history|which|type|echo|cat|head|tail|date|whoami)(?:\s|$)/i.test(normalized);
}

/** Destructive and interactive commands may still be added manually, but Husk
 * never promotes them from background observation into an automatic offer. */
export function isSafeWorkflowSuggestionCommand(command: string): boolean {
  const value = command.trim();
  if (!isMeaningfulWorkflowCommand(value)) return false;
  if (scanForSecrets("terminal command", value).length > 0) return false;
  if (/\n|\r|\0/.test(value)) return false;
  return !/(?:^|\s)(?:sudo|su|ssh|mosh|rm|rmdir|dd|mkfs|shutdown|reboot|halt|poweroff)(?:\s|$)|\bgit\s+(?:reset\s+--hard|push\b[^\n]*\s--force)|\bkubectl\s+delete\b|\bterraform\s+(?:apply|destroy)\b|\bdocker\s+(?:system\s+prune|rm\b)|\b(?:drop|truncate)\s+(?:database|table)\b/i.test(value);
}

/** Timeline commands are kept structured. Older summary-only rows are ignored
 * rather than parsed back from display text, which avoids treating prose as a
 * command and keeps the migration boundary explicit. */
export function timelineCommand(event: TimelineEvent): RecordedWorkflowCommand | null {
  if (event.event_type !== "command" && event.event_type !== "command_failed") return null;
  try {
    const metadata = JSON.parse(event.metadata_json || "{}") as Record<string, unknown>;
    if (typeof metadata.command !== "string" || !metadata.command.trim()) return null;
    if (metadata.redacted === true || metadata.sensitive === true) return null;
    return {
      id: event.id,
      ts: event.ts,
      command: metadata.command.trim().replace(/\s+/g, " "),
      cwd: typeof metadata.cwd === "string" ? metadata.cwd : "",
      terminalSessionId: typeof metadata.terminalSessionId === "string" ? metadata.terminalSessionId : "",
      failed: event.event_type === "command_failed" || (typeof metadata.exitCode === "number" && metadata.exitCode !== 0),
    };
  } catch {
    return null;
  }
}

function hash(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function workflowFingerprint(steps: string[]): string {
  return hash(steps.map((step) => step.trim().replace(/\s+/g, " ")).join("\u001f"));
}

function validWindow(rows: RecordedWorkflowCommand[], start: number, length: number): boolean {
  const window = rows.slice(start, start + length);
  if (window.length !== length || window.some((row) => row.failed || !isSafeWorkflowSuggestionCommand(row.command))) return false;
  const session = window[0].terminalSessionId;
  if (!session || window.some((row) => row.terminalSessionId !== session)) return false;
  for (let i = 1; i < window.length; i += 1) {
    if (window[i].ts - window[i - 1].ts > MAX_GAP_SECONDS) return false;
  }
  return true;
}

/** Find the longest exact command routine ending at the newest successful run.
 * Exact matching is deliberately conservative for v1. Parameter inference can
 * later widen candidates, but should not make the first release noisy. */
export function detectWorkflowSuggestion(
  eventsNewestFirst: TimelineEvent[],
  workspaceRoot: string,
): NewWorkflowSuggestion | null {
  const rows = eventsNewestFirst
    .map(timelineCommand)
    .filter((row): row is RecordedWorkflowCommand => row !== null)
    /* Successful housekeeping is transparent. A failure or a meaningful risky
       command stays in the sequence as a barrier and cannot be learned. */
    .filter((row) => row.failed || isMeaningfulWorkflowCommand(row.command))
    .sort((a, b) => a.ts - b.ts || a.id - b.id);
  if (rows.length < MIN_SEQUENCE_LENGTH * MIN_OCCURRENCES) return null;

  for (let length = Math.min(MAX_SEQUENCE_LENGTH, rows.length); length >= MIN_SEQUENCE_LENGTH; length -= 1) {
    const currentStart = rows.length - length;
    if (!validWindow(rows, currentStart, length)) continue;
    const current = rows.slice(currentStart);
    const signature = current.map((row) => row.command).join("\u001f");
    const sessions = new Set<string>();
    let occurrences = 0;

    for (let start = 0; start <= rows.length - length;) {
      if (
        validWindow(rows, start, length)
        && rows.slice(start, start + length).map((row) => row.command).join("\u001f") === signature
      ) {
        occurrences += 1;
        sessions.add(rows[start].terminalSessionId);
        start += length; // Do not count overlapping copies of one run.
      } else {
        start += 1;
      }
    }

    if (occurrences >= MIN_OCCURRENCES && sessions.size >= MIN_SESSIONS) {
      const steps = current.map((row) => row.command);
      /* Dismissing a routine in one project must not silence the same useful
         routine everywhere. Saved-workflow duplicate checks remain based on
         the commands alone, while suggestion identity includes its workspace. */
      const fingerprint = hash(`${workspaceRoot}\u001e${workflowFingerprint(steps)}`);
      return {
        kind: "new",
        id: `suggestion:${fingerprint}`,
        fingerprint,
        workspaceRoot,
        cwd: current[0].cwd || workspaceRoot,
        steps,
        occurrences,
        sessionCount: sessions.size,
        lastSeen: current[current.length - 1].ts,
      };
    }
  }
  return null;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match a saved workflow step against its observed form without throwing
 * away a user's reusable {{parameter}} placeholders. Values may be one shell
 * word or one quoted string; the matcher never executes either side. */
function workflowStepMatches(savedStep: string, observedStep: string): boolean {
  const template = normalizeCommand(savedStep);
  const observed = normalizeCommand(observedStep);
  const placeholder = /\{\{\s*[A-Za-z0-9_]+\s*(?:=\s*[^}]*?)?\s*\}\}/g;
  let cursor = 0;
  let pattern = "";
  for (const match of template.matchAll(placeholder)) {
    const index = match.index ?? 0;
    pattern += escapeRegExp(template.slice(cursor, index));
    pattern += '(?:"[^"\\r\\n]*"|\'[^\'\\r\\n]*\'|[^\\s;&|]+)';
    cursor = index + match[0].length;
  }
  pattern += escapeRegExp(template.slice(cursor));
  return new RegExp(`^${pattern}$`).test(observed);
}

function directEvolutionSteps(observed: string[], workflow: Workflow): string[] | null {
  if (observed.length <= workflow.steps.length) return null;
  const matched = new Map<number, string>();
  let savedIndex = 0;
  for (let observedIndex = 0; observedIndex < observed.length && savedIndex < workflow.steps.length; observedIndex += 1) {
    if (workflowStepMatches(workflow.steps[savedIndex], observed[observedIndex])) {
      matched.set(observedIndex, workflow.steps[savedIndex]);
      savedIndex += 1;
    }
  }
  if (savedIndex !== workflow.steps.length) return null;
  return observed.map((step, index) => matched.get(index) ?? step);
}

function compositeEvolutionSteps(observed: string[], workflow: Workflow): string[] | null {
  if (workflow.steps.length < 2) return null;
  for (const separator of [" && ", "; "]) {
    const composite = workflow.steps.join(separator);
    const index = observed.findIndex((step) => workflowStepMatches(composite, step));
    if (index >= 0) {
      return [...observed.slice(0, index), ...workflow.steps, ...observed.slice(index + 1)];
    }
  }
  return null;
}

/** Turn a repeated routine into either a new workflow suggestion, an update to
 * the best matching saved workflow, or no suggestion when the saved workflow
 * already represents it. Evolution is deliberately additive: all original
 * steps must still appear in order (or as the exact chained run command). */
export function classifyWorkflowSuggestion(
  candidate: NewWorkflowSuggestion,
  workflows: Workflow[],
): WorkflowSuggestion | null {
  if (workflows.some((workflow) => (
    workflow.steps.length === candidate.steps.length
    && workflow.steps.every((step, index) => workflowStepMatches(step, candidate.steps[index]))
  ))) return null;

  const matches = workflows.flatMap((workflow) => {
    const steps = directEvolutionSteps(candidate.steps, workflow)
      ?? compositeEvolutionSteps(candidate.steps, workflow);
    if (!steps || steps.length <= workflow.steps.length) return [];
    return [{ workflow, steps }];
  }).sort((a, b) => b.workflow.steps.length - a.workflow.steps.length);

  const best = matches[0];
  if (!best) return candidate;
  const fingerprint = hash(`${candidate.fingerprint}\u001eupdate:${best.workflow.id}`);
  return {
    ...candidate,
    kind: "evolution",
    id: `evolution:${best.workflow.id}:${fingerprint}`,
    fingerprint,
    steps: best.steps,
    targetWorkflowId: best.workflow.id,
    targetWorkflowName: best.workflow.name,
    targetWorkflowDescription: best.workflow.description,
    targetStopOnError: best.workflow.stopOnError !== false,
    originalSteps: best.workflow.steps,
  };
}

const suggestions = new Map<number, WorkflowSuggestion>();
const subscribers = new Set<() => void>();
let suggestionSnapshot: WorkflowSuggestion[] = [];
const EMPTY_SUGGESTIONS: WorkflowSuggestion[] = [];

function emit() {
  suggestionSnapshot = [...suggestions.values()].sort((a, b) => b.lastSeen - a.lastSeen);
  for (const subscriber of subscribers) subscriber();
}

export function getWorkflowSuggestion(leafId: number | null): WorkflowSuggestion | null {
  return leafId == null ? null : suggestions.get(leafId) ?? null;
}

export function getWorkflowSuggestions(): WorkflowSuggestion[] {
  return suggestionSnapshot;
}

export function subscribeWorkflowSuggestions(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function useWorkflowSuggestion(leafId: number | null): WorkflowSuggestion | null {
  return useSyncExternalStore(
    subscribeWorkflowSuggestions,
    () => getWorkflowSuggestion(leafId),
    () => null,
  );
}

export function useWorkflowSuggestions(): WorkflowSuggestion[] {
  return useSyncExternalStore(
    subscribeWorkflowSuggestions,
    getWorkflowSuggestions,
    () => EMPTY_SUGGESTIONS,
  );
}

export function dismissWorkflowSuggestion(leafId: number, forever = false): void {
  const suggestion = suggestions.get(leafId);
  if (forever && suggestion) {
    const prefs = getPrefs();
    const next = [...new Set([...(prefs.workflowSuggestionDismissals ?? []), suggestion.fingerprint])].slice(-100);
    import("../settings/preferences").then(({ setPrefs }) => setPrefs({ workflowSuggestionDismissals: next }));
  }
  if (suggestions.delete(leafId)) emit();
}

export function dismissWorkflowSuggestionFingerprint(fingerprint: string, forever = false): void {
  let changed = false;
  for (const [leafId, suggestion] of suggestions) {
    if (suggestion.fingerprint === fingerprint) changed = suggestions.delete(leafId) || changed;
  }
  if (forever) {
    const prefs = getPrefs();
    const next = [...new Set([...(prefs.workflowSuggestionDismissals ?? []), fingerprint])].slice(-100);
    import("../settings/preferences").then(({ setPrefs }) => setPrefs({ workflowSuggestionDismissals: next }));
  }
  if (changed) emit();
}

export function clearWorkflowSuggestions(): void {
  if (!suggestions.size) return;
  suggestions.clear();
  emit();
}

export function clearWorkflowSuggestionsForWorkspace(workspaceRoot: string): void {
  let changed = false;
  for (const [leafId, suggestion] of suggestions) {
    if (suggestion.workspaceRoot === workspaceRoot) changed = suggestions.delete(leafId) || changed;
  }
  if (changed) emit();
}

/** Re-evaluate after a successful command has been committed to Timeline. */
export async function refreshWorkflowSuggestion(leafId: number, workspaceRoot = getWorkspaceRoot()): Promise<void> {
  const prefs = getPrefs();
  if (!workspaceRoot || !prefs.workflowSuggestionsEnabled) return;
  const events = await queryTimeline(["command", "command_failed"], 30, 240, workspaceRoot);
  const candidate = detectWorkflowSuggestion(events, workspaceRoot);
  const suggestion = candidate ? classifyWorkflowSuggestion(candidate, loadWorkflows()) : null;
  if (
    !suggestion
    || prefs.workflowSuggestionDismissals.includes(suggestion.fingerprint)
  ) {
    if (suggestions.delete(leafId)) emit();
    return;
  }
  const previous = suggestions.get(leafId);
  if (previous?.fingerprint === suggestion.fingerprint && previous.occurrences === suggestion.occurrences) return;
  suggestions.set(leafId, suggestion);
  emit();
}

export async function recentWorkflowSteps(root = getWorkspaceRoot(), limit = 4): Promise<string[]> {
  if (!root) return [];
  const events = await queryTimeline(["command", "command_failed"], 7, 80, root);
  return events
    .map(timelineCommand)
    .filter((row): row is RecordedWorkflowCommand => row !== null && !row.failed && isSafeWorkflowSuggestionCommand(row.command))
    .slice(0, Math.max(2, limit))
    .reverse()
    .map((row) => row.command);
}
