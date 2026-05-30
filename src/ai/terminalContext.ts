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
