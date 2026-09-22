import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../terminal/registry", () => ({ getActiveTerminalLeafId: vi.fn(), getSessionHandle: vi.fn() }));
vi.mock("../terminal/stageScreenCommand", () => ({ captureScreenCommandTarget: vi.fn() }));
vi.mock("../ai/terminalTarget", () => ({ isCurrentTerminalTarget: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { getActiveTerminalLeafId, getSessionHandle, type TerminalHandle } from "../terminal/registry";
import { captureScreenCommandTarget } from "../terminal/stageScreenCommand";
import { isCurrentTerminalTarget } from "../ai/terminalTarget";
import { captureWorkflowTarget, executeWorkflow } from "./execution";
import { compileWorkflow } from "./params";
const wf = { id: "wf_1", name: "Print", steps: ["printf ready"] };
const scope = { ptyId: 7, cwd: "/project", isRemote: false, host: null, scopeToken: "session:7" };
beforeEach(() => {
  vi.mocked(getActiveTerminalLeafId).mockReturnValue(1); vi.mocked(captureScreenCommandTarget).mockReturnValue(scope); vi.mocked(isCurrentTerminalTarget).mockReturnValue(true);
  vi.mocked(getSessionHandle).mockReturnValue({ getPromptReadiness: () => ({ ready: true }), focus: vi.fn() } as unknown as TerminalHandle);
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
});
it("writes exactly the reviewed command and one Enter to its captured PTY", async () => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  expect(invoke).not.toHaveBeenCalled(); await executeWorkflow(wf, {}, target, command);
  expect(invoke).toHaveBeenCalledWith("pty_write", { id: 7, data: command + "\r" });
});
it.each(["target", "reconnect", "busy", "changed command"])("fails closed after %s changes", async (kind) => {
  const target = captureWorkflowTarget(); const command = compileWorkflow(wf, {}).command;
  if (kind === "target") vi.mocked(isCurrentTerminalTarget).mockReturnValue(false);
  if (kind === "reconnect") vi.mocked(captureScreenCommandTarget).mockReturnValue({ ...scope, scopeToken: "new-session" });
  if (kind === "busy") vi.mocked(getSessionHandle).mockReturnValue({ getPromptReadiness: () => ({ ready: false, reason: "Existing draft" }) } as unknown as TerminalHandle);
  await expect(executeWorkflow(wf, {}, target, kind === "changed command" ? "different" : command)).rejects.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
