import { useSyncExternalStore } from "react";

/**
 * Lets the AI panel read the active terminal's recent output. The active
 * TerminalView registers a reader; the panel calls it when sending a message.
 */
let reader: (() => string) | null = null;
let runner: ((cmd: string) => void) | null = null;

export function setActiveTerminalReader(fn: (() => string) | null): void {
  reader = fn;
}

export function readActiveTerminal(maxChars = 4000): string {
  const text = reader ? reader() : "";
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

/** The active terminal registers a runner that types a command into its PTY. */
export function setActiveTerminalRunner(fn: ((cmd: string) => void) | null): void {
  runner = fn;
}

export function runInActiveTerminal(cmd: string): boolean {
  if (!runner) return false;
  runner(cmd);
  return true;
}

// --- Active terminal working directory + last exit code --------------------
// The active TerminalView parses the shell's OSC 7 (cwd) and OSC 133;D (exit
// code) — emitted by the injected shell-integration scripts — and reports them
// here, so a newly-opened terminal inherits the cwd and the UI can reflect the
// shell's state.

let activeCwd = "";
let lastExit: number | null = null;
const stateSubscribers = new Set<() => void>();

function emitTerminalState(): void {
  for (const fn of stateSubscribers) fn();
}

export function setActiveTerminalCwd(cwd: string): void {
  if (cwd === activeCwd) return;
  activeCwd = cwd;
  emitTerminalState();
}

export function getActiveTerminalCwd(): string {
  return activeCwd;
}

export function setActiveTerminalExit(code: number | null): void {
  if (code === lastExit) return;
  lastExit = code;
  emitTerminalState();
}

export function getActiveTerminalExit(): number | null {
  return lastExit;
}

export function subscribeTerminalState(fn: () => void): () => void {
  stateSubscribers.add(fn);
  return () => {
    stateSubscribers.delete(fn);
  };
}

export function useActiveTerminalCwd(): string {
  return useSyncExternalStore(subscribeTerminalState, getActiveTerminalCwd);
}

export function useActiveTerminalExit(): number | null {
  return useSyncExternalStore(subscribeTerminalState, getActiveTerminalExit);
}
