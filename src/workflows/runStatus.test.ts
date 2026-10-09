import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { publishTerminalCommandRun, type ObservedCommandRun } from "../ai/terminalContext";
import {
  beginWorkflowRun, clearWorkflowRunStatus, clearWorkflowRunStatuses, getWorkflowRunStatus,
  markWorkflowRunSubmitted, markWorkflowRunWriteFailed, WORKFLOW_RUN_MAX_OUTPUT_BYTES,
  WORKFLOW_RUN_MAX_RECORDS, WORKFLOW_RUN_RESULT_TIMEOUT_MS,
} from "./runStatus";
import type { Workflow } from "./store";

const wf: Workflow = { id: "wf_1", name: "Check", steps: ["git status"] };
const target = { leafId: 1, scope: { ptyId: 7, cwd: "/project", host: null, isRemote: false, scopeToken: "shell:7" } };
function start(workflow = wf, runId = "run:1", values: Record<string, string> = {}, command = "git status") {
  beginWorkflowRun(workflow, values, target, command, runId);
}
function complete(patch: Partial<ObservedCommandRun> = {}) {
  publishTerminalCommandRun({ runId: "run:1", command: "git status", terminalPtyId: 7, cwd: "/project", output: "clean", exitCode: 0, startedAt: Date.now(), at: Date.now() + 1, ...patch });
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_000); clearWorkflowRunStatuses(); });
afterEach(() => { clearWorkflowRunStatuses(); vi.useRealTimers(); });

it("waits for an exact receipt completion, not write acknowledgement", () => {
  start();
  expect(getWorkflowRunStatus(wf.id)?.phase).toBe("submitting");
  markWorkflowRunSubmitted(wf.id, "run:1");
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "running", outputTruncated: false });
  expect(getWorkflowRunStatus(wf.id)?.exitCode).toBeUndefined();
  complete();
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "succeeded", exitCode: 0, output: "clean", terminal: { ptyId: 7, cwd: "/project" } });
});

it.each([
  { runId: undefined }, { runId: "unrelated" }, { terminalPtyId: 8 }, { cwd: "/other" },
  { startedAt: undefined }, { startedAt: 999 }, { startedAt: 1_100, at: 1_000 },
])("ignores unverified, stale or other-terminal completion %j", patch => {
  start();
  complete(patch);
  expect(getWorkflowRunStatus(wf.id)?.phase).toBe("submitting");
});

it("records actual nonzero exit codes and preserves the first observed result", () => {
  start(); complete({ exitCode: 128, output: "not a git repository" }); complete();
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "failed", exitCode: 128, output: "not a git repository" });
});

it.each([null, Number.NaN, -1, 0.5])("does not invent a result for unknown exit %s", exitCode => {
  start(); complete({ exitCode });
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "unavailable", output: "clean" });
  expect(getWorkflowRunStatus(wf.id)?.exitCode).toBeUndefined();
});

it("marks missing completion unavailable, but accepts a later exact completion", () => {
  start(); markWorkflowRunSubmitted(wf.id, "run:1");
  vi.advanceTimersByTime(WORKFLOW_RUN_RESULT_TIMEOUT_MS);
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "unavailable", outputUnavailableReason: expect.stringContaining("may still be running") });
  complete();
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "succeeded", output: "clean" });
  expect(getWorkflowRunStatus(wf.id)?.outputUnavailableReason).toBeUndefined();
});

it("keeps only the latest run for an item when an older run finishes", () => {
  start(); start(wf, "run:2");
  complete(); markWorkflowRunSubmitted(wf.id, "run:1"); markWorkflowRunWriteFailed(wf.id, "run:1");
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ runId: "run:2", phase: "submitting" });
  complete({ runId: "run:2", exitCode: 2 });
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ runId: "run:2", phase: "failed" });
});

it("isolates script results from imported workflow IDs and removal", () => {
  const item = { ...wf, id: "script_same" };
  start(item, "run:workflow");
  beginWorkflowRun(item, {}, target, "git status", "run:script", "script");
  markWorkflowRunSubmitted(item.id, "run:script", "script");
  complete({ runId: "run:script", exitCode: 2, output: "script result" });
  expect(getWorkflowRunStatus(item.id)?.phase).toBe("submitting");
  expect(getWorkflowRunStatus(item.id, "script")).toMatchObject({ phase: "failed", output: "script result" });
  clearWorkflowRunStatus(item.id, "script");
  complete({ runId: "run:workflow", output: "workflow result" });
  expect(getWorkflowRunStatus(item.id)?.output).toBe("workflow result");
  expect(getWorkflowRunStatus(item.id, "script")).toBeUndefined();
});

it("does not overwrite a fast observed completion with a late write acknowledgement or rejection", () => {
  start(); complete(); markWorkflowRunSubmitted(wf.id, "run:1"); markWorkflowRunWriteFailed(wf.id, "run:1");
  expect(getWorkflowRunStatus(wf.id)?.phase).toBe("succeeded");
});

it("uses unavailable, not failure, for an ambiguous native write rejection", () => {
  start(); markWorkflowRunWriteFailed(wf.id, "run:1");
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "unavailable", outputUnavailableReason: expect.stringContaining("submission could not be confirmed") });
  expect(getWorkflowRunStatus(wf.id)?.exitCode).toBeUndefined();
});

it("does not retain output, raw command or input values for secret-input workflows", () => {
  const secretWorkflow: Workflow = { ...wf, inputs: [{ name: "value", label: "Value", type: "secret", required: true }] };
  start(secretWorkflow, "run:1", { value: "short" }, "printf short");
  complete({ command: "printf short", output: "short" });
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ phase: "succeeded", outputUnavailableReason: expect.stringContaining("credentials") });
  expect(getWorkflowRunStatus(wf.id)?.output).toBeUndefined();
  expect(JSON.stringify(getWorkflowRunStatus(wf.id))).not.toContain("short");
});

it("keeps secret suppression after an ambiguous write failure or result timeout", () => {
  const secretWorkflow: Workflow = { ...wf, inputs: [{ name: "value", label: "Value", type: "secret", required: true }] };
  start(secretWorkflow, "run:1", { value: "short" }, "printf short");
  markWorkflowRunWriteFailed(wf.id, "run:1");
  vi.advanceTimersByTime(WORKFLOW_RUN_RESULT_TIMEOUT_MS);
  complete({ command: "printf short", output: "short" });
  expect(getWorkflowRunStatus(wf.id)?.output).toBeUndefined();
  expect(JSON.stringify(getWorkflowRunStatus(wf.id))).not.toContain("short");
});

it.each(["command", "input", "output", "beyond excerpt"])("suppresses detected credentials in %s", source => {
  const secret = "token=abcdef1234567890";
  start(wf, "run:1", source === "input" ? { token: "abcdef1234567890" } : {}, source === "command" ? secret : "git status");
  complete({ output: source === "output" ? secret : source === "beyond excerpt" ? "x".repeat(WORKFLOW_RUN_MAX_OUTPUT_BYTES + 100) + "\n" + secret : "clean" });
  expect(getWorkflowRunStatus(wf.id)?.output).toBeUndefined();
  expect(getWorkflowRunStatus(wf.id)?.outputUnavailableReason).toContain("credentials");
  expect(JSON.stringify(getWorkflowRunStatus(wf.id))).not.toContain("abcdef1234567890");
});

it("bounds UTF-8 output without splitting characters", () => {
  start(); complete({ output: "😀".repeat(WORKFLOW_RUN_MAX_OUTPUT_BYTES) });
  const entry = getWorkflowRunStatus(wf.id)!;
  expect(entry.outputTruncated).toBe(true);
  expect(new TextEncoder().encode(entry.output).length).toBeLessThanOrEqual(WORKFLOW_RUN_MAX_OUTPUT_BYTES);
  expect(entry.output).toBe("😀".repeat(WORKFLOW_RUN_MAX_OUTPUT_BYTES / 4));
});

it("bounds record count and forgets cleared results and pending callbacks", () => {
  start();
  for (let i = 0; i < WORKFLOW_RUN_MAX_RECORDS; i++) start({ ...wf, id: `item_${i}` }, `run:${i + 2}`);
  expect(getWorkflowRunStatus(wf.id)).toBeUndefined();
  clearWorkflowRunStatus("item_0");
  complete({ runId: "run:2" });
  expect(getWorkflowRunStatus("item_0")).toBeUndefined();
  clearWorkflowRunStatuses();
  expect(vi.getTimerCount()).toBe(0);
  expect(getWorkflowRunStatus("item_99")).toBeUndefined();
});
