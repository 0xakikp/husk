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

export type PromptTemplate = {
  id: string;
  label: string;
  icon: string;
  prompt: string;
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
  aiPromptTemplates: PromptTemplate[];

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

  // AI Composer
  aiMiniOpacity: number;
  aiMiniFontSize: number;
  aiMiniBgBlur: number;
  aiMiniBgDim: number;
  aiComposerBgStyle: "default" | "gradient" | "solid";
  aiComposerBgColor: string;

  // AI tab
  aiTabPinned: boolean;

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
  aiPromptTemplates: [
    { id: "refactor", label: "Refactor", icon: "✨", prompt: "Refactor the following code. Keep the same behavior but improve readability, performance, and structure." },
    { id: "explain", label: "Explain", icon: "❓", prompt: "Explain this in simple terms." },
    { id: "tests", label: "Tests", icon: "🧪", prompt: "Write unit tests for the following code. Include edge cases and error scenarios." },
    { id: "debug", label: "Debug", icon: "🐛", prompt: "Find and explain the bug in the following code or error output. Suggest a fix." },
    { id: "script", label: "Script", icon: "📜", prompt: "Convert the recent terminal commands into a reusable shell script." },
  ],

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
  aiMiniBgBlur: 0,
  aiMiniBgDim: 50,
  aiComposerBgStyle: "default",
  aiComposerBgColor: "#000000",
  aiTabPinned: false,

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
