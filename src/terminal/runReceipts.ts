/** Ephemeral identity of one shell target. Unknown remote provenance must not
 * authorize an interrupt, even when a PTY id happens to match. */
export type TerminalRunTarget = {
  ptyId: number;
  sessionId: string;
  generation: number;
  cwd: string;
  isRemote: boolean;
  remoteTarget: string | null;
  observedHost: string | null | undefined;
};

type PendingRun = { runId: string; command: string; target: TerminalRunTarget };
type RunningRun = PendingRun & { startedAt: number; interruptRequested: boolean };
export type TerminalRunReceipt = { runId: string; startedAt: number };
let sequence = 0;

function sameTarget(a: TerminalRunTarget, b: TerminalRunTarget): boolean {
  return a.ptyId === b.ptyId && a.sessionId === b.sessionId && a.generation === b.generation
    && a.cwd === b.cwd && a.isRemote === b.isRemote && a.remoteTarget === b.remoteTarget
    && a.observedHost === b.observedHost;
}

/** A receipt is not a command-text subscription. Only the next preexec can
 * claim it; manual commands, fresh prompts, failed writes and restarts retire
 * it so a later identical command cannot accidentally satisfy a waiting task. */
export class TerminalRunReceipts {
  private pending: PendingRun | null = null;
  private running: RunningRun | null = null;

  get hasPending(): boolean { return this.pending !== null; }

  queue(command: string, target: TerminalRunTarget): string {
    this.clear();
    const runId = `${target.sessionId}:run:${++sequence}`;
    this.pending = { runId, command: command.trim(), target: { ...target } };
    return runId;
  }

  preexec(command: string, target: TerminalRunTarget | null, startedAt: number): void {
    const pending = this.pending;
    this.clear();
    if (pending && target && pending.command && pending.command === command.trim() && sameTarget(pending.target, target)) {
      this.running = { ...pending, startedAt, interruptRequested: false };
    }
  }

  complete(command: string, target: TerminalRunTarget | null): TerminalRunReceipt | undefined {
    const running = this.running;
    this.clear();
    if (!running || !target || running.command !== command.trim() || !sameTarget(running.target, target)) return undefined;
    return { runId: running.runId, startedAt: running.startedAt };
  }

  /** Claims at most one attempt, including ambiguous write failures. */
  interrupt(runId: string, target: TerminalRunTarget, write: (data: string) => boolean): boolean {
    const running = this.running;
    if (!running || running.interruptRequested || running.runId !== runId || !sameTarget(running.target, target)
      || target.observedHost === undefined || (target.observedHost !== null) !== target.isRemote
      || (target.isRemote && !target.remoteTarget)) return false;
    running.interruptRequested = true;
    try { return write("\x03"); }
    catch { return false; }
  }

  clear(): void { this.pending = null; this.running = null; }
}
