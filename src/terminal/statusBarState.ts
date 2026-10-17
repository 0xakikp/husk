import { safeTimelineCommand } from "../timeline/commandMetadata";
import { canonicalStatusToolId, detectCommandToolActivities, detectStatusToolSignals, type CommandToolId, type StatusTool } from "./statusBarTools";

/** Read-only UI observations, isolated by terminal leaf and fresh shell session.
 * No terminal writes, native requests, polling, persistence, or global context. */
export type TerminalStatusRun = Readonly<{
  command: string;
  exitCode: number | null;
  durationMs: number | null;
  at: number;
}>;

export type TerminalStatusSnapshot = Readonly<{
  leafId: number;
  scopeKey: string;
  scope: "local" | "remote" | "unknown";
  host: string | null;
  cwd: string | null;
  atPrompt: boolean;
  command: string;
  startedAt: number | null;
  lastRun: TerminalStatusRun | null;
  /** In-memory names only. Never persist commands, targets, or credentials. */
  recentTools?: readonly Readonly<{ id: StatusTool | CommandToolId; seenAt: number }>[];
}>;

export const MAX_RECENT_STATUS_TOOLS = 12;

function recentToolsForCommand(snapshot: TerminalStatusSnapshot, command: string, at: number) {
  const previous = snapshot.recentTools ?? [];
  if (command.length > 480 || safeTimelineCommand(command).sensitive) return previous;
  const ids = new Set<StatusTool | CommandToolId>([
    ...detectStatusToolSignals(command).map((signal) => signal.tool),
    ...detectCommandToolActivities(command).map((activity) => canonicalStatusToolId(activity.id)),
  ]);
  if (!ids.size) return previous;
  return Object.freeze([
    ...[...ids].map((id) => Object.freeze({ id, seenAt: at })),
    ...previous.filter((entry) => !ids.has(entry.id)),
  ].slice(0, MAX_RECENT_STATUS_TOOLS));
}

type StatusState = { sessionKey: string; generation: number; snapshot: TerminalStatusSnapshot };
const states = new Map<number, StatusState>();
const listeners = new Map<number, Set<() => void>>();

function emit(leafId: number): void {
  for (const listener of listeners.get(leafId) ?? []) listener();
}

function publish(state: StatusState, patch: Partial<TerminalStatusSnapshot>): void {
  const previous = state.snapshot;
  if (Object.entries(patch).every(([key, value]) => previous[key as keyof TerminalStatusSnapshot] === value)) return;
  state.snapshot = Object.freeze({ ...previous, ...patch });
  emit(previous.leafId);
}

export function getTerminalStatus(leafId: number | null): TerminalStatusSnapshot | null {
  return leafId === null ? null : states.get(leafId)?.snapshot ?? null;
}

export function subscribeTerminalStatus(leafId: number | null, listener: () => void): () => void {
  if (leafId === null) return () => {};
  let subscribers = listeners.get(leafId);
  if (!subscribers) { subscribers = new Set(); listeners.set(leafId, subscribers); }
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
    if (!subscribers.size) listeners.delete(leafId);
  };
}

/** Called only for a new shell, not when its React view attaches or gains focus. */
export function initializeTerminalStatus(leafId: number, sessionKey: string): void {
  if (states.get(leafId)?.sessionKey === sessionKey) return;
  states.set(leafId, {
    sessionKey,
    generation: 0,
    snapshot: Object.freeze({
      leafId, scopeKey: `${sessionKey}:0`, scope: "unknown", host: null, cwd: null,
      atPrompt: false, command: "", startedAt: null, lastRun: null, recentTools: [],
    }),
  });
  emit(leafId);
}

export type TerminalStatusScopeObservation = {
  /** null is verified local; undefined is insufficient provenance, not local. */
  observedHost: string | null | undefined;
  isRemote: boolean;
  /** Only a target observed in this terminal's SSH/Mosh command, never Explorer. */
  remoteTarget: string | null;
  /** Only supplied while processing a fresh OSC 7 in this scope. */
  cwd?: string;
  /** Explicit SSH/bridge entry or exit invalidates even an identical target. */
  boundary?: boolean;
};

export function observeTerminalStatusScope(leafId: number, observation: TerminalStatusScopeObservation): void {
  const state = states.get(leafId);
  if (!state) return;
  const previous = state.snapshot;
  const { observedHost, isRemote, remoteTarget, boundary = false } = observation;
  // The registry's isRemoteShell flag resets after each D, even while remote
  // provenance persists. A missing flag/target cannot turn that shell local.
  const scope = typeof observedHost === "string" || isRemote ? "remote"
    : observedHost === null ? "local"
      : previous.scope === "remote" && !boundary ? "remote" : "unknown";
  const host = scope === "remote"
    ? observedHost ?? remoteTarget ?? (!boundary && previous.scope === "remote" ? previous.host : null)
    : null;
  const changed = boundary || scope !== previous.scope
    || (previous.host !== null && host !== null && previous.host !== host);
  if (changed) state.generation++;
  const cwd = scope === "unknown" ? null
    : observation.cwd || (changed ? null : previous.cwd);
  publish(state, {
    scopeKey: `${state.sessionKey}:${state.generation}`, scope, host, cwd,
    ...(changed ? { atPrompt: false, command: "", startedAt: null, lastRun: null, recentTools: [] } : {}),
  });
}

export function observeTerminalStatusPrompt(leafId: number, atPrompt: boolean): void {
  const state = states.get(leafId);
  if (state) publish(state, { atPrompt });
}

/** An observed preexec/C boundary, never a guessed start from a submitted key. */
export function startTerminalStatusCommand(leafId: number, command: string, startedAt: number): void {
  const state = states.get(leafId);
  if (!state) return;
  publish(state, { command, startedAt, atPrompt: false, recentTools: recentToolsForCommand(state.snapshot, command, startedAt) });
}

export function completeTerminalStatusCommand(leafId: number, exitCode: number | null, at: number): void {
  const state = states.get(leafId);
  if (!state) return;
  const { command, startedAt } = state.snapshot;
  const elapsed = startedAt === null ? null : at - startedAt;
  const lastRun = command || startedAt !== null ? Object.freeze({
    command, exitCode, at,
    durationMs: elapsed !== null && Number.isFinite(elapsed) && elapsed >= 0 ? elapsed : null,
  }) : state.snapshot.lastRun;
  publish(state, { command: "", startedAt: null, atPrompt: false, lastRun });
}

/** A disconnected PTY is not still running; do not fabricate a command result. */
export function clearTerminalStatusActivity(leafId: number): void {
  const state = states.get(leafId);
  if (state) publish(state, { command: "", startedAt: null, atPrompt: false });
}

export function disposeTerminalStatus(leafId: number): void {
  if (states.delete(leafId)) emit(leafId);
}
