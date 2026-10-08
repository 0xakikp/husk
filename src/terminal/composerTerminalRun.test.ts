import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAiTask } from "../ai/taskMode";
import { setActiveTerminalCwd, setActiveTerminalPtyId, setActiveTerminalRunner, type TerminalRunFailureReason } from "../ai/terminalContext";
import { notifyTerminalFolderUnavailable, runComposerTerminalCommand } from "./composerTerminalRun";
import { toast } from "../toast";

vi.mock("../toast", () => ({ toast: vi.fn() }));
beforeEach(() => {
  setActiveTerminalPtyId(11); setActiveTerminalCwd("/project");
  vi.mocked(toast).mockClear();
});
afterEach(() => { setActiveTerminalRunner(null); setActiveTerminalPtyId(null); setActiveTerminalCwd(""); });

it.each<[TerminalRunFailureReason, string]>([
  ["prompt-unverified", "Shell prompt is not verified"],
  ["input-present", "Terminal input is waiting"],
  ["terminal-busy", "Terminal is busy"],
  ["terminal-unavailable", "Terminal is not ready"],
  ["write-failed", "Could not send command"],
  ["no-terminal", "No active terminal"],
])("reports %s accurately in TASK mode without recording an execution", (reason, title) => {
  const task = createAiTask("Check Git state", "/project");
  const onTaskEvent = vi.fn();
  const onAccepted = vi.fn();
  const runner = vi.fn(() => ({ ok: false as const, reason, message: "Actual rejection reason" }));
  setActiveTerminalRunner(runner);
  expect(runComposerTerminalCommand("git status -sb", { task, onTaskEvent, onAccepted })).toBe(false);
  expect(runner).toHaveBeenCalledExactlyOnceWith("git status -sb");
  expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title, message: "Actual rejection reason" }));
  expect(onTaskEvent).not.toHaveBeenCalled();
  expect(onAccepted).not.toHaveBeenCalled();
});

it("passes the exact accepted receipt to observation and Task evidence", () => {
  const onAccepted = vi.fn();
  const onTaskEvent = vi.fn();
  const task = createAiTask("Check", "/project");
  setActiveTerminalRunner(() => ({ ok: true, runId: "receipt-1" }));
  expect(runComposerTerminalCommand("pwd", { task, onTaskEvent, onAccepted })).toBe(true);
  expect(onAccepted).toHaveBeenCalledExactlyOnceWith({ runId: "receipt-1", command: "pwd", terminalPtyId: 11, queuedAt: expect.any(Number) });
  expect(onTaskEvent).toHaveBeenCalledWith(task.id, expect.objectContaining({ terminalRunId: "receipt-1" }));
});

it("records the target and running event only after a TASK command is accepted", () => {
  const task = createAiTask("Check Git state", "/project");
  const onTaskEvent = vi.fn();
  const runner = vi.fn(() => ({ ok: true as const }));
  setActiveTerminalRunner(runner);
  expect(runComposerTerminalCommand("git status -sb", { task, onTaskEvent })).toBe(true);
  expect(runner).toHaveBeenCalledExactlyOnceWith("git status -sb");
  expect(onTaskEvent).toHaveBeenCalledExactlyOnceWith(task.id, expect.objectContaining({
    type: "command", command: "git status -sb", state: "running", terminalPtyId: 11, detail: "/project",
  }));
  expect(toast).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ title: "Command sent to terminal" }));
});

it("still runs an explicit code-block command in normal chat or a paused TASK without adding running task work", () => {
  const onTaskEvent = vi.fn();
  setActiveTerminalRunner(() => ({ ok: true }));
  expect(runComposerTerminalCommand("git status -sb", { onTaskEvent })).toBe(true);
  const task = { ...createAiTask("Paused", "/project"), status: "paused" as const };
  expect(runComposerTerminalCommand("git status -sb", { task, onTaskEvent })).toBe(true);
  expect(onTaskEvent).not.toHaveBeenCalled();
});

it("preserves approved workspace command evidence and check classification", () => {
  const task = createAiTask("Verify", "/project");
  const onTaskEvent = vi.fn();
  const runner = vi.fn(() => ({ ok: true as const }));
  setActiveTerminalRunner(runner);
  runComposerTerminalCommand("cd -- '/project' && npm test", { task, onTaskEvent, destinationCwd: "/project", evidenceCommand: "npm test" });
  expect(onTaskEvent).toHaveBeenCalledWith(task.id, expect.objectContaining({ type: "check", command: "npm test", detail: "/project" }));
});

it("distinguishes unknown working directory from absence of a terminal", () => {
  notifyTerminalFolderUnavailable();
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "Terminal folder is unknown" }));
  setActiveTerminalPtyId(null);
  notifyTerminalFolderUnavailable();
  expect(toast).toHaveBeenLastCalledWith(expect.objectContaining({ title: "No active terminal" }));
});
