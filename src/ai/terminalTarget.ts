import { getActiveRemoteTerminal, getActiveTerminalCwd, getActiveTerminalPtyId } from "./terminalContext";

/** An approval belongs to the terminal, host and directory originally shown. */
export function captureTerminalTarget() {
  const remote = getActiveRemoteTerminal();
  return { ptyId: getActiveTerminalPtyId(), isRemote: remote.isRemote, host: remote.host ?? null, cwd: getActiveTerminalCwd() };
}

export type TerminalTarget = ReturnType<typeof captureTerminalTarget>;

export function isCurrentTerminalTarget(target: TerminalTarget): boolean {
  const current = captureTerminalTarget();
  return target.ptyId != null && current.ptyId === target.ptyId && current.isRemote === target.isRemote && current.host === target.host && current.cwd === target.cwd;
}
