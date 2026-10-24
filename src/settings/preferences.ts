import { useSyncExternalStore } from "react";
import type { TerminalThemePreset } from "../styles/terminalTheme";
import type { FontFamilyId } from "../styles/fonts";
import { persistNativeConfigSection, subscribeNativeConfigDocument } from "./nativeConfig";

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
  /** Show the workspace welcome once per main-app launch, independently of
   * onboarding completion, session restore, and the terminal greeting. */
  showWelcomeOnStartup: boolean;
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
  /** App-rendered welcome for fresh local shells; never injected into the PTY. */
  terminalWelcomeEnabled: boolean;

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
  showWelcomeOnStartup: true,
  userName: "",
  fontFamily: "iosevka",

  terminalFontSize: 13,
  cursorBlink: true,
  terminalCursorStyle: "bar",
  terminalBoldFont: false,
  terminalTheme: "husk",
  terminalScrollback: 1000,
  terminalWelcomeEnabled: true,

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

const PREF_ENUMS: Partial<Record<keyof Prefs, readonly unknown[]>> = {
  theme: ["dark", "light"], fontFamily: ["jetbrains", "meslo", "fira", "source", "cascadia", "plex", "iosevka", "hack", "glasstty", "system"],
  terminalCursorStyle: ["block", "bar", "underline"], terminalTheme: ["husk", "hacker", "ocean", "rose"],
  editorWordWrap: ["off", "on", "bounded"], editorCursorStyle: ["line", "block", "underline"],
  editorLineNumbers: ["on", "off", "relative"], editorWhitespace: ["none", "boundary", "all"],
  editorLineHighlight: ["none", "line", "gutter", "all"], aiResponseStyle: ["concise", "balanced", "detailed"],
  aiFontSizeMode: ["terminal", "custom"], aiContextBudgetKb: [8, 16, 32, 64],
  panelGapStyle: ["none", "dots", "grid", "cross", "gradient"],
  aiComposerBgStyle: ["default", "gradient", "solid"], aiPanelDock: ["left", "right"],
  aiTabColor: ["border-l-red-500", "border-l-blue-500", "border-l-emerald-500", "border-l-violet-500", "border-l-amber-500", "border-l-cyan-500", "border-l-pink-500", "border-l-slate-500"],
};
const PREF_RANGES: Partial<Record<keyof Prefs, readonly [number, number, boolean?]>> = {
  zoomLevel: [0.5, 3], terminalFontSize: [8, 48, true], terminalScrollback: [0, 100_000, true],
  editorFontSize: [8, 48, true], editorTabSize: [1, 8, true], inspectorHeight: [80, 2000, true],
  panelGaps: [0, 12, true], editorWallpaperOpacity: [0, 50], aiMiniOpacity: [10, 100],
  aiMiniFontSize: [9, 18, true], aiMiniBgBlur: [0, 20], aiMiniBgDim: [0, 90],
  aiSidebarWidth: [160, 380, true], aiComposerSideWidth: [280, 620, true],
};
const PREF_STRING_LIMITS: Partial<Record<keyof Prefs, number>> = {
  userName: 80, activeAgentId: 80, pluginsDir: 8192, notesDirectory: 8192,
  aiGlobalInstructions: 32_000, aiPersonalMemory: 32_000, customCSS: 128_000,
};
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function finiteRange(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max && (!integer || Number.isInteger(value));
}
function text(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && !value.includes("\0");
}
function color(value: unknown): value is string { return typeof value === "string" && /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value); }
function validatedAgents(value: unknown): AiAgent[] {
  if (!Array.isArray(value)) return DEFAULT.aiAgents.map((agent) => ({ ...agent }));
  const ids = new Set<string>();
  return value.slice(0, 256).flatMap((candidate) => {
    const agent = record(candidate);
    if (!text(agent.id, 80) || !/^[a-zA-Z0-9_-]+$/.test(agent.id) || ids.has(agent.id)
      || !text(agent.name, 80) || !agent.name.trim() || !text(agent.icon, 64)
      || !text(agent.systemPrompt, 32_000) || !agent.systemPrompt.trim()) return [];
    ids.add(agent.id);
    return [{
      id: agent.id, name: agent.name, icon: agent.icon, systemPrompt: agent.systemPrompt,
      ...(text(agent.model, 256) ? { model: agent.model } : {}),
      ...(text(agent.color, 64) ? { color: agent.color } : {}),
      ...(typeof agent.builtIn === "boolean" ? { builtIn: agent.builtIn } : {}),
    }];
  });
}
function validatedTemplates(value: unknown): PromptTemplate[] {
  if (!Array.isArray(value)) return DEFAULT.aiPromptTemplates.map((template) => ({ ...template }));
  const ids = new Set<string>();
  return value.slice(0, 256).flatMap((candidate) => {
    const template = record(candidate);
    if (!text(template.id, 80) || !template.id || ids.has(template.id)
      || !text(template.label, 160) || !template.label.trim() || !text(template.icon, 64)
      || !text(template.prompt, 32_000) || !template.prompt.trim()) return [];
    ids.add(template.id);
    return [{ id: template.id, label: template.label, icon: template.icon, prompt: template.prompt }];
  });
}

/** Recover invalid fields independently, retaining the user's other choices.
 * Explicit allowlisting also removes retired keys and prototype-shaped input. */
export function validatePreferences(value: unknown): Prefs {
  const current = record(value);
  const merged: Prefs = { ...DEFAULT, background: { ...DEFAULT.background } };
  for (const key of Object.keys(DEFAULT) as (keyof Prefs)[]) {
    const candidate = current[key];
    const fallback = DEFAULT[key];
    const options = PREF_ENUMS[key];
    const range = PREF_RANGES[key];
    let valid = false;
    if (options) valid = options.includes(candidate);
    else if (range) valid = finiteRange(candidate, ...range);
    else if (typeof fallback === "boolean") valid = typeof candidate === "boolean";
    else if (["accentColor", "aiComposerBgColor"].includes(key)) {
      if (color(candidate)) {
        (merged as unknown as Record<string, unknown>)[key] = candidate.length === 4
          ? `#${candidate.slice(1).split("").map(char => char + char).join("")}` : candidate;
      }
      continue;
    }
    else if (typeof fallback === "string" || key === "customCSS") valid = text(candidate, PREF_STRING_LIMITS[key] ?? 8192);
    if (valid) (merged as unknown as Record<string, unknown>)[key] = candidate;
  }
  if (text(current.customCSS, 128_000)) merged.customCSS = current.customCSS;
  const background = record(current.background);
  for (const key of ["enabled", "path", "dir", "opacity", "blur", "fit"] as const) {
    const value = background[key];
    const valid = key === "enabled" ? typeof value === "boolean"
      : key === "path" || key === "dir" ? text(value, 8192)
      : key === "opacity" ? finiteRange(value, 10, 100)
      : key === "blur" ? finiteRange(value, 0, 20)
      : value === "cover" || value === "contain";
    if (valid) (merged.background as unknown as Record<string, unknown>)[key] = value;
  }
  // Preserve the old wallpaper brightness migration, but not invalid dim input.
  if (finiteRange(background.dim, 0, 100) && background.dim > 0) {
    merged.background.opacity = Math.max(10, Math.round(merged.background.opacity * (100 - background.dim) / 100));
  }
  if (current.aiFontSizeMode !== "terminal" && current.aiFontSizeMode !== "custom") {
    merged.aiFontSizeMode = finiteRange(current.aiMiniFontSize, 9, 18, true) && current.aiMiniFontSize !== 11 ? "custom" : "terminal";
  }
  merged.workflowSuggestionDismissals = Array.isArray(current.workflowSuggestionDismissals)
    ? current.workflowSuggestionDismissals.filter((value): value is string => text(value, 256)).slice(-100) : [];
  merged.aiAgents = validatedAgents(current.aiAgents);
  merged.aiPromptTemplates = validatedTemplates(current.aiPromptTemplates);
  if (!merged.aiAgents.some((agent) => agent.id === merged.activeAgentId)) {
    merged.activeAgentId = merged.aiAgents.find((agent) => agent.id === DEFAULT.activeAgentId)?.id ?? merged.aiAgents[0]?.id ?? DEFAULT.activeAgentId;
  }
  return merged;
}
const mergePrefs = validatePreferences;

function load(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_STORAGE_KEY) || "{}") as Partial<Prefs>;
    return mergePrefs(saved);
  } catch {
    return validatePreferences({});
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
  const previous = preferencesForNativeConfig(state);
  state = validatePreferences({ ...state, ...patch });
  try {
    localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable — keep in memory only
  }
  // Custom agents live as individual Markdown files. The compatibility mirror
  // in localStorage still keeps their runtime state synchronous, but TOML never
  // absorbs long prompts or duplicates the agent source of truth.
  const { aiAgents: _agents, ...preferences } = state;
  persistNativeConfigSection("preferences", preferences, previous);
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

subscribeNativeConfigDocument((document) => {
  const next = validatePreferences({ ...document.preferences, aiAgents: state.aiAgents });
  if (JSON.stringify(next) === JSON.stringify(state)) return;
  // Do not write the compatibility mirror here: every native window receives
  // the same event and its own pending edits may differ. Local user edits and
  // startup hydration maintain the browser fallback without event echo loops.
  state = next;
  for (const subscriber of subscribers) subscriber();
});

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
