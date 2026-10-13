/** A welcome is UI-only, per fresh terminal session, and never shell output.
 * This store deliberately has no terminal, native, storage or polling imports. */
export type TerminalWelcomeSnapshot = Readonly<{ cwd: string; visible: boolean; atPrompt: boolean; scrollRows?: number }>;

type WelcomeState = { snapshot: TerminalWelcomeSnapshot; dismissed: boolean };
const welcomes = new Map<number, WelcomeState>();
const listeners = new Map<number, Set<() => void>>();

function publish(leafId: number, state: WelcomeState, cwd: string, visible: boolean, atPrompt = state.snapshot.atPrompt): void {
  if (state.snapshot.cwd === cwd && state.snapshot.visible === visible && state.snapshot.atPrompt === atPrompt) return;
  state.snapshot = Object.freeze({ ...state.snapshot, cwd, visible, atPrompt });
  for (const callback of listeners.get(leafId) ?? []) callback();
}

export function getTerminalWelcome(leafId: number): TerminalWelcomeSnapshot | null {
  return welcomes.get(leafId)?.snapshot ?? null;
}

export function subscribeTerminalWelcome(leafId: number, callback: () => void): () => void {
  let subscribers = listeners.get(leafId);
  if (!subscribers) { subscribers = new Set(); listeners.set(leafId, subscribers); }
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
    if (!subscribers.size) listeners.delete(leafId);
  };
}

/** Only the registry's actual new-session path may initialize a candidate.
 * Reattaching a view must not revive a dismissed welcome. */
export function initializeTerminalWelcome(leafId: number): void {
  if (welcomes.has(leafId)) return;
  welcomes.set(leafId, { snapshot: Object.freeze({ cwd: "", visible: false, atPrompt: false }), dismissed: false });
  for (const callback of listeners.get(leafId) ?? []) callback();
}

/** Update only from observed OSC cwd metadata, never a launch-directory guess. */
export function observeTerminalWelcomeCwd(leafId: number, cwd: string, verifiedLocal: boolean): void {
  const state = welcomes.get(leafId);
  if (!state || state.dismissed) return;
  if (!verifiedLocal) {
    // Once shown, losing local provenance retires the welcome permanently.
    if (state.snapshot.visible) dismissTerminalWelcome(leafId);
    return;
  }
  publish(leafId, state, cwd, state.snapshot.visible);
}

/** Only a real editable first prompt in a verified local scope can show it. */
export function observeTerminalWelcomePrompt(leafId: number, cwd: string, verifiedLocal: boolean): void {
  const state = welcomes.get(leafId);
  if (!state || state.dismissed) return;
  if (!verifiedLocal || !cwd) {
    if (state.snapshot.visible) dismissTerminalWelcome(leafId);
    return;
  }
  publish(leafId, state, cwd, true, true);
}

/** A submitted or observed command retires the Ready badge, not the welcome. */
export function noteTerminalWelcomeCommand(leafId: number): void {
  const state = welcomes.get(leafId);
  if (!state || state.dismissed) return;
  publish(leafId, state, state.snapshot.cwd, state.snapshot.visible, false);
}

/** Output moves the greeting upward by real terminal rows, never a timer.
 * Keep a high-water mark: refitting the freed space must not make it bounce. */
export function scrollTerminalWelcome(leafId: number, rows: number): void {
  const state = welcomes.get(leafId);
  if (!state || state.dismissed || !state.snapshot.visible || !Number.isFinite(rows)) return;
  const scrollRows = Math.max(0, Math.floor(rows));
  if (scrollRows <= (state.snapshot.scrollRows ?? 0)) return;
  state.snapshot = Object.freeze({ ...state.snapshot, scrollRows });
  for (const callback of listeners.get(leafId) ?? []) callback();
}

/** Permanent for this session: clear/full-page output, remote/alternate-screen
 * transitions, explicit dismissal and shell restarts cannot make it reappear. */
export function dismissTerminalWelcome(leafId: number): void {
  const state = welcomes.get(leafId);
  if (!state || state.dismissed) return;
  state.dismissed = true;
  publish(leafId, state, state.snapshot.cwd, false, false);
}

export function disposeTerminalWelcome(leafId: number): void {
  if (!welcomes.delete(leafId)) return;
  for (const callback of listeners.get(leafId) ?? []) callback();
}
