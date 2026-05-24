import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";
import type { FontFamilyId } from "../styles/fonts";

export type WordWrap = "off" | "on" | "bounded";
export type EditorCursorStyle = "line" | "block" | "underline";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type LineNumbers = "on" | "off" | "relative";
export type RenderWhitespace = "none" | "boundary" | "all";

export type Prefs = {
  // App
  theme: "dark" | "light";
  zoomLevel: number;
  hasSeenWelcome: boolean;
  /** Monospace family shared by the terminal and editor. */
  fontFamily: FontFamilyId;

  // Terminal
  terminalFontSize: number;
  cursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  terminalTheme: TerminalThemePreset;
  terminalScrollback: number;

  // Editor
  editorFontSize: number;
  editorTabSize: number;
  editorWordWrap: WordWrap;
  editorMinimap: boolean;
  editorCursorStyle: EditorCursorStyle;
  editorCursorBlink: boolean;
  editorLineNumbers: LineNumbers;
  editorLigatures: boolean;
  editorWhitespace: RenderWhitespace;
  editorBracketColors: boolean;
  editorSmoothScroll: boolean;
  editorFormatOnPaste: boolean;
  editorStickyScroll: boolean;
  vimMode: boolean;

  // Explorer
  showHidden: boolean;
};

const DEFAULT: Prefs = {
  theme: "dark",
  zoomLevel: 1,
  hasSeenWelcome: false,
  fontFamily: "jetbrains",

  terminalFontSize: 13,
  cursorBlink: true,
  terminalCursorStyle: "block",
  terminalTheme: "husk",
  terminalScrollback: 1000,

  editorFontSize: 13,
  editorTabSize: 2,
  editorWordWrap: "off",
  editorMinimap: false,
  editorCursorStyle: "line",
  editorCursorBlink: true,
  editorLineNumbers: "on",
  editorLigatures: false,
  editorWhitespace: "none",
  editorBracketColors: true,
  editorSmoothScroll: true,
  editorFormatOnPaste: false,
  editorStickyScroll: true,
  vimMode: false,

  showHidden: false,
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
