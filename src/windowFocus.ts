/** Global window focus state — tracks whether the Tauri main window is focused.
 *  Used by long-running command notifications to decide whether to ping the
 *  user via a native OS notification. */

let focused = true;
const listeners = new Set<(focused: boolean) => void>();

function emit(f: boolean) {
  for (const fn of listeners) fn(f);
}

export function setWindowFocused(f: boolean): void {
  if (focused === f) return;
  focused = f;
  emit(f);
}

export function isWindowFocused(): boolean {
  return focused;
}

export function subscribeWindowFocus(fn: (focused: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
