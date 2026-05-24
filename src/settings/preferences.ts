import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";

export type Prefs = {
  terminalFontSize: number;
  cursorBlink: boolean;
  theme: "dark" | "light";
  terminalTheme: TerminalThemePreset;
  hasSeenWelcome: boolean;
  zoomLevel: number;
};

const DEFAULT: Prefs = {
  terminalFontSize: 13,
  cursorBlink: true,
  theme: "dark",
  terminalTheme: "husk",
  hasSeenWelcome: false,
  zoomLevel: 1,
};
const LS_KEY = "huskv2.prefs";

function load(): Prefs {
  try {
    return { ...DEFAULT, ...(JSON.parse(localStorage.getItem(LS_KEY) || "{}") as Partial<Prefs>) };
  } catch {
    return DEFAULT;
  }
}

let state: Prefs = load();
const subscribers = new Set<() => void>();

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(patch: Partial<Prefs>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — keep in memory only
  }
  for (const fn of subscribers) fn();
}

export function subscribePrefs(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribePrefs, getPrefs);
}
