import { invoke } from "@tauri-apps/api/core";
import { loadAiAgentsFromFiles } from "../ai/agentFiles";
import { PROVIDERS } from "../ai/providers";
import { getBookmarks, replaceBookmarks, type Bookmark } from "../bookmarks/store";
import { hydratePrefsFromNative, getPrefs, builtInAiAgents, validatePreferences, type AiAgent, type Prefs } from "./preferences";
import { applyNativeConfigSections, readLatestNativeConfig, getNativeConfigSnapshot, type HuskConfigDocument } from "./nativeConfig";
import type { AppearancePreset } from "./appearancePresets";

const PREFIX = "husk-settings:v1:";
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_BLOB_LENGTH = 6 * 1024 * 1024;
const SALT_LEN = 16;
const IV_LEN = 12;
const EXCLUDED_PREFS = new Set(["aiAgents", "customCSS", "pluginsDir", "hasSeenWelcome", "setupAssistantDismissed", "workflowSuggestionDismissals"]);
const APPEARANCE_KEYS = new Set(["theme", "accentColor", "animationsEnabled", "frostedGlass", "neonBorderGlow", "panelGaps", "panelGapStyle", "panelShadows", "activePanelGlow", "editorWallpaperOpacity", "aiMiniOpacity", "aiFontSizeMode", "aiMiniFontSize", "aiMiniBgBlur", "aiMiniBgDim", "aiComposerBgStyle", "aiComposerBgColor"]);
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export const BACKUP_EXCLUSIONS = "API keys and keychain references, MCP servers, custom endpoints, SSH connections, command bookmarks, custom CSS, plugin folders, chat, notes, and terminal history are not included.";

export type SettingsBackup = {
  format: "husk-settings";
  version: 1;
  createdAt: string;
  preferences: Partial<Prefs>;
  ai: { providerId?: string; model?: string };
  agents: AiAgent[];
  appearancePresets: AppearancePreset[];
  bookmarks: Bookmark[];
};

export type SettingsImportPreview = {
  backup: SettingsBackup;
  summary: string[];
  warnings: string[];
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected a settings object.");
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, max = 8192): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0")) throw new Error(`Invalid ${name} in backup.`);
  return value;
}

function list(value: unknown, name: string, max = 500): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new Error(`Invalid ${name} in backup.`);
  return value;
}

function unique<T extends { id: string }>(items: T[], name: string): T[] {
  if (new Set(items.map((item) => item.id)).size !== items.length) throw new Error(`Duplicate ${name} IDs in backup.`);
  return items;
}

/** Only recognised preference keys cross the import boundary. Normalisation
 * also bounds numeric values and validates nested preferences. */
function portablePreferences(value: unknown): Partial<Prefs> {
  const input = record(value);
  const validated = validatePreferences(input);
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(input)) {
    if (EXCLUDED_PREFS.has(key) || !hasOwn(validated, key)) continue;
    const candidate = input[key];
    let normal = (validated as unknown as Record<string, unknown>)[key];
    if (typeof candidate !== typeof normal || candidate === null || (Array.isArray(normal) !== Array.isArray(candidate))) throw new Error(`Invalid ${key} in backup.`);
    if (key === "activeAgentId") {
      if (typeof candidate !== "string" || !/^[a-zA-Z0-9_-]{1,80}$/.test(candidate)) throw new Error("Invalid active agent ID in backup.");
      normal = candidate;
    } else if (key === "background") {
      const background: Record<string, unknown> = {};
      const source = record(candidate);
      const clean = record(normal);
      for (const part of ["enabled", "path", "dir", "opacity", "blur", "fit"]) {
        if (!hasOwn(source, part)) continue;
        if (source[part] !== clean[part]) throw new Error(`Invalid background ${part} in backup.`);
        background[part] = clean[part];
      }
      normal = background;
    } else if (key === "aiPromptTemplates") {
      const source = list(candidate, "prompt templates", 256);
      const clean = normal as Prefs["aiPromptTemplates"];
      if (source.length !== clean.length) throw new Error("Invalid prompt templates in backup.");
    } else if ((key === "accentColor" || key === "aiComposerBgColor") && typeof candidate === "string" && /^#[0-9a-f]{3}$/i.test(candidate)) {
      const expanded = `#${[...candidate.slice(1)].map((part) => part + part).join("")}`;
      if (normal !== expanded) throw new Error(`Invalid ${key} in backup.`);
    } else if (candidate !== normal) throw new Error(`Invalid ${key} in backup.`);
    result[key] = normal;
  }
  return result as Partial<Prefs>;
}

function parseAgent(value: unknown): AiAgent {
  const raw = record(value);
  const id = text(raw.id, "agent ID", 80);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) throw new Error("Invalid agent ID in backup.");
  const agent: AiAgent = { id, name: text(raw.name, "agent name", 160), icon: text(raw.icon, "agent icon", 64), systemPrompt: text(raw.systemPrompt, "agent prompt", 32_000) };
  if (!agent.name.trim() || [...agent.name].length > 80 || [...agent.icon].length > 16 || !agent.systemPrompt.trim() || new TextEncoder().encode(agent.systemPrompt).length > 32_000) throw new Error("Invalid agent name, icon, or prompt in backup.");
  if (raw.model !== undefined) agent.model = text(raw.model, "agent model", 300);
  if (raw.color !== undefined) agent.color = text(raw.color, "agent color", 100);
  agent.builtIn = builtInAiAgents().some((shipped) => shipped.id === id);
  return agent;
}

function parsePreset(value: unknown): AppearancePreset {
  const raw = record(value);
  const prefs = portablePreferences(raw.prefs);
  for (const key of Object.keys(prefs)) if (!APPEARANCE_KEYS.has(key)) delete (prefs as Record<string, unknown>)[key];
  const preset: AppearancePreset = { id: text(raw.id, "preset ID", 200), name: text(raw.name, "preset name", 200), description: text(raw.description ?? "", "preset description", 1000), prefs, custom: true };
  if (!preset.id.startsWith("custom:") || !preset.name.trim()) throw new Error("Invalid custom appearance preset in backup.");
  if (raw.background !== undefined) {
    const background = portablePreferences({ background: record(raw.background) }).background!;
    const { path: _path, dir: _dir, ...portable } = background;
    preset.background = portable;
  }
  return preset;
}

function parseBookmark(value: unknown): Bookmark {
  const raw = record(value);
  if (raw.type !== "file" && raw.type !== "directory") throw new Error("Only file and folder bookmarks can be imported.");
  const id = text(raw.id, "bookmark ID", 200);
  const label = text(raw.label, "bookmark label", 1000);
  const path = text(raw.path, "bookmark path");
  if (!id || !label.trim() || !path.trim() || typeof raw.createdAt !== "number" || !Number.isFinite(raw.createdAt)) throw new Error("Invalid bookmark in backup.");
  if (raw.pinned !== undefined && typeof raw.pinned !== "boolean") throw new Error("Invalid bookmark pin in backup.");
  return { id, type: raw.type, label, path, createdAt: raw.createdAt, ...(raw.pinned !== undefined ? { pinned: raw.pinned } : {}) };
}

/** Validate the whole payload before any write. Unknown fields are discarded,
 * never spread into configuration or executable data. */
export function parseSettingsBackup(value: unknown): SettingsBackup {
  const raw = record(value);
  if (raw.format !== "husk-settings" || raw.version !== 1) throw new Error("Unsupported settings backup version. No settings changed.");
  const createdAt = text(raw.createdAt, "backup date", 100);
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("Invalid backup date.");
  const aiRaw = record(raw.ai);
  const ai: SettingsBackup["ai"] = {};
  if (aiRaw.providerId !== undefined) {
    ai.providerId = text(aiRaw.providerId, "AI provider", 100);
    if (!PROVIDERS.some((provider) => provider.id === ai.providerId)) throw new Error("This backup uses an AI provider not supported by this Husk version.");
  }
  if (aiRaw.model !== undefined) {
    ai.model = text(aiRaw.model, "AI model", 300);
    if (!ai.model.trim()) throw new Error("Invalid AI model in backup.");
  }
  return { format: "husk-settings", version: 1, createdAt,
    preferences: portablePreferences(raw.preferences), ai,
    agents: unique(list(raw.agents, "agents").map(parseAgent), "agent"),
    appearancePresets: unique(list(raw.appearancePresets, "appearance presets").map(parsePreset), "preset"),
    bookmarks: unique(list(raw.bookmarks, "bookmarks", 2000).map(parseBookmark), "bookmark"),
  };
}

export function createSettingsBackup(document: HuskConfigDocument, agents: AiAgent[], bookmarks: Bookmark[]): SettingsBackup {
  return parseSettingsBackup({ format: "husk-settings", version: 1, createdAt: new Date().toISOString(),
    preferences: document.preferences,
    ai: { providerId: document.ai.providerId, model: document.ai.model },
    agents,
    appearancePresets: document.appearance_presets.items ?? [],
    bookmarks: bookmarks.filter((bookmark) => bookmark.type !== "command"),
  });
}

function checkPassphrase(passphrase: string, legacy = false) {
  if ((!legacy && passphrase.trim().length < 8) || !passphrase.length || passphrase.length > 1024) throw new Error("Use a passphrase of at least 8 characters (maximum 1,024).");
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, legacy = false): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: legacy ? 100_000 : 600_000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function encodeBase64(bytes: Uint8Array): string {
  // Chunking avoids overflowing the JS argument stack for large backups.
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

async function encrypt(backup: SettingsBackup, passphrase: string): Promise<string> {
  checkPassphrase(passphrase);
  const plaintext = new TextEncoder().encode(JSON.stringify(backup));
  if (plaintext.length > MAX_BYTES) throw new Error("Settings backup exceeds the 4 MiB limit.");
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const combined = new Uint8Array(SALT_LEN + IV_LEN + ciphertext.byteLength);
  combined.set(salt); combined.set(iv, SALT_LEN); combined.set(new Uint8Array(ciphertext), SALT_LEN + IV_LEN);
  return PREFIX + encodeBase64(combined);
}

async function decrypt(blob: string, passphrase: string): Promise<{ value: unknown; legacy: boolean }> {
  const legacy = !blob.startsWith(PREFIX);
  checkPassphrase(passphrase, legacy);
  if (blob.length > MAX_BLOB_LENGTH) throw new Error("Settings backup is too large.");
  try {
    const encoded = legacy ? blob : blob.slice(PREFIX.length);
    const combined = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    if (combined.length < SALT_LEN + IV_LEN + 16) throw new Error("Invalid encrypted data.");
    const key = await deriveKey(passphrase, combined.slice(0, SALT_LEN), legacy);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: combined.slice(SALT_LEN, SALT_LEN + IV_LEN) }, key, combined.slice(SALT_LEN + IV_LEN));
    if (plaintext.byteLength > MAX_BYTES) throw new Error("Too large.");
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)), legacy };
  } catch { throw new Error("Cannot read backup. Check the passphrase and encrypted text."); }
}

async function latestDocument(): Promise<HuskConfigDocument> {
  return readLatestNativeConfig();
}

export async function exportSettings(passphrase: string): Promise<string> {
  checkPassphrase(passphrase);
  const document = await latestDocument();
  const loaded = await loadAiAgentsFromFiles();
  if (loaded.errors.length) throw new Error("Some agent files could not be read. Resolve their errors before exporting.");
  return encrypt(createSettingsBackup(document, loaded.agents, readCurrentBookmarks()), passphrase);
}

export async function prepareSettingsImport(blob: string, passphrase: string): Promise<SettingsImportPreview> {
  const { value, legacy } = await decrypt(blob.trim(), passphrase);
  let backup: SettingsBackup;
  const warnings = [BACKUP_EXCLUSIONS, "Existing items are kept. Matching setting fields and item IDs are updated. Local paths may need changing on another computer."];
  if (legacy) {
    const raw = record(value);
    if (!hasOwn(raw, "huskv2.bookmarks")) throw new Error("This legacy backup has no supported data. Export a new backup from current Husk. No settings changed.");
    const bookmarks = raw["huskv2.bookmarks"];
    if (typeof bookmarks !== "string") throw new Error("This legacy backup has no bookmark data. No settings changed.");
    const supported = list(JSON.parse(bookmarks), "legacy bookmarks", 2000).filter((entry) => record(entry).type !== "command");
    backup = parseSettingsBackup({ format: "husk-settings", version: 1, createdAt: new Date().toISOString(), preferences: {}, ai: {}, agents: [], appearancePresets: [], bookmarks: supported });
    warnings.unshift("Legacy backup: only valid file/folder bookmarks will be merged. Obsolete settings and connection records are not applied.");
  } else backup = parseSettingsBackup(value);
  return { backup, warnings, summary: [
    `${Object.keys(backup.preferences).length} preference fields`,
    Object.keys(backup.ai).length ? "AI provider and model selection" : "No AI selection",
    `${backup.agents.length} agent definitions`, `${backup.appearancePresets.length} appearance presets`, `${backup.bookmarks.length} file/folder bookmarks`,
  ] };
}

function mergeById<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  return [...new Map([...existing, ...incoming].map((item) => [item.id, item])).values()];
}

function readCurrentBookmarks(): Bookmark[] {
  const raw = localStorage.getItem("huskv2.bookmarks");
  if (!raw) return getBookmarks();
  let latest: unknown;
  try { latest = JSON.parse(raw); }
  catch { throw new Error("Existing bookmarks are invalid. Repair or recover them before importing or exporting."); }
  if (!Array.isArray(latest) || latest.length > 2000) throw new Error("Existing bookmarks are invalid. No settings changed.");
  const seen = new Set<string>();
  for (const entry of latest) {
    const item = record(entry);
    if (typeof item.id !== "string" || !item.id || seen.has(item.id)) throw new Error("Existing bookmarks need migration. Open Bookmarks before importing or exporting.");
    if (item.type === "command") {
      if (typeof item.command !== "string" || !item.command.trim() || typeof item.label !== "string" || !item.label.trim() || typeof item.createdAt !== "number" || !Number.isFinite(item.createdAt)) throw new Error("An existing command bookmark is invalid. It has not been modified.");
    } else parseBookmark(item);
    seen.add(item.id);
  }
  return latest as Bookmark[];
}

/** Merge, never a full restore or delete. Config fields commit together; agent
 * files are separate durable resources. Interrupted imports can be retried. */
export async function applySettingsImport(preview: SettingsImportPreview): Promise<void> {
  const backup = parseSettingsBackup(preview.backup);
  const current = await latestDocument();
  const sections: Partial<Omit<HuskConfigDocument, "config_version">> = {};
  if (Object.keys(backup.preferences).length) {
    sections.preferences = { ...current.preferences, ...backup.preferences };
    if (backup.preferences.background) sections.preferences.background = { ...record(current.preferences.background ?? {}), ...backup.preferences.background };
    if (backup.preferences.aiPromptTemplates) sections.preferences.aiPromptTemplates = mergeById(validatePreferences(current.preferences).aiPromptTemplates, backup.preferences.aiPromptTemplates);
  }
  if (Object.keys(backup.ai).length) sections.ai = { ...current.ai, ...backup.ai };
  if (backup.appearancePresets.length) {
    const items = list(current.appearance_presets.items ?? [], "existing presets").map(parsePreset);
    sections.appearance_presets = { ...current.appearance_presets, items: mergeById(items, backup.appearancePresets) };
  }
  if (backup.bookmarks.length) readCurrentBookmarks(); // Preflight before writes.
  try {
    // Reconciliation would delete agents added by another window, so write only
    // the imported IDs, and never call agent_delete.
    for (const agent of backup.agents) await invoke("agent_write", { agent });
    if (Object.keys(sections).length) await applyNativeConfigSections(sections, current);
    if (backup.bookmarks.length) {
      // Re-read after native I/O so other windows' newly added bookmarks are
      // retained. Excluded command bookmarks cannot be replaced by an ID clash.
      const existing = readCurrentBookmarks();
      const commandIds = new Set(existing.filter((item) => item.type === "command").map((item) => item.id));
      const incoming = backup.bookmarks.map((item) => commandIds.has(item.id) ? { ...item, id: crypto.randomUUID() } : item);
      const merged = mergeById(existing, incoming);
      localStorage.setItem("huskv2.bookmarks", JSON.stringify(merged));
      replaceBookmarks(merged);
    }
    if (backup.agents.length) {
      const loaded = await loadAiAgentsFromFiles();
      if (loaded.errors.length) throw new Error("Some agent definitions could not be reloaded.");
      hydratePrefsFromNative(getNativeConfigSnapshot()?.preferences ?? getPrefs(), loaded.agents);
    }
  } catch {
    throw new Error("Import did not finish. Some settings or agent files may already be saved; no items were deleted. Resolve the save error, then retry this import.");
  }
}
