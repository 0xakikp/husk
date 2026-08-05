import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";
import type { FontFamilyId } from "../styles/fonts";

export type WordWrap = "off" | "on" | "bounded";
export type EditorCursorStyle = "line" | "block" | "underline";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type LineNumbers = "on" | "off" | "relative";
export type RenderWhitespace = "none" | "boundary" | "all";
export type LineHighlight = "none" | "line" | "gutter" | "all";
export type AiResponseStyle = "concise" | "balanced" | "detailed";

export type BackgroundSettings = {
  enabled: boolean;
  path: string;
  /** Folder of images to switch between. Optional — `path` still decides what
   *  shows, so a folder can be set and never used. */
  dir: string;
  opacity: number;
  blur: number;
  /** cover = fill the window and crop overflow; contain = whole image visible. */
  fit: "cover" | "contain";
};

export type AiAgent = {
  id: string;
  name: string;
  icon: string;
  color?: string;
  systemPrompt: string;
  model?: string;
  builtIn?: boolean;
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
  /** Optional local name used sparingly by Husk AI. */
  userName: string;
  /** Monospace family shared by the terminal and editor. */
  fontFamily: FontFamilyId;

  // Terminal
  terminalFontSize: number;
  cursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  /** Draw all terminal text at bold weight, not just text the program bolds. */
  terminalBoldFont: boolean;
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
  /** Folder of Husk plugin JSON files. Empty means no user plugins. */
  pluginsDir: string;
  /** Height of the resource inspector pane, in px. */
  inspectorHeight: number;

  // AI
  aiEnabled: boolean;
  terminalAiErrorAssist: boolean;
  aiPromptTemplates: PromptTemplate[];
  aiAgents: AiAgent[];
  activeAgentId: string;
  /** Preferences shared by every normal Husk AI conversation. */
  aiGlobalInstructions: string;
  aiPersonalMemory: string;
  aiResponseStyle: AiResponseStyle;
  /** Context chips selected when a new composer chat begins. */
  aiDefaultIncludeTerminal: boolean;
  aiDefaultIncludeFile: boolean;
  aiDefaultIncludeSelection: boolean;
  /** Tool access only applies to non-subscription model modes. */
  aiFileToolsEnabled: boolean;
  aiMcpToolsEnabled: boolean;

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
  aiTabColor?: string;
  aiSidebarWidth: number;

  // AI composer dock (terminal)
  /** Which side the AI panel docks to, in both the terminal and editor views.
   *
   *  Renamed from aiComposerDock. That key was declared and defaulted to "right"
   *  while nothing read it, and prefs persist as one object — so every existing
   *  install already has "right" in localStorage, and load()'s
   *  { ...DEFAULT, ...saved } meant changing the default could never take effect.
   *  A new name has no stored value, so the default applies once and the setting
   *  takes over from there. */
  aiPanelDock: "left" | "right";
  aiComposerSideWidth: number;

  // AI talk-back (TTS) voice — empty = auto female
  aiTtsVoice: string;

  // Setup assistant
  setupAssistantDismissed?: boolean;

  // Notes
  notesDirectory: string;
};

const DEFAULT: Prefs = {
  theme: "dark",
  zoomLevel: 1,
  hasSeenWelcome: false,
  userName: "",
  fontFamily: "iosevka",

  terminalFontSize: 13,
  cursorBlink: true,
  terminalCursorStyle: "bar",
  terminalBoldFont: false,
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
  pluginsDir: "",
  inspectorHeight: 300,

  aiEnabled: true,
  terminalAiErrorAssist: false,
  aiPromptTemplates: [
    { id: "refactor", label: "Refactor", icon: "✨", prompt: "Refactor the following code. Keep the same behavior but improve readability, performance, and structure." },
    { id: "explain", label: "Explain", icon: "❓", prompt: "Explain this in simple terms." },
    { id: "tests", label: "Tests", icon: "🧪", prompt: "Write unit tests for the following code. Include edge cases and error scenarios." },
    { id: "debug", label: "Debug", icon: "🐛", prompt: "Find and explain the bug in the following code or error output. Suggest a fix." },
    { id: "script", label: "Script", icon: "📜", prompt: "Convert the recent terminal commands into a reusable shell script." },
  ],
  aiAgents: [
    {
      id: "architect",
      name: "Architect",
      icon: "🏗️",
      color: "amber",
      builtIn: true,
      systemPrompt:
        "You are the Architect agent. You design and review software systems, APIs, data models, and deployment strategies. Think in trade-offs. Favor simple, maintainable solutions. Provide diagrams or pseudocode when useful.",
    },
    {
      id: "code",
      name: "Code",
      icon: "💻",
      color: "blue",
      builtIn: true,
      systemPrompt:
        "You are the Code agent. You write, refactor, and review production-ready code. Output complete, working snippets with proper error handling. Prefer clarity over cleverness. Follow the project's existing conventions.",
    },
    {
      id: "ask",
      name: "Ask",
      icon: "❓",
      color: "green",
      builtIn: true,
      systemPrompt:
        "You are the Ask agent. Answer general programming, tooling, and conceptual questions concisely. Explain why, not just how. Use examples when it helps understanding.",
    },
    {
      id: "debug",
      name: "Debug",
      icon: "🐛",
      color: "red",
      builtIn: true,
      systemPrompt:
        "You are the Debug agent. Investigate errors, logs, and stack traces methodically. Identify the root cause, propose the minimal fix, and explain how to verify it. Ask for missing context when needed.",
    },
    {
      id: "orchestrator",
      name: "Orchestrator",
      icon: "🎛️",
      color: "purple",
      builtIn: true,
      systemPrompt:
        "You are the Orchestrator agent. Plan multi-step tasks, delegate responsibilities across tools, and track progress. Break work into small milestones, ask for approval on big decisions, and surface risks early.",
    },
  ],
  activeAgentId: "code",
  aiGlobalInstructions: "",
  aiPersonalMemory: "",
  aiResponseStyle: "concise",
  aiDefaultIncludeTerminal: true,
  aiDefaultIncludeFile: true,
  aiDefaultIncludeSelection: true,
  aiFileToolsEnabled: true,
  aiMcpToolsEnabled: true,

  sessionRestoreEnabled: true,

  background: {
    dir: "",
    enabled: false,
    path: "",
    opacity: 100,
    blur: 0,
    fit: "cover",
  },

  accentColor: "#11c700",
  animationsEnabled: true,
  frostedGlass: true,
  panelGaps: 11,
  panelGapStyle: "none",
  panelShadows: true,
  activePanelGlow: true,
  neonBorderGlow: true,
  editorWallpaperOpacity: 0,

  aiMiniOpacity: 35,
  aiMiniFontSize: 11,
  aiMiniBgBlur: 14,
  aiMiniBgDim: 50,
  aiComposerBgStyle: "default",
  aiComposerBgColor: "#000000",
  aiTabPinned: false,
  aiTabColor: undefined,
  aiSidebarWidth: 240,
  aiPanelDock: "left",
  aiComposerSideWidth: 380,
  aiTtsVoice: "",
  setupAssistantDismissed: false,

  notesDirectory: "",
};
const LS_KEY = "huskv2.prefs.v2";

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}") as Partial<Prefs>;
    /* Shallow merge alone would let a stored nested object (e.g. background)
       permanently hide keys added to the defaults later — deep-merge those. */
    const merged = { ...DEFAULT, ...saved };
    merged.background = { ...DEFAULT.background, ...(saved.background ?? {}) };

    /* `dim` was a second black overlay above the wallpaper, while `opacity`
       faded the wallpaper toward the same black underneath it — so the two
       multiplied out to one value, image x opacity x (1 - dim). Only `opacity`
       remains; fold any stored dim into it so an existing wallpaper keeps the
       brightness it had rather than jumping. */
    const legacyDim = (saved.background as { dim?: number } | undefined)?.dim;
    if (typeof legacyDim === "number" && legacyDim > 0) {
      merged.background = {
        ...merged.background,
        opacity: Math.max(10, Math.round((merged.background.opacity * (100 - legacyDim)) / 100)),
      };
      delete (merged.background as { dim?: number }).dim;
    }
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
