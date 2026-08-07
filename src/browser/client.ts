import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

/** Logical-px rect of the placeholder div the native webview should cover. */
export type BrowserRect = { x: number; y: number; width: number; height: number };

export const browserCreate = (label: string, url: string, r: BrowserRect) =>
  invoke<void>("browser_create", { label, url, x: r.x, y: r.y, width: r.width, height: r.height });

export const browserNavigate = (label: string, url: string) =>
  invoke<void>("browser_navigate", { label, url });

export const browserGo = (label: string, action: "back" | "forward" | "reload") =>
  invoke<void>("browser_go", { label, action });

export const browserSetBounds = (label: string, r: BrowserRect) =>
  invoke<void>("browser_set_bounds", { label, x: r.x, y: r.y, width: r.width, height: r.height });

export const browserSetVisible = (label: string, visible: boolean) =>
  invoke<void>("browser_set_visible", { label, visible });

export const browserClose = (label: string) => invoke<void>("browser_close", { label });

/** Fired by the Rust side on every navigation the child webview performs. */
export const onBrowserNav = (cb: (label: string, url: string) => void) =>
  listen<{ label: string; url: string }>("browser://nav", (e) => cb(e.payload.label, e.payload.url));

export type BrowserLoadPhase = "started" | "finished";

/** Native load events let the toolbar reflect actual page transitions rather
 * than guessing from an address-bar submission. */
export const onBrowserLoad = (cb: (label: string, url: string, phase: BrowserLoadPhase) => void) =>
  listen<{ label: string; url: string; phase: BrowserLoadPhase }>("browser://load", (e) =>
    cb(e.payload.label, e.payload.url, e.payload.phase),
  );
