import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";
import type { FontFamilyId } from "../styles/fonts";
import { persistNativeConfigSection } from "./nativeConfig";

export type WordWrap = "off" | "on" | "bounded";
export type EditorCursorStyle = "line" | "block" | "underline";
export type TerminalCursorStyle = "block" | "bar" | "underline";
export type LineNumbers = "on" | "off" | "relative";
export type RenderWhitespace = "none" | "boundary" | "all";
export type LineHighlight = "none" | "line" | "gutter" | "all";
export type AiResponseStyle = "concise" | "balanced" | "detailed";
export type AiFontSizeMode = "terminal" | "custom";

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
  /** Byte budget for attached context on a new AI request (8/16/32/64 KB).
      Treated as bytes, not tokens — models tokenize differently. */
  aiContextBudgetKb: number;
  /** Husk-owned actions are available to every provider; signed-in CLIs use
      validated action proposals rather than receiving raw tool access. */
  aiFileToolsEnabled: boolean;
  aiMcpToolsEnabled: boolean;

  // Session
  sessionRestoreEnabled: boolean;

  // Workflows
  /** Notice repeated successful command sequences locally and offer a
      reviewable workflow. No terminal output or file contents are analysed. */
  workflowSuggestionsEnabled: boolean;
  /** Stable hashes only — never the commands themselves. */
  workflowSuggestionDismissals: string[];

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
  /** Follow the terminal at one pixel smaller, or use aiMiniFontSize exactly. */
  aiFontSizeMode: AiFontSizeMode;
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
  aiContextBudgetKb: 32,
  aiFileToolsEnabled: true,
  aiMcpToolsEnabled: true,

  sessionRestoreEnabled: true,

  workflowSuggestionsEnabled: true,
  workflowSuggestionDismissals: [],

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
  aiFontSizeMode: "terminal",
  aiMiniFontSize: 12,
  aiMiniBgBlur: 14,
  aiMiniBgDim: 50,
  aiComposerBgStyle: "default",
  aiComposerBgColor: "#000000",
  aiTabPinned: false,
  aiTabColor: undefined,
  aiSidebarWidth: 240,
  aiPanelDock: "left",
  aiComposerSideWidth: 380,
  setupAssistantDismissed: false,

  notesDirectory: "",
};
export const PREFS_STORAGE_KEY = "huskv2.prefs.v2";

function mergePrefs(saved: Partial<Prefs> & { aiTtsVoice?: unknown }): Prefs {
  // TTS was removed from Husk. Ignore its old persisted key rather than
  // carrying a dead setting forward into localStorage or config.toml.
  const { aiTtsVoice: _legacyTtsVoice, ...current } = saved;
  const merged = { ...DEFAULT, ...current };
  /* Before this mode existed, 11px was Husk's shipped AI size. Treat that
     untouched legacy value as the new readable follow-terminal default, while
     preserving every value a user had deliberately changed as Custom. */
  if (current.aiFontSizeMode !== "terminal" && current.aiFontSizeMode !== "custom") {
    merged.aiFontSizeMode = typeof current.aiMiniFontSize === "number" && current.aiMiniFontSize !== 11
      ? "custom"
      : "terminal";
  }
  /* Shallow merge alone would let a stored nested object (e.g. background)
     permanently hide keys added to the defaults later — deep-merge those. */
  merged.background = { ...DEFAULT.background, ...(current.background ?? {}) };
  merged.workflowSuggestionDismissals = Array.isArray(current.workflowSuggestionDismissals)
    ? current.workflowSuggestionDismissals.filter((value): value is string => typeof value === "string").slice(-100)
    : [];

  /* `dim` was a second black overlay above the wallpaper, while `opacity`
     faded the wallpaper toward the same black underneath it — so the two
     multiplied out to one value, image x opacity x (1 - dim). Only `opacity`
     remains; fold any stored dim into it so an existing wallpaper keeps the
     brightness it had rather than jumping. */
  const legacyDim = (current.background as { dim?: number } | undefined)?.dim;
  if (typeof legacyDim === "number" && legacyDim > 0) {
    merged.background = {
      ...merged.background,
      opacity: Math.max(10, Math.round((merged.background.opacity * (100 - legacyDim)) / 100)),
    };
    delete (merged.background as { dim?: number }).dim;
  }
  return merged;
}

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || "{}") as Partial<Prefs>;
    return mergePrefs(saved);
  } catch {
    return DEFAULT;
  }
}

let state: Prefs = load();
const subscribers = new Set<() => void>();

/* A standalone Settings window has its own module instance. localStorage is
   shared between same-origin Husk webviews, but the in-memory preference state
   is not, so listen for the browser's cross-window storage notification and
   refresh this instance without writing the value back. This keeps wallpaper
   and every other live appearance control in sync with the main workspace. */
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== PREFS_STORAGE_KEY || !event.newValue) return;
    try {
      state = mergePrefs(JSON.parse(event.newValue) as Partial<Prefs>);
      for (const fn of subscribers) fn();
    } catch {
      // Ignore an incomplete/corrupt external value; native config remains the
      // durable source and the current in-memory settings stay usable.
    }
  });
}

export function getPrefs(): Prefs {
  return state;
}

export function setPrefs(patch: Partial<Prefs>): void {
  state = { ...state, ...patch };
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — keep in memory only
  }
  // Custom agents live as individual Markdown files. The compatibility mirror
  // in localStorage still keeps their runtime state synchronous, but TOML never
  // absorbs long prompts or duplicates the agent source of truth.
  const { aiAgents: _agents, ...preferences } = state;
  persistNativeConfigSection("preferences", preferences);
  for (const fn of subscribers) fn();
}

/** Apply the native TOML snapshot at startup without treating it as a new user
 * edit. Agent definitions are loaded separately from ~/.husk/agents/*.md. */
export function hydratePrefsFromNative(
  preferences: Partial<Omit<Prefs, "aiAgents">>,
  aiAgents: AiAgent[],
): void {
  state = mergePrefs({ ...preferences, aiAgents });
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The native file remains the durable source even if browser storage fails.
  }
  for (const fn of subscribers) fn();
}

export function preferencesForNativeConfig(prefs = state): Omit<Prefs, "aiAgents"> {
  const { aiAgents: _agents, ...preferences } = prefs;
  return preferences;
}

export function builtInAiAgents(): AiAgent[] {
  return DEFAULT.aiAgents.map((agent) => ({ ...agent }));
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

export function resolveAiConversationFontSize(
  prefs: Pick<Prefs, "terminalFontSize" | "aiFontSizeMode" | "aiMiniFontSize">,
): number {
  if (prefs.aiFontSizeMode === "custom") {
    return Math.min(18, Math.max(9, Math.round(prefs.aiMiniFontSize)));
  }
  return Math.min(15, Math.max(12, Math.round(prefs.terminalFontSize) - 1));
}
