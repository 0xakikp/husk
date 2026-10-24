// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HuskConfigDocument } from "./nativeConfig";

const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: null as null | ((event: { payload: { path: string; document: HuskConfigDocument; revision: number } }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async (_name, listener) => { fixture.listener = listener; return () => {}; }) }));
const configDocument = (): HuskConfigDocument => ({ config_version: 1,
  preferences: { terminalFontSize: 13, editorFontSize: 13, background: { opacity: 100, blur: 0, enabled: false, path: "", dir: "", fit: "cover" } },
  ai: {}, mcp: {}, appearance_presets: {},
});

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); localStorage.clear(); fixture.invoke.mockReset(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("live preference coordination", () => {
  async function initialise() {
    const native = await import("./nativeConfig");
    const prefs = await import("./preferences");
    const document = configDocument();
    await native.initialiseNativeConfig({ path: "/fixture/config.toml", exists: true, error: null, document, revision: 0 }, document);
    prefs.hydratePrefsFromNative(document.preferences, prefs.builtInAiAgents());
    return { native, prefs, document };
  }

  it("updates native-backed runtime settings without queuing an echo write", async () => {
    const { native, prefs, document } = await initialise();
    document.preferences.terminalFontSize = 18;
    fixture.listener!({ payload: { path: "/fixture/config.toml", document, revision: 1 } });
    expect(prefs.getPrefs().terminalFontSize).toBe(18);
    expect(native.getNativeConfigStatus().dirty).toBe(false);
    await native.flushNativeConfig();
    expect(fixture.invoke).not.toHaveBeenCalled();
  });

  it("does not turn a cross-window browser update into a stale native snapshot write", async () => {
    const { native, prefs, document } = await initialise();
    const stored = { ...prefs.getPrefs(), terminalFontSize: 18 };
    window.dispatchEvent(new StorageEvent("storage", { key: prefs.PREFS_STORAGE_KEY, newValue: JSON.stringify(stored) }));
    expect(prefs.getPrefs().terminalFontSize).toBe(18);
    prefs.setPrefs({ editorFontSize: 16 });
    fixture.invoke.mockResolvedValue({ path: "/fixture/config.toml", document: { ...document, preferences: { ...document.preferences, terminalFontSize: 18, editorFontSize: 16 } }, revision: 1 });
    await native.flushNativeConfig();
    expect(fixture.invoke).toHaveBeenCalledWith("config_patch", { patches: [{ path: ["preferences", "editorFontSize"], value: 16 }] });
    expect(prefs.getPrefs()).toMatchObject({ terminalFontSize: 18, editorFontSize: 16 });
  });

  it("keeps pending nested wallpaper changes while an unrelated foreign edit arrives", async () => {
    const { native, prefs, document } = await initialise();
    prefs.setPrefs({ background: { ...prefs.getPrefs().background, opacity: 55 } });
    document.preferences.terminalFontSize = 18;
    fixture.listener!({ payload: { path: "/fixture/config.toml", document, revision: 1 } });
    expect(prefs.getPrefs()).toMatchObject({ terminalFontSize: 18, background: { opacity: 55 } });
    expect(native.getNativeConfigStatus().dirty).toBe(true);
  });
});
