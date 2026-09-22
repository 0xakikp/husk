import { invoke } from "@tauri-apps/api/core";
import { captureTerminalTarget, isCurrentTerminalTarget, type TerminalTarget } from "../ai/terminalTarget";
import { validateStagedCommand } from "../ai/screenSelection";
import { getSessionHandle } from "./registry";

export type ScreenCommandTarget = TerminalTarget & { scopeToken: string };

/** Capture per-session provenance alongside the reviewed global target. A
 * reconnect may reuse the same PTY/cwd/host but cannot reuse this scope token. */
export function captureScreenCommandTarget(leafId: number): ScreenCommandTarget | null {
  const scope = getSessionHandle(leafId)?.getStagingScope();
  const target = captureTerminalTarget();
  if (!scope || scope.ptyId !== target.ptyId || scope.cwd !== target.cwd
    || scope.isRemote !== target.isRemote || scope.host !== target.host) return null;
  return { ...target, scopeToken: scope.token };
}

export async function stageScreenCommand(leafId: number, target: ScreenCommandTarget | null, proposal: string): Promise<void> {
  const command = validateStagedCommand(proposal);
  const current = captureScreenCommandTarget(leafId);
  if (!target || !current) throw new Error("The terminal scope could not be verified. Return to a known shell prompt or copy the command instead.");
  const handle = getSessionHandle(leafId);
  if (current.scopeToken !== target.scopeToken || !isCurrentTerminalTarget(target) || !handle || handle.getPtyId() !== target.ptyId) throw new Error("The terminal, folder or SSH connection changed. Review the command again in the intended terminal.");
  if (target.isRemote && !target.host) throw new Error("The SSH host is unknown. Reconnect before staging an AI command.");
  const prompt = handle.getPromptReadiness();
  if (!prompt.ready) throw new Error(prompt.reason);
  // Only a validated single line. In particular, never send Enter or an escape
  // sequence, and never fall back to the currently focused, unrelated PTY.
  await invoke("pty_write", { id: target.ptyId, data: command });
  if (isCurrentTerminalTarget(target) && captureScreenCommandTarget(leafId)?.scopeToken === target.scopeToken) handle.focus();
}
