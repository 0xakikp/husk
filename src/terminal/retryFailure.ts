import { invoke } from "@tauri-apps/api/core";
import { clearFailure, getFailure, type FailureRecord, type FailureTerminalScope } from "./failureStore";
import { getActiveTerminalLeafId, getSessionHandle } from "./registry";
import { captureScreenCommandTarget, type ScreenCommandTarget } from "./stageScreenCommand";

// Shared across component remounts: a second click must not submit while the
// native write for this pane is still awaiting acknowledgement.
const retryingLeaves = new Set<number>();

function matchesScope(target: ScreenCommandTarget, scope: FailureTerminalScope): boolean {
  return target.scopeToken === scope.token && target.ptyId === scope.ptyId
    && target.cwd === scope.cwd && target.isRemote === scope.isRemote && target.host === scope.host;
}

/** Explicitly resubmit exactly this failure to its original, verified empty
 * shell. No focus fallback, input clearing, automatic retry or split writes. */
export async function retryFailure(leafId: number, record: FailureRecord): Promise<boolean> {
  if (retryingLeaves.has(leafId)) return false;
  if (record.leafId !== leafId || getFailure(leafId)?.record !== record) {
    throw new Error("This failure is no longer current. Review the latest failure before retrying.");
  }
  if (getActiveTerminalLeafId() !== leafId) {
    throw new Error("Select the terminal where this command failed before retrying.");
  }
  const scope = record.terminalScope;
  const target = captureScreenCommandTarget(leafId);
  const handle = getSessionHandle(leafId);
  if (!scope || !target || !handle) {
    throw new Error("The failed command's terminal scope could not be verified. Copy and review the command in the intended terminal instead.");
  }
  if (record.cwd !== scope.cwd || !matchesScope(target, scope) || handle.getPtyId() !== scope.ptyId) {
    throw new Error("The terminal, folder or SSH connection changed since this command failed. Copy and review it in the intended terminal instead.");
  }
  if (scope.isRemote && !scope.host) {
    throw new Error("The SSH host is unknown. Reconnect before retrying this command.");
  }
  const prompt = handle.getPromptReadiness();
  if (!prompt.ready) throw new Error(prompt.reason);
  if (!record.command.trim() || /[\x00-\x1f\x7f\u2028\u2029]/.test(record.command)) {
    throw new Error("This command cannot be retried safely as one line. Copy and review it at the prompt instead.");
  }

  retryingLeaves.add(leafId);
  try {
    // Preserve the original command, including deliberate leading spaces.
    // Await native acceptance; a failed write must leave recovery available.
    await invoke("pty_write", { id: scope.ptyId, data: `${record.command}\r` });
    if (getFailure(leafId)?.record === record) clearFailure(leafId);
    const current = captureScreenCommandTarget(leafId);
    if (getActiveTerminalLeafId() === leafId && current && matchesScope(current, scope)) handle.focus();
    return true;
  } finally {
    retryingLeaves.delete(leafId);
  }
}
