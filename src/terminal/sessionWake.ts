import { listen } from "@tauri-apps/api/event";

/** Refresh the connection/rendering only. Never inject Enter, Ctrl+C, replay
 * input, or respawn a shell in response to focus or a long timer gap. */
export function installTerminalWakeChecks(check: () => void): () => void {
  let disposed = false;
  let pending: ReturnType<typeof setTimeout> | undefined;
  let lastTick = Date.now();
  let unlisten: (() => void) | undefined;
  const schedule = () => {
    if (disposed || document.visibilityState === "hidden" || pending !== undefined) return;
    pending = setTimeout(() => {
      pending = undefined;
      if (!disposed && document.visibilityState !== "hidden") check();
    }, 100);
  };
  window.addEventListener("focus", schedule);
  window.addEventListener("pageshow", schedule);
  document.addEventListener("visibilitychange", schedule);
  const interval = setInterval(() => {
    const now = Date.now();
    if (now - lastTick > 30_000 || now < lastTick) schedule();
    lastTick = now;
  }, 10_000);
  // WebKit may resume native focus before emitting a DOM focus event.
  void listen("tauri://focus", schedule).then((stop) => {
    if (disposed) stop(); else unlisten = stop;
  }).catch(() => { /* DOM events remain available, including in browser previews. */ });
  return () => {
    disposed = true;
    clearTimeout(pending);
    clearInterval(interval);
    unlisten?.();
    window.removeEventListener("focus", schedule);
    window.removeEventListener("pageshow", schedule);
    document.removeEventListener("visibilitychange", schedule);
  };
}

export function mayRestoreTerminalFocus(doc: Document, terminal: HTMLElement | undefined): boolean {
  if (!terminal || !doc.hasFocus()) return false;
  if (doc.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper]')) return false;
  const active = doc.activeElement;
  return !active || active === doc.body || active === doc.documentElement || terminal.contains(active);
}
