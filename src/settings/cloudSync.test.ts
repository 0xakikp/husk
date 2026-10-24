// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { applyNativeConfigSections, readLatestNativeConfig, type HuskConfigDocument } from "./nativeConfig";
import { getBookmarks, replaceBookmarks, type Bookmark } from "../bookmarks/store";
import { loadAiAgentsFromFiles } from "../ai/agentFiles";
import { createSettingsBackup, parseSettingsBackup, exportSettings, prepareSettingsImport, applySettingsImport, type SettingsBackup } from "./cloudSync";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("./nativeConfig", () => ({ getNativeConfigSnapshot: vi.fn(() => null), subscribeNativeConfigDocument: vi.fn(() => () => {}), persistNativeConfigSection: vi.fn(), applyNativeConfigSections: vi.fn(async () => {}), readLatestNativeConfig: vi.fn() }));
vi.mock("../ai/agentFiles", () => ({ loadAiAgentsFromFiles: vi.fn(async () => ({ agents: [], dir: "/fixture/agents", errors: [] })) }));
vi.mock("../bookmarks/store", () => ({ getBookmarks: vi.fn(() => []), replaceBookmarks: vi.fn() }));

const document = (): HuskConfigDocument => ({ config_version: 1, preferences: { terminalFontSize: 15, userName: "Fixture", background: { opacity: 80, path: "/fixture/image.png", enabled: true } }, ai: { providerId: "local", model: "fixture-model", baseURL: "http://secret:fixture@localhost", keys: { local: "not-for-export" } }, mcp: { servers: [{ env: { SECRET: "not-for-export" }, args: ["--password", "not-for-export"] }] }, appearance_presets: { items: [] } });
const bookmark = (id = "folder"): Bookmark => ({ id, type: "directory", label: "Fixture", path: "/fixture/project", createdAt: 100 });
const agent = { id: "fixture", name: "Fixture", icon: "✨", systemPrompt: "A test agent." };
const backup = (): SettingsBackup => ({ format: "husk-settings", version: 1, createdAt: "2026-10-22T00:00:00.000Z", preferences: { terminalFontSize: 16 }, ai: { providerId: "local", model: "fixture" }, agents: [], appearancePresets: [], bookmarks: [] });

beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks();
  vi.mocked(readLatestNativeConfig).mockResolvedValue(document());
  vi.mocked(applyNativeConfigSections).mockResolvedValue();
  vi.mocked(loadAiAgentsFromFiles).mockResolvedValue({ agents: [], dir: "/fixture/agents", errors: [] });
  vi.mocked(getBookmarks).mockReturnValue([]);
});

describe("versioned settings backup", () => {
  it("exports current config, prompts, agents, presets and file bookmarks but no credential/executable data", () => {
    const doc = document();
    doc.preferences.customCSS = "not-for-export";
    doc.preferences.pluginsDir = "not-for-export";
    doc.preferences.apiKey = "not-for-export";
    doc.preferences.aiPromptTemplates = [{ id: "fixture", label: "Fixture", icon: "x", prompt: "A fixture prompt" }];
    doc.appearance_presets.items = [{ id: "custom:fixture", name: "Fixture", description: "Fixture", prefs: { accentColor: "#11c700" }, background: { blur: 2 } }];
    const result = createSettingsBackup(doc, [agent], [bookmark(), { id: "command", type: "command", label: "Command", command: "echo not-for-export", createdAt: 1 }]);
    expect(result.preferences.terminalFontSize).toBe(15);
    expect(result.preferences.aiPromptTemplates).toHaveLength(1);
    expect(result.agents).toHaveLength(1);
    expect(result.appearancePresets[0].background).toEqual({ blur: 2 });
    expect(result.bookmarks).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("not-for-export");
    expect(JSON.stringify(result)).not.toContain("secret:fixture");
    expect(result.ai).toEqual({ providerId: "local", model: "fixture-model" });
  });

  it("round-trips encryption without writing anything during preview", async () => {
    vi.mocked(loadAiAgentsFromFiles).mockResolvedValue({ agents: [agent], dir: "/fixture", errors: [] });
    vi.mocked(getBookmarks).mockReturnValue([bookmark()]);
    const encrypted = await exportSettings("  private fixture passphrase  ");
    expect(encrypted).toMatch(/^husk-settings:v1:/);
    expect(encrypted).not.toContain("Fixture");
    const preview = await prepareSettingsImport(encrypted, "  private fixture passphrase  ");
    expect(preview.backup.agents[0].id).toBe("fixture");
    expect(preview.summary).toContain("1 file/folder bookmarks");
    expect(applyNativeConfigSections).not.toHaveBeenCalled();
    expect(replaceBookmarks).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
    await expect(prepareSettingsImport(encrypted, "private fixture passphrase")).rejects.toThrow(/Cannot read/);
  });

  it.each(["", "short", "        "])("enforces meaningful minimum passphrase length: %j", async (passphrase) => {
    await expect(exportSettings(passphrase)).rejects.toThrow(/at least 8/);
    expect(readLatestNativeConfig).not.toHaveBeenCalled();
  });

  it.each([
    { ...backup(), version: 99 }, { ...backup(), preferences: { terminalFontSize: "oops" } },
    { ...backup(), preferences: { terminalFontSize: -50 } }, { ...backup(), preferences: { theme: "injected" } },
    { ...backup(), preferences: { background: { enabled: "yes" } } },
    { ...backup(), agents: [{ ...agent, id: "../escape" }] },
    { ...backup(), agents: [{ ...agent, systemPrompt: "😀".repeat(9000) }] },
    { ...backup(), agents: [agent, agent] }, { ...backup(), bookmarks: null },
    { ...backup(), ai: { providerId: "unsupported-provider", model: "fixture" } },
    { ...backup(), bookmarks: [bookmark(), { id: "bad" }] },
    { ...backup(), preferences: { aiPromptTemplates: [{ id: "bad" }] } },
  ])("rejects malformed fields before mutation", (value) => {
    expect(() => parseSettingsBackup(value)).toThrow();
    expect(invoke).not.toHaveBeenCalled(); expect(replaceBookmarks).not.toHaveBeenCalled();
  });

  it("strips unknown keys and prototype-shaped input", () => {
    const value = JSON.parse(JSON.stringify(backup()).replace('"preferences":{"terminalFontSize":16}', '"preferences":{"terminalFontSize":16,"__proto__":{"polluted":true},"apiKey":"fixture-secret"}'));
    expect(parseSettingsBackup(value).preferences).toEqual({ terminalFontSize: 16 });
    expect({}).not.toHaveProperty("polluted");
  });

  it("accepts valid shorthand colors and exports their normalized value", () => {
    const result = parseSettingsBackup({ ...backup(), preferences: { accentColor: "#abc", aiComposerBgColor: "#123" } });
    expect(result.preferences).toEqual({ accentColor: "#aabbcc", aiComposerBgColor: "#112233" });
  });

  it("refuses export when settings or agents cannot be read completely", async () => {
    vi.mocked(readLatestNativeConfig).mockRejectedValueOnce(new Error("Unreadable"));
    await expect(exportSettings("fixture passphrase")).rejects.toThrow("Unreadable");
    vi.mocked(loadAiAgentsFromFiles).mockResolvedValueOnce({ agents: [], dir: "/fixture", errors: ["failed"] });
    await expect(exportSettings("fixture passphrase")).rejects.toThrow(/agent files/);
  });

  it("merges settings, nested background, prompts and bookmarks without replacing missing sections", async () => {
    const current = document();
    current.preferences.aiPromptTemplates = [{ id: "existing", label: "Existing", icon: "x", prompt: "Keep me" }];
    vi.mocked(readLatestNativeConfig).mockResolvedValue(current);
    localStorage.setItem("huskv2.bookmarks", JSON.stringify([bookmark("existing"), { id: "cmd", type: "command", label: "Keep", command: "echo keep", createdAt: 1 }]));
    const next = { ...backup(), preferences: { background: { blur: 3 }, aiPromptTemplates: [{ id: "new", label: "New", icon: "x", prompt: "Import" }] }, agents: [agent], bookmarks: [bookmark("new")] } as SettingsBackup;
    await applySettingsImport({ backup: next, summary: [], warnings: [] });
    expect(applyNativeConfigSections).toHaveBeenCalledWith({ preferences: expect.objectContaining({ terminalFontSize: 15, background: expect.objectContaining({ path: "/fixture/image.png", opacity: 80, blur: 3 }), aiPromptTemplates: expect.arrayContaining([expect.objectContaining({ id: "existing" }), expect.objectContaining({ id: "new" })]) }), ai: expect.objectContaining({ providerId: "local", model: "fixture", baseURL: "http://secret:fixture@localhost" }) }, current);
    expect(replaceBookmarks).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ id: "existing" }), expect.objectContaining({ id: "new" }), expect.objectContaining({ id: "cmd" })]));
    expect(invoke).toHaveBeenCalledWith("agent_write", { agent: expect.objectContaining({ id: "fixture" }) });
    expect(invoke).not.toHaveBeenCalledWith("agent_delete", expect.anything());
  });

  it("does not clear bookmarks when backup omits them, and rejects existing corruption before writing", async () => {
    await applySettingsImport({ backup: backup(), summary: [], warnings: [] });
    expect(replaceBookmarks).not.toHaveBeenCalled();
    vi.clearAllMocks(); localStorage.setItem("huskv2.bookmarks", "{}");
    await expect(applySettingsImport({ backup: { ...backup(), bookmarks: [bookmark()] }, summary: [], warnings: [] })).rejects.toThrow(/Existing bookmarks/);
    expect(applyNativeConfigSections).not.toHaveBeenCalled(); expect(invoke).not.toHaveBeenCalled();
  });

  it("reports an incomplete import when durable saving fails, not success", async () => {
    vi.mocked(applyNativeConfigSections).mockRejectedValueOnce(new Error("disk full"));
    await expect(applySettingsImport({ backup: backup(), summary: [], warnings: [] })).rejects.toThrow(/did not finish/);
    expect(replaceBookmarks).not.toHaveBeenCalled();
  });

  it("preserves bookmarks added while native saving is in progress, including colliding excluded commands", async () => {
    vi.mocked(applyNativeConfigSections).mockImplementationOnce(async () => {
      localStorage.setItem("huskv2.bookmarks", JSON.stringify([bookmark("added-concurrently"), { id: "incoming", type: "command", label: "Keep", command: "echo keep", createdAt: 1 }]));
    });
    await applySettingsImport({ backup: { ...backup(), bookmarks: [bookmark("incoming")] }, summary: [], warnings: [] });
    const stored = JSON.parse(localStorage.getItem("huskv2.bookmarks")!);
    expect(stored).toEqual(expect.arrayContaining([expect.objectContaining({ id: "added-concurrently" }), expect.objectContaining({ id: "incoming", type: "command" }), expect.objectContaining({ type: "directory", id: expect.any(String) })]));
    expect(stored).toHaveLength(3);
  });

  it("refuses structurally corrupt existing bookmarks without discarding recoverable entries", async () => {
    const original = JSON.stringify([bookmark("keep"), { id: "broken", type: "file" }]);
    localStorage.setItem("huskv2.bookmarks", original);
    await expect(applySettingsImport({ backup: { ...backup(), bookmarks: [bookmark()] }, summary: [], warnings: [] })).rejects.toThrow();
    expect(localStorage.getItem("huskv2.bookmarks")).toBe(original);
    expect(invoke).not.toHaveBeenCalled(); expect(applyNativeConfigSections).not.toHaveBeenCalled();
  });
});

async function legacyBlob(value: unknown, passphrase = "old") {
  const salt = new Uint8Array(16).fill(1);
  const iv = new Uint8Array(12).fill(2);
  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(value)));
  const result = new Uint8Array(28 + ciphertext.byteLength); result.set(salt); result.set(iv, 16); result.set(new Uint8Array(ciphertext), 28);
  return btoa(String.fromCharCode(...result));
}

describe("legacy settings backups", () => {
  it("previews only valid portable bookmarks, without importing obsolete connection or settings blobs", async () => {
    const encrypted = await legacyBlob({ "huskv2.bookmarks": JSON.stringify([bookmark(), { id: "cmd", type: "command", command: "fixture-secret" }]), "huskv2.connections": "fixture-secret", "huskv2.settings": "{\"fontSize\":999}" });
    const preview = await prepareSettingsImport(encrypted, "old");
    expect(preview.warnings[0]).toContain("Legacy backup");
    expect(preview.backup.bookmarks).toEqual([bookmark()]);
    expect(preview.backup.preferences).toEqual({});
    expect(JSON.stringify(preview)).not.toContain("fixture-secret");
    expect(applyNativeConfigSections).not.toHaveBeenCalled();
  });
  it.each([null, "not json", "{}", '[{"bad":"entry"}]'])("rejects broken legacy bookmarks instead of clearing current ones: %j", async (value) => {
    const encrypted = await legacyBlob({ "huskv2.bookmarks": value });
    await expect(prepareSettingsImport(encrypted, "old")).rejects.toThrow();
    expect(replaceBookmarks).not.toHaveBeenCalled();
  });
});
