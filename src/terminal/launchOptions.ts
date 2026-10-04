/** Runtime boundary: a callback may accidentally supply a DOM/React event.
 * Never stringify or coerce launch candidates; only actual paths may enter
 * persisted pane state or native IPC. Keep valid paths byte-for-byte intact. */
export function resolveTerminalLaunchCwd(...candidates: unknown[]): string | undefined {
  return candidates.find((value): value is string =>
    typeof value === "string" && value.length > 0 && !value.includes("\0"),
  );
}

/** Build a plain, serializable payload for both first launch and explicit
 * restart. A remote prompt's cwd is never a local shell launch directory. */
export function buildPtySpawnArgs(source: {
  cols: number;
  rows: number;
  cwd: unknown;
  initialCwd: unknown;
  isRemoteShell: boolean;
}): { cols: number; rows: number; cwd: string | null } {
  return {
    cols: source.cols || 80,
    rows: source.rows || 24,
    cwd: resolveTerminalLaunchCwd(
      source.isRemoteShell ? undefined : source.cwd,
      source.initialCwd,
    ) ?? null,
  };
}
