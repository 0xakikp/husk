import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPrefs,
  hydratePrefsFromNative,
  preferencesForNativeConfig,
  PREFS_STORAGE_KEY,
  resolveAiConversationFontSize,
  setPrefs,
  validatePreferences,
  type Prefs,
} from "./preferences";
import { persistNativeConfigSection } from "./nativeConfig";

vi.mock("./nativeConfig", () => ({ persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: vi.fn(() => () => {}) }));

describe("resolveAiConversationFontSize", () => {
  it("follows terminal text at one pixel smaller", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(13);
  });

  it("keeps followed text within the readable 12–15px range", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 11, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(12);
    expect(resolveAiConversationFontSize({ terminalFontSize: 18, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(15);
  });

  it("uses and bounds the independent custom size", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "custom", aiMiniFontSize: 16 })).toBe(16);
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "custom", aiMiniFontSize: 30 })).toBe(18);
  });
});

describe("preference validation", () => {
  it.each([null, false, 2, "settings", [], [null]])("recovers a malformed root %j", (value) => {
    expect(validatePreferences(value)).toMatchObject({ terminalFontSize: 13, theme: "dark", background: { opacity: 100 } });
  });

  it("recovers individual fields without dropping unrelated preferences", () => {
    const result = validatePreferences({
      terminalFontSize: "90", terminalScrollback: -1, zoomLevel: Infinity,
      editorMinimap: "false", theme: "solarized", fontFamily: "missing",
      userName: "Alex", editorFontSize: 16, terminalWelcomeEnabled: false,
      aiContextBudgetKb: 999, aiPanelDock: "top", aiMiniFontSize: NaN,
    });
    expect(result).toMatchObject({
      terminalFontSize: 13, terminalScrollback: 1000, zoomLevel: 1,
      editorMinimap: false, theme: "dark", fontFamily: "iosevka", userName: "Alex",
      editorFontSize: 16, terminalWelcomeEnabled: false, aiContextBudgetKb: 32,
      aiPanelDock: "left", aiMiniFontSize: 12,
    });
  });

  it("validates nested background fields and preserves brightness migration", () => {
    expect(validatePreferences({ background: { enabled: true, path: "/fixture/image.png", dir: [], opacity: 70, blur: "2", fit: "invalid", dim: 20 } }).background)
      .toEqual({ enabled: true, path: "/fixture/image.png", dir: "", opacity: 56, blur: 0, fit: "cover" });
    expect(validatePreferences({ background: null }).background.opacity).toBe(100);
    expect(validatePreferences({ background: { opacity: 80, dim: Infinity } }).background.opacity).toBe(80);
  });

  it("discards invalid list entries individually and removes unknown/retired keys", () => {
    const validAgent = { id: "reviewer", name: "Reviewer", icon: "R", systemPrompt: "Review carefully." };
    const result = validatePreferences({
      aiAgents: [null, {}, validAgent, validAgent, { ...validAgent, id: "../unsafe" }],
      activeAgentId: "missing",
      aiPromptTemplates: [null, { id: "explain", label: "Explain", icon: "?", prompt: "Explain this." }, { id: "bad", prompt: 22 }],
      workflowSuggestionDismissals: [null, "a", 1, "b"],
      unknown: true, aiTtsVoice: "retired", customCSS: ".test { color: red; }",
    });
    expect(result.aiAgents).toEqual([validAgent]);
    expect(result.activeAgentId).toBe("reviewer");
    expect(result.aiPromptTemplates).toHaveLength(1);
    expect(result.workflowSuggestionDismissals).toEqual(["a", "b"]);
    expect(result).not.toHaveProperty("unknown");
    expect(result).not.toHaveProperty("aiTtsVoice");
    expect(result.customCSS).toBe(".test { color: red; }");
  });

  it("validates colors, optional values, enum choices and finite numeric bounds", () => {
    expect(validatePreferences({ accentColor: "url(script)", aiTabColor: "border-l-amber-500", setupAssistantDismissed: "yes", panelGaps: 1000, aiComposerSideWidth: 100_000 }))
      .toMatchObject({ accentColor: "#11c700", aiTabColor: "border-l-amber-500", setupAssistantDismissed: false, panelGaps: 11, aiComposerSideWidth: 380 });
    expect(validatePreferences({ terminalScrollback: 0, editorTabSize: 3, zoomLevel: 1.2, aiContextBudgetKb: 64 }))
      .toMatchObject({ terminalScrollback: 0, editorTabSize: 3, zoomLevel: 1.2, aiContextBudgetKb: 64 });
    expect(validatePreferences({ accentColor: "#AbC", aiComposerBgColor: "#123" }))
      .toMatchObject({ accentColor: "#AAbbCC", aiComposerBgColor: "#112233" });
  });

  it("returns independent nested defaults and keeps AI font migration", () => {
    const first = validatePreferences({});
    first.background.opacity = 10;
    first.aiAgents[0].name = "Changed";
    expect(validatePreferences({}).background.opacity).toBe(100);
    expect(validatePreferences({}).aiAgents[0].name).toBe("Architect");
    expect(validatePreferences({ aiMiniFontSize: 11 }).aiFontSizeMode).toBe("terminal");
    expect(validatePreferences({ aiMiniFontSize: 15 }).aiFontSizeMode).toBe("custom");
  });
});

describe("terminal welcome preference", () => {
  const originalPrefs = getPrefs();
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    hydratePrefsFromNative({}, originalPrefs.aiAgents);
    vi.mocked(persistNativeConfigSection).mockClear();
  });

  afterEach(() => {
    hydratePrefsFromNative(originalPrefs, originalPrefs.aiAgents);
    vi.unstubAllGlobals();
  });

  it("defaults on for new and existing configurations without the setting", async () => {
    expect(getPrefs().terminalWelcomeEnabled).toBe(true);
    expect(preferencesForNativeConfig().terminalWelcomeEnabled).toBe(true);
    storage.set(PREFS_STORAGE_KEY, JSON.stringify({ terminalFontSize: 14 }));
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(reloaded.getPrefs().terminalWelcomeEnabled).toBe(true);
    expect(reloaded.getPrefs().terminalFontSize).toBe(14);
  });

  it("persists disabling to native config and the browser fallback, including reload", async () => {
    setPrefs({ terminalWelcomeEnabled: false });
    expect(getPrefs().terminalWelcomeEnabled).toBe(false);
    expect(JSON.parse(storage.get(PREFS_STORAGE_KEY)!).terminalWelcomeEnabled).toBe(false);
    expect(persistNativeConfigSection).toHaveBeenCalledWith(
      "preferences",
      expect.objectContaining({ terminalWelcomeEnabled: false }),
      expect.objectContaining({ terminalWelcomeEnabled: true }),
    );
    const nativePreferences = preferencesForNativeConfig();
    hydratePrefsFromNative(nativePreferences, originalPrefs.aiAgents);
    expect(getPrefs().terminalWelcomeEnabled).toBe(false);
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(reloaded.getPrefs().terminalWelcomeEnabled).toBe(false);
  });

  it("can re-enable the welcome after disabling it", () => {
    hydratePrefsFromNative({ terminalWelcomeEnabled: false }, originalPrefs.aiAgents);
    setPrefs({ terminalWelcomeEnabled: true });
    expect(getPrefs().terminalWelcomeEnabled).toBe(true);
    expect(preferencesForNativeConfig().terminalWelcomeEnabled).toBe(true);
  });

  it.each([undefined, null, "false", 0, {}, []])("defaults safely for invalid stored value %j", (value) => {
    hydratePrefsFromNative(
      { terminalWelcomeEnabled: value } as unknown as Partial<Prefs>,
      originalPrefs.aiAgents,
    );
    expect(getPrefs().terminalWelcomeEnabled).toBe(true);
  });
});

describe("startup welcome preference", () => {
  const originalPrefs = getPrefs();
  let storage: Map<string, string>;

  beforeEach(() => {
    storage = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    });
    hydratePrefsFromNative({}, originalPrefs.aiAgents);
    vi.mocked(persistNativeConfigSection).mockClear();
  });

  afterEach(() => {
    hydratePrefsFromNative(originalPrefs, originalPrefs.aiAgents);
    vi.unstubAllGlobals();
  });

  it("defaults on for a new installation", () => {
    expect(getPrefs().showWelcomeOnStartup).toBe(true);
    expect(preferencesForNativeConfig().showWelcomeOnStartup).toBe(true);
    expect(getPrefs().hasSeenWelcome).toBe(false);
  });

  it("enables startup welcome when migrating an existing native configuration", () => {
    hydratePrefsFromNative({
      hasSeenWelcome: true,
      sessionRestoreEnabled: false,
      terminalWelcomeEnabled: false,
      userName: "Alex",
    }, originalPrefs.aiAgents);
    expect(getPrefs()).toMatchObject({
      showWelcomeOnStartup: true,
      hasSeenWelcome: true,
      sessionRestoreEnabled: false,
      terminalWelcomeEnabled: false,
      userName: "Alex",
    });
    expect(persistNativeConfigSection).not.toHaveBeenCalled();
  });

  it("enables startup welcome when migrating the browser fallback", async () => {
    storage.set(PREFS_STORAGE_KEY, JSON.stringify({ hasSeenWelcome: true, terminalWelcomeEnabled: false }));
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(reloaded.getPrefs()).toMatchObject({
      showWelcomeOnStartup: true,
      hasSeenWelcome: true,
      terminalWelcomeEnabled: false,
    });
  });

  it("persists an opt-out to native config and the browser fallback, including reload", async () => {
    setPrefs({ showWelcomeOnStartup: false });
    expect(getPrefs().showWelcomeOnStartup).toBe(false);
    expect(JSON.parse(storage.get(PREFS_STORAGE_KEY)!).showWelcomeOnStartup).toBe(false);
    expect(persistNativeConfigSection).toHaveBeenCalledWith(
      "preferences",
      expect.objectContaining({ showWelcomeOnStartup: false }),
      expect.objectContaining({ showWelcomeOnStartup: true }),
    );
    hydratePrefsFromNative(preferencesForNativeConfig(), originalPrefs.aiAgents);
    expect(getPrefs().showWelcomeOnStartup).toBe(false);
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(reloaded.getPrefs().showWelcomeOnStartup).toBe(false);
  });

  it("can be re-enabled without changing onboarding, session restore, or terminal greeting", () => {
    hydratePrefsFromNative({
      showWelcomeOnStartup: false,
      hasSeenWelcome: true,
      sessionRestoreEnabled: false,
      terminalWelcomeEnabled: false,
    }, originalPrefs.aiAgents);
    setPrefs({ showWelcomeOnStartup: true });
    expect(getPrefs()).toMatchObject({
      showWelcomeOnStartup: true,
      hasSeenWelcome: true,
      sessionRestoreEnabled: false,
      terminalWelcomeEnabled: false,
    });
  });

  it.each([undefined, null, "false", 0, {}, []])("defaults safely for invalid native value %j", (value) => {
    hydratePrefsFromNative(
      { showWelcomeOnStartup: value } as unknown as Partial<Prefs>,
      originalPrefs.aiAgents,
    );
    expect(getPrefs().showWelcomeOnStartup).toBe(true);
  });

  it.each([null, "false", 0, {}, []])("defaults safely for invalid browser value %j", async (value) => {
    storage.set(PREFS_STORAGE_KEY, JSON.stringify({ showWelcomeOnStartup: value, hasSeenWelcome: true }));
    vi.resetModules();
    const reloaded = await import("./preferences");
    expect(reloaded.getPrefs().showWelcomeOnStartup).toBe(true);
    expect(reloaded.getPrefs().hasSeenWelcome).toBe(true);
  });
});
