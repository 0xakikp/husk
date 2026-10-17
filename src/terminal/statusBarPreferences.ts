import { useSyncExternalStore } from "react";
import { STATUS_TOOLS, canonicalStatusToolId, isCommandToolId, type StatusTool, type CommandToolId } from "./statusBarTools";

const KEY = "husk.terminal.statusbar.v1";
export type PinnedStatusTool = StatusTool | CommandToolId;
export type StatusBarPreferences = Readonly<{ pinned: readonly PinnedStatusTool[]; machineMetrics: boolean }>;
const DEFAULTS: StatusBarPreferences = { pinned: [], machineMetrics: false };
export function parseStatusBarPreferences(raw: string | null): StatusBarPreferences {
  try {
    const value = JSON.parse(raw ?? "null");
    const pins: PinnedStatusTool[] = Array.isArray(value?.pinned)
      ? value.pinned.filter((id: unknown) => isCommandToolId(id) || STATUS_TOOLS.includes(id as StatusTool)).map(canonicalStatusToolId)
      : [];
    return {
      pinned: [...STATUS_TOOLS.filter((tool) => pins.includes(tool)), ...new Set<CommandToolId>(pins.filter(isCommandToolId))],
      machineMetrics: value?.machineMetrics === true,
    };
  } catch { return DEFAULTS; }
}
let current: StatusBarPreferences;
try { current = parseStatusBarPreferences(localStorage.getItem(KEY)); } catch { current = DEFAULTS; }
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getStatusBarPreferences = () => current;
export function updateStatusBarPreferences(next: StatusBarPreferences): void {
  // Persist display choices only, never commands, hosts or target names.
  current = parseStatusBarPreferences(JSON.stringify(next));
  try { localStorage.setItem(KEY, JSON.stringify(current)); } catch { /* Session-only when storage is unavailable. */ }
  for (const listener of listeners) listener();
}
export function useStatusBarPreferences(): StatusBarPreferences {
  return useSyncExternalStore(subscribe, getStatusBarPreferences);
}
