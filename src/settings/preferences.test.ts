import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPrefs,
  hydratePrefsFromNative,
  preferencesForNativeConfig,
  PREFS_STORAGE_KEY,
  resolveAiConversationFontSize,
  setPrefs,
  type Prefs,
} from "./preferences";
import { persistNativeConfigSection } from "./nativeConfig";

vi.mock("./nativeConfig", () => ({ persistNativeConfigSection: vi.fn() }));

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
