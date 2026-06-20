import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";
import type { FontFamilyId } from "../styles/fonts";

export type WordWrap = "off" | "on" | "bounded";
export type EditorCursorStyle = "line" | "block" | "underline";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type LineNumbers = "on" | "off" | "relative";
export type RenderWhitespace = "none" | "boundary" | "all";
export type LineHighlight = "none" | "line" | "gutter" | "all";

export type BackgroundSettings = {
  enabled: boolean;
  path: string;
  opacity: number;
  blur: number;
  dim: number;
};

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
  editorLineHighlight: LineHighlight;
  vimMode: boolean;

  // Explorer
  showHidden: boolean;

  // AI
  aiEnabled: boolean;
  terminalAiErrorAssist: boolean;

  // Session
  sessionRestoreEnabled: boolean;

  // Background
  background: BackgroundSettings;

  // Appearance
  accentColor: string;
  animationsEnabled: boolean;
  frostedGlass: boolean;
  panelGaps: number;
  panelGapStyle: "none" | "dots" | "grid" | "cross" | "gradient";
  panelShadows: boolean;
  activePanelGlow: boolean;
  neonBorderGlow: boolean;
  editorWallpaperOpacity: number;
  customCSS?: string;

  // AI Mini Window
  aiMiniOpacity: number;
  aiMiniFontSize: number;
  aiMiniBgEnabled: boolean;
  aiMiniBgPath: string;
  aiMiniBgOpacity: number;
  aiMiniBgBlur: number;
  aiMiniBgDim: number;

  // Notes
  notesDirectory: string;
};

const DEFAULT: Prefs = {
  theme: "dark",
  zoomLevel: 1,
  hasSeenWelcome: false,
  fontFamily: "jetbrains",

  terminalFontSize: 13,
  cursorBlink: true,
  terminalCursorStyle: "bar",
  terminalTheme: "husk",
  terminalScrollback: 1000,

  editorFontSize: 13,
  editorTabSize: 2,
  editorWordWrap: "on",
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
  editorLineHighlight: "line",
  vimMode: false,

  showHidden: false,

  aiEnabled: true,
  terminalAiErrorAssist: false,

  sessionRestoreEnabled: true,

  background: {
    enabled: false,
    path: "",
    opacity: 100,
    blur: 0,
    dim: 50,
  },

  accentColor: "#11c700",
  animationsEnabled: true,
  frostedGlass: false,
  panelGaps: 0,
  panelGapStyle: "none",
  panelShadows: false,
  activePanelGlow: false,
  neonBorderGlow: false,
  editorWallpaperOpacity: 0,

  aiMiniOpacity: 48,
  aiMiniFontSize: 11,
  aiMiniBgEnabled: false,
  aiMiniBgPath: "",
  aiMiniBgOpacity: 100,
  aiMiniBgBlur: 0,
  aiMiniBgDim: 50,

  notesDirectory: "",
};
const LS_KEY = "huskv2.prefs.v2";

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}") as Partial<Prefs>;
    const merged = { ...DEFAULT, ...saved };
    return merged;
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
