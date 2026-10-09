import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../terminal/registry", () => ({ getActiveTerminalLeafId: vi.fn(), getSessionHandle: vi.fn(), submitTrackedTerminalCommand: vi.fn() }));
vi.mock("../terminal/stageScreenCommand", () => ({ captureScreenCommandTarget: vi.fn() }));
vi.mock("../ai/terminalTarget", () => ({ isCurrentTerminalTarget: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { getActiveTerminalLeafId, getSessionHandle, submitTrackedTerminalCommand, type TerminalHandle } from "../terminal/registry";
import { captureScreenCommandTarget } from "../terminal/stageScreenCommand";
import { isCurrentTerminalTarget } from "../ai/terminalTarget";
import { captureWorkflowTarget, executeWorkflow } from "./execution";
import { compileWorkflow } from "./params";
import { clearWorkflowRunStatuses, getWorkflowRunStatus } from "./runStatus";
const wf = { id: "wf_1", name: "Print", steps: ["printf ready"] };
const scope = { ptyId: 7, cwd: "/project", isRemote: false, host: null, scopeToken: "session:7" };
beforeEach(() => {
  clearWorkflowRunStatuses();
  vi.mocked(getActiveTerminalLeafId).mockReturnValue(1); vi.mocked(captureScreenCommandTarget).mockReturnValue(scope); vi.mocked(isCurrentTerminalTarget).mockReturnValue(true);
  vi.mocked(getSessionHandle).mockReturnValue({ getPromptReadiness: () => ({ ready: true }), focus: vi.fn() } as unknown as TerminalHandle);
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  vi.mocked(submitTrackedTerminalCommand).mockReset().mockImplementation(async (_leaf, target, command, onQueued) => {
    onQueued("run:1");
    await invoke("pty_write", { id: target.ptyId, data: command + "\r" });
    return "run:1";
  });
});
it("writes exactly the reviewed command and one Enter to its captured PTY", async () => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  expect(invoke).not.toHaveBeenCalled(); await executeWorkflow(wf, {}, target, command);
  expect(invoke).toHaveBeenCalledWith("pty_write", { id: 7, data: command + "\r" });
  expect(getWorkflowRunStatus(wf.id)).toMatchObject({ runId: "run:1", phase: "running", terminal: { ptyId: 7, cwd: "/project" } });
  expect(getWorkflowRunStatus(wf.id)?.exitCode).toBeUndefined();
});
it.each(["target", "reconnect", "busy", "changed command"])("fails closed after %s changes", async (kind) => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  if (kind === "target") vi.mocked(isCurrentTerminalTarget).mockReturnValue(false);
  if (kind === "reconnect") vi.mocked(captureScreenCommandTarget).mockReturnValue({ ...scope, scopeToken: "new-session" });
  if (kind === "busy") vi.mocked(getSessionHandle).mockReturnValue({ getPromptReadiness: () => ({ ready: false, reason: "Existing draft" }) } as unknown as TerminalHandle);
  await expect(executeWorkflow(wf, {}, target, kind === "changed command" ? "different" : command)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects a switched terminal even if its host and directory match", async () => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  vi.mocked(getActiveTerminalLeafId).mockReturnValue(2);
  await expect(executeWorkflow(wf, {}, target, command)).rejects.toThrow("changed");
  expect(invoke).not.toHaveBeenCalled();
});

it("does not duplicate a pending submission and releases its lock after failure", async () => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  let rejectWrite!: (reason: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const first = executeWorkflow(wf, {}, target, command);
  await expect(executeWorkflow(wf, {}, target, command)).rejects.toThrow("submission in progress");
  expect(invoke).toHaveBeenCalledTimes(1);
  rejectWrite(new Error("Shell disconnected"));
  await expect(first).rejects.toThrow("Shell disconnected");
  expect(getWorkflowRunStatus(wf.id)?.phase).toBe("unavailable");
  await executeWorkflow(wf, {}, target, command);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("refuses linked local script execution on a reviewed remote target", async () => {
  vi.mocked(captureScreenCommandTarget).mockReturnValue({ ...scope, isRemote: true, host: "prod" });
  const target = captureWorkflowTarget();
  await expect(executeWorkflow(wf, {}, target, compileWorkflow(wf, {}).command, { localOnly: true })).rejects.toThrow("local terminal");
  expect(submitTrackedTerminalCommand).not.toHaveBeenCalled();
  expect(getWorkflowRunStatus(wf.id)).toBeUndefined();
});

it("rejects unknown targets and unverified remote hosts without writing", async () => {
  vi.mocked(captureScreenCommandTarget).mockReturnValue({ ...scope, isRemote: true, host: null });
  const target = captureWorkflowTarget();
  expect(target).toBeNull();
  await expect(executeWorkflow(wf, {}, target, compileWorkflow(wf, {}).command)).rejects.toThrow("No verified terminal");
  expect(invoke).not.toHaveBeenCalled();
});
