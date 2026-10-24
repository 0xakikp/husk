export const SETTINGS_AREAS = [
  { id: "config", label: "Workspace", description: "Editor, terminal, and startup", group: "Workspace", mark: "⌘", keywords: "general profile name notes workflow routine suggestions automation session" },
  { id: "appearance", label: "Appearance", description: "Theme, wallpaper, and effects", group: "Workspace", mark: "◐", keywords: "color opacity blur glow font custom css presets" },
  { id: "models", label: "AI & Models", description: "Default model and provider access", group: "AI", mark: "✦", keywords: "api key anthropic openai claude deepseek local endpoint credentials" },
  { id: "agents", label: "Agents", description: "Personas and assistant behavior", group: "AI", mark: "◎", keywords: "system prompt composer instructions memory response style" },
  { id: "prompts", label: "Prompts", description: "Templates and quick actions", group: "AI", mark: "✎", keywords: "slash commands" },
  { id: "mcp", label: "Integrations", description: "MCP servers and tools", group: "AI", mark: "⊹", keywords: "protocol arguments environment command" },
  { id: "tools", label: "Command tools", description: "CLI tools and setup", group: "System", mark: "⌁", keywords: "install eza bat fzf" },
  { id: "sync", label: "Backup & transfer", description: "Encrypted export and import", group: "System", mark: "↔", keywords: "sync cloud backup passphrase" },
  { id: "crash", label: "Privacy", description: "Crash reports and telemetry", group: "System", mark: "◉", keywords: "sentry errors consent" },
  { id: "manifest", label: "About Husk", description: "Version, updates, and support", group: "System", mark: "i", keywords: "manifest license github" },
] as const;
export type SettingsAreaId = typeof SETTINGS_AREAS[number]["id"];
export type SettingsSearchResult = { area: SettingsAreaId; label: string; target?: string; keywords: string };

// Metadata only: never index credentials, prompt contents, or user paths.
const workspaceFields = [
  ["name", "Profile name", "greeting username"],
  ["showWelcomeOnStartup", "Show welcome on startup", "launch welcome page"],
  ["enabled", "Enable AI", "assistant chat"],
  ["vimMode", "Vim mode", "editor keybindings"],
  ["editor.cursorBlink", "Editor cursor blink", "caret"],
  ["minimap", "Editor minimap", "code overview"],
  ["stickyScroll", "Editor sticky scroll", "pin function class"],
  ["editor.fontSize", "Editor font size", "text pixels"],
  ["tabSize", "Editor tab size", "indent spaces"],
  ["wordWrap", "Editor word wrap", "long lines"],
  ["lineNumbers", "Editor line numbers", "gutter relative"],
  ["editor.cursorStyle", "Editor cursor style", "caret shape"],
  ["lineHighlight", "Editor line highlight", "rectangle border active line"],
  ["whitespace", "Editor whitespace", "spaces tabs dots"],
  ["ligatures", "Editor font ligatures", "glyphs"],
  ["bracketColors", "Editor bracket colors", "matching pairs"],
  ["smoothScroll", "Editor smooth scroll", "animation"],
  ["formatOnPaste", "Editor format on paste", "reindent"],
  ["showHiddenFiles", "Show hidden files", "explorer dotfiles"],
  ["restoreSession", "Restore session", "tabs pane splits directories startup"],
  ["welcomeBanner", "Terminal welcome greeting", "ascii banner"],
  ["terminal.cursorBlink", "Terminal cursor blink", "caret"],
  ["terminal.fontSize", "Terminal font size", "text pixels"],
  ["theme", "Terminal theme", "color palette"],
  ["fontFamily", "Terminal font family", "typeface"],
  ["boldFont", "Terminal bold font", "text weight"],
  ["scrollback", "Terminal scrollback", "history lines"],
  ["terminal.cursorStyle", "Terminal cursor style", "caret shape"],
  ["notesDirectory", "Notes directory", "vault folder path"],
];
const appearanceFields = ["Accent", "Enabled", "Fit", "Opacity", "Blur", "Editor opacity", "Wallpaper folder", "Animations", "Frosted glass", "Neon border glow", "Panel shadows", "Active panel glow", "Panel gaps", "Gap pattern", "Dock", "AI opacity", "Conversation text", "Background blur", "Background dim", "Background style", "Background color"];
const entries: SettingsSearchResult[] = [
  ...SETTINGS_AREAS.map(area => ({ area: area.id, label: area.label, keywords: `${area.description} ${area.keywords}` })),
  ...workspaceFields.map(([target, label, keywords]) => ({ area: "config" as const, label, target, keywords })),
  ...appearanceFields.map(label => ({ area: "appearance" as const, label: label === "Enabled" ? "Wallpaper enabled" : label, target: `appearance.${label}`, keywords: "appearance wallpaper effects composer" })),
  ...["responseStyle", "globalInstructions", "personalMemory", "contextBudget", "includeTerminal", "includeCurrentFile", "includeSelection", "workspaceFileTools", "connectedMcpTools", "activeAgent"].map(target => ({ area: "agents" as const, label: target.replace(/([a-z])([A-Z])/g, "$1 $2"), target, keywords: "AI agents" })),
  { area: "models", label: "Default model", target: "defaultModel", keywords: "AI provider composer" },
];
function normalize(value: string): string { return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function searchSettings(query: string): SettingsSearchResult[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return entries.filter(entry => {
    const area = SETTINGS_AREAS.find(area => area.id === entry.area)!;
    const haystack = normalize(`${entry.label} ${entry.target ?? ""} ${entry.keywords} ${area.label}`);
    const compact = haystack.replace(/\s+/g, "");
    return tokens.every(token => haystack.includes(token) || compact.includes(token));
  }).sort((a, b) => Number(normalize(b.label) === normalize(query)) - Number(normalize(a.label) === normalize(query)));
}
