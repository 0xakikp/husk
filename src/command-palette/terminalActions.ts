import { getActiveTerminalLeafId } from "../terminal/registry";
import { captureScreenCommandTarget, stageScreenCommand, type ScreenCommandTarget } from "../terminal/stageScreenCommand";

export type LauncherTerminalTarget = {
  leafId: number;
  scope: ScreenCommandTarget;
  label: string;
};

/** Capture once when Cmd+K opens, not when a later confirmation is accepted.
 * A search result must not silently follow a tab switch, cd, or SSH reconnect. */
export function captureLauncherTerminalTarget(tabName = "Terminal"): LauncherTerminalTarget | null {
  const leafId = getActiveTerminalLeafId();
  if (leafId === null) return null;
  const scope = captureScreenCommandTarget(leafId);
  if (!scope || scope.ptyId === null || (scope.isRemote && !scope.host)) return null;
  return {
    leafId,
    scope: { ...scope },
    label: `${tabName} · ${scope.isRemote ? `SSH ${scope.host}` : "Local shell"} · ${scope.cwd}`,
  };
}

/** A reviewed command is staged at a verified empty prompt; never executed.
 * Reject multiline/control-character clipboard content rather than rewriting it
 * into something different from what was reviewed. Copy remains available. */
export async function stageLauncherCommand(target: LauncherTerminalTarget | null, text: string): Promise<void> {
  if (typeof text !== "string" || /[\x00-\x1f\x7f\u2028\u2029]/.test(text)) {
    throw new Error("Only a single line without control characters can be staged. Use Copy for multiline text; nothing was sent to the terminal.");
  }
  if (!target || getActiveTerminalLeafId() !== target.leafId) {
    throw new Error("The original terminal is unavailable or changed. Return to an empty shell prompt and reopen Cmd+K, or copy the command instead.");
  }
  await stageScreenCommand(target.leafId, target.scope, text, { preserveWhitespace: true });
}
