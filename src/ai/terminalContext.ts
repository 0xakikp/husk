import { useSyncExternalStore } from "react";

import { isWindowFocused } from "../windowFocus";

/**
 * Lets the AI panel read the active terminal's recent output. The active
 * TerminalView registers a reader; the panel calls it when sending a message.
 */
let reader: (() => string) | null = null;
let runner: ((cmd: string) => boolean) | null = null;
let activePtyId: number | null = null;

export function setActiveTerminalPtyId(id: number | null): void {
  activePtyId = id;
}

export function getActiveTerminalPtyId(): number | null {
  return activePtyId;
}

export function setActiveTerminalReader(fn: (() => string) | null): void {
  reader = fn;
}

export function readActiveTerminal(maxChars = 8192): string {
  const text = reader ? reader() : "";
  if (text.length <= maxChars) return text;
  // Slice from the end but never start mid-line — find the first complete
  // line inside the truncated window so the LLM always receives whole lines.
  const truncated = text.slice(-maxChars);
  const firstNewline = truncated.indexOf("\n");
  return firstNewline >= 0 ? truncated.slice(firstNewline + 1) : truncated;
}

/** The active terminal registers a runner that types a command into its PTY.
 * It can refuse when the prompt already contains unsubmitted input. */
export function setActiveTerminalRunner(fn: ((cmd: string) => boolean) | null): void {
  runner = fn;
}

export function runInActiveTerminal(cmd: string): boolean {
  if (!runner) return false;
  return runner(cmd);
}

/* A direct Run action must never silently join text already waiting at a shell
   prompt. The active xterm session supplies the exact editable prompt text. */
let draftReader: (() => string) | null = null;

export function setActiveTerminalDraftReader(fn: (() => string) | null): void {
  draftReader = fn;
}

export function getActiveTerminalDraft(): string {
  return draftReader?.() ?? "";
}

// Like the runner, but drops text at the prompt WITHOUT executing it, so the
// user can review/edit (used by AI command suggestions).
let typer: ((text: string) => void) | null = null;

export function setActiveTerminalTyper(fn: ((text: string) => void) | null): void {
  typer = fn;
}

export function typeInActiveTerminal(text: string): boolean {
  if (!typer) return false;
  typer(text);
  return true;
}

// The active terminal registers an opener for its in-terminal find (scrollback
// search via xterm's SearchAddon); the titlebar search / ⌘F calls it.
let searchOpener: (() => void) | null = null;
let searchRunner: ((query: string) => void) | null = null;

export function setActiveTerminalSearchOpener(fn: (() => void) | null): void {
  searchOpener = fn;
}

export function setActiveTerminalSearcher(fn: ((query: string) => void) | null): void {
  searchRunner = fn;
}

export function openActiveTerminalSearch(): boolean {
  if (!searchOpener) return false;
  searchOpener();
  return true;
}

export function searchActiveTerminal(query: string): boolean {
  if (!searchRunner) return false;
  searchRunner(query);
  return true;
}

// --- Active terminal working directory + last exit code --------------------
// The active TerminalView parses the shell's OSC 7 (cwd) and OSC 133;D (exit
// code) — emitted by the injected shell-integration scripts — and reports them
// here, so a newly-opened terminal inherits the cwd and the UI can reflect the
// shell's state.

let activeCwd = "";
let lastExit: number | null = null;
export type ActiveRemoteTerminal = { isRemote: boolean; host?: string };
let activeRemote: ActiveRemoteTerminal = { isRemote: false };
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

export function setActiveRemoteTerminal(next: ActiveRemoteTerminal): void {
  const normalized = next.isRemote ? { isRemote: true, ...(next.host ? { host: next.host } : {}) } : { isRemote: false };
  if (activeRemote.isRemote === normalized.isRemote && activeRemote.host === normalized.host) return;
  activeRemote = normalized;
  emitTerminalState();
}

export function getActiveRemoteTerminal(): ActiveRemoteTerminal {
  return activeRemote;
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

export function useActiveRemoteTerminal(): ActiveRemoteTerminal {
  return useSyncExternalStore(subscribeTerminalState, getActiveRemoteTerminal);
}

// --- Terminal typing activity ---------------------------------------------

let typing = false;
const typingSubscribers = new Set<() => void>();

function emitTyping(): void {
  for (const fn of typingSubscribers) fn();
}

export function setTerminalTyping(active: boolean): void {
  if (typing === active) return;
  typing = active;
  emitTyping();
}

export function getTerminalTyping(): boolean {
  return typing;
}

export function subscribeTerminalTyping(fn: () => void): () => void {
  typingSubscribers.add(fn);
  return () => typingSubscribers.delete(fn);
}

// --- Current foreground command (from shell preexec / OSC 133) -------------

let currentCommand = "";
let commandStartTime = 0;
let commandRunning = false;
const commandSubscribers = new Set<() => void>();

function emitCommandState(): void {
  for (const fn of commandSubscribers) fn();
}

export function setCurrentCommand(cmd: string): void {
  currentCommand = cmd;
  commandStartTime = Date.now();
  commandRunning = true;
  emitCommandState();
}

// --- Focus terminal from anywhere -----------------------------------------

let focusTerminalFn: (() => void) | null = null;

export function setFocusTerminalFn(fn: (() => void) | null): void {
  focusTerminalFn = fn;
}

export function focusActiveTerminal(): void {
  focusTerminalFn?.();
}

// --- Prompt position tracking (for click-to-edit) -------------------------

let promptPos: { row: number; col: number } | null = null;

export function setPromptPosition(pos: { row: number; col: number } | null): void {
  promptPos = pos;
}

export function getPromptPosition(): { row: number; col: number } | null {
  return promptPos;
}

export function markCommandStart(): void {
  if (!commandRunning) {
    commandRunning = true;
    commandStartTime = Date.now();
    emitCommandState();
  }
}

export function clearCurrentCommand(): void {
  const durationMs = Date.now() - commandStartTime;
  const MIN_DURATION_MS = 30_000;

  if (
    commandRunning &&
    durationMs >= MIN_DURATION_MS &&
    !isWindowFocused() &&
    "Notification" in window
  ) {
    const durationSec = Math.round(durationMs / 1000);
    const body = currentCommand
      ? `"${currentCommand}" completed in ${durationSec}s`
      : `Command completed in ${durationSec}s`;

    if (Notification.permission === "granted") {
      void new Notification("Husk — Command finished", { body });
    } else if (Notification.permission !== "denied") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          void new Notification("Husk — Command finished", { body });
        }
      });
    }
  }

  currentCommand = "";
  commandRunning = false;
  emitCommandState();
}

export function getCurrentCommand(): string {
  return currentCommand;
}

export function getCommandStartTime(): number {
  return commandStartTime;
}

export function isCommandRunning(): boolean {
  return commandRunning;
}

export function subscribeCommandState(fn: () => void): () => void {
  commandSubscribers.add(fn);
  return () => commandSubscribers.delete(fn);
}

export function useCurrentCommand(): string {
  return useSyncExternalStore(subscribeCommandState, getCurrentCommand);
}

export function useCommandStartTime(): number {
  return useSyncExternalStore(subscribeCommandState, getCommandStartTime);
}

export function useCommandRunning(): boolean {
  return useSyncExternalStore(subscribeCommandState, isCommandRunning);
}

/* ── Per-command output ────────────────────────────────────────────────────
   The shell emits OSC 133 C at command start and D at command end, so the rows
   between them are exactly one command's output. Capturing that gives the AI a
   precise attachment instead of readActiveTerminal's blind 8KB scrollback tail,
   which mixes unrelated commands together and silently truncates mid-line. */

export type CommandRun = {
  command: string;
  output: string;
  exitCode: number | null;
  at: number;
};

/** A command completion with its originating PTY and directory. Unlike the
 * small active-terminal history, this is an event stream so Terminal Pilot can
 * wait for the exact command it launched even if the user looks at another
 * terminal while it runs. */
export type ObservedCommandRun = CommandRun & {
  terminalPtyId: number | null;
  cwd: string;
};

const commandRunSubscribers = new Set<(run: ObservedCommandRun) => void>();

export function publishTerminalCommandRun(run: ObservedCommandRun): void {
  for (const subscriber of commandRunSubscribers) subscriber(run);
}

export function subscribeTerminalCommandRuns(
  subscriber: (run: ObservedCommandRun) => void,
): () => void {
  commandRunSubscribers.add(subscriber);
  return () => commandRunSubscribers.delete(subscriber);
}

/** Small ring: enough to pick from, bounded so long sessions cannot grow it. */
const MAX_RUNS = 10;
let recentRuns: CommandRun[] = [];

export function recordCommandRun(run: CommandRun): void {
  if (!run.command.trim() && !run.output.trim()) return;
  recentRuns = [run, ...recentRuns].slice(0, MAX_RUNS);
}

/** Most recent first. */
export function getRecentCommandRuns(): CommandRun[] {
  return [...recentRuns];
}

export function clearRecentCommandRuns(): void {
  recentRuns = [];
}

/* ── Pending run attachment ────────────────────────────────────────────────
   The failure strip attaches a failed command's output to the composer. The
   run is parked here; every composer that opens attaches it (deduped by
   `at`), and the strip clears the slot shortly after opening. */

let pendingRunAttachment: CommandRun | null = null;

export function setPendingRunAttachment(run: CommandRun | null): void {
  pendingRunAttachment = run;
}

export function getPendingRunAttachment(): CommandRun | null {
  return pendingRunAttachment;
}
