// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  keychain: new Map<string, string>(),
  listeners: new Map<string, (event: { payload: Record<string, unknown> }) => void>(),
}));
vi.mock("../secrets", () => ({
  secretsGetAll: vi.fn(async (ids: string[]) => ids.map((id) => fixtures.keychain.get(id) ?? null)),
  secretsSet: vi.fn(async (id: string, value: string) => { fixtures.keychain.set(id, value); }),
  secretsDelete: vi.fn(async (id: string) => { fixtures.keychain.delete(id); }),
}));
vi.mock("../settings/nativeConfig", () => ({ persistNativeConfigSection: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async (name: string, listener: (event: { payload: Record<string, unknown> }) => void) => { fixtures.listeners.set(name, listener); return () => fixtures.listeners.delete(name); }),
}));
import { secretsGetAll, secretsSet } from "../secrets";
import { emit } from "@tauri-apps/api/event";
import { PROVIDERS } from "./providers";

const KEY = "huskv2.ai.config";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  fixtures.keychain.clear();
  fixtures.listeners.clear();
});
afterEach(() => vi.useRealTimers());

describe("AI key migration", () => {
  it("migrates keys before native hydration removes the legacy configuration", async () => {
    localStorage.setItem(KEY, JSON.stringify({ providerId: "openai", model: "gpt-4.1", baseURL: "", keys: { openai: "fixture-legacy-key" } }));
    const store = await import("./store");
    await store.initKeys();
    expect(secretsSet).toHaveBeenCalledWith("openai", "fixture-legacy-key");
    expect(fixtures.keychain.get("openai")).toBe("fixture-legacy-key");
    store.hydrateAiConfigFromNative({ providerId: "anthropic", model: "claude-sonnet-5", baseURL: "" });
    expect(store.getKey("openai")).toBe("fixture-legacy-key");
    expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty("keys");
  });

  it("retains the only recoverable legacy key after a failed migration and native hydration", async () => {
    localStorage.setItem(KEY, JSON.stringify({ providerId: "openai", keys: { openai: "fixture-retained-key" } }));
    vi.mocked(secretsSet).mockRejectedValueOnce(new Error("keychain is locked"));
    const store = await import("./store");
    await store.initKeys();
    store.hydrateAiConfigFromNative({ providerId: "anthropic", model: "claude-sonnet-5" });
    expect(store.getKey("openai")).toBe("fixture-retained-key");
    expect(JSON.parse(localStorage.getItem(KEY)!).keys.openai).toBe("fixture-retained-key");
    vi.useFakeTimers();
    store.setKey("openai", "fixture-retained-key");
    await vi.advanceTimersByTimeAsync(400);
    expect(fixtures.keychain.get("openai")).toBe("fixture-retained-key");
    expect(JSON.parse(localStorage.getItem(KEY)!)).not.toHaveProperty("keys");
  });

  it("keeps legacy keys recoverable when the keychain cannot be read at startup", async () => {
    localStorage.setItem(KEY, JSON.stringify({ providerId: "openai", keys: { openai: "fixture-offline-key" } }));
    vi.mocked(secretsGetAll).mockRejectedValueOnce(new Error("keychain unavailable"));
    const store = await import("./store");
    await store.initKeys();
    store.hydrateAiConfigFromNative({ providerId: "openai", model: "gpt-4.1" });
    expect(store.getKey("openai")).toBe("fixture-offline-key");
    expect(JSON.parse(localStorage.getItem(KEY)!).keys.openai).toBe("fixture-offline-key");
  });
});

describe("provider configuration", () => {
  it("preserves an arbitrary local model and its endpoint after reload", async () => {
    const store = await import("./store");
    store.updateConfig({ providerId: "local", model: "my-custom-model:quantized", baseURL: "http://localhost:4321/v1" });
    vi.resetModules();
    const reloaded = await import("./store");
    expect(reloaded.loadConfig()).toMatchObject({ providerId: "local", model: "my-custom-model:quantized", baseURL: "http://localhost:4321/v1" });
  });

  it("does not retain the old shared endpoint when a named provider is loaded", async () => {
    localStorage.setItem(KEY, JSON.stringify({ providerId: "deepseek", model: "deepseek-v4-pro", baseURL: "http://previous-provider.invalid/v1" }));
    const store = await import("./store");
    expect(store.loadConfig().baseURL).toBe(PROVIDERS.find((provider) => provider.id === "deepseek")!.baseURL);
  });

  it("keeps a local endpoint scoped to Local when switching providers and back", async () => {
    const store = await import("./store");
    store.updateConfig({ providerId: "local", model: "local-special", baseURL: "http://localhost:4321/v1" });
    store.updateConfig({ providerId: "groq" });
    expect(store.loadConfig().baseURL).toBe(PROVIDERS.find((provider) => provider.id === "groq")!.baseURL);
    store.updateConfig({ providerId: "local" });
    expect(store.loadConfig().baseURL).toBe("http://localhost:4321/v1");
  });
});

describe("AI settings across windows", () => {
  it("refreshes credentials from the keychain after a key-change invalidation event", async () => {
    fixtures.keychain.set("openai", "fixture-old-key");
    const store = await import("./store");
    await store.initKeys();
    await store.initialiseAiSync();
    expect(store.getKey("openai")).toBe("fixture-old-key");
    fixtures.keychain.set("openai", "fixture-other-window-key");
    fixtures.listeners.get("husk-ai-keys-changed")!({ payload: { source: "another-window" } });
    await vi.waitFor(() => expect(store.getKey("openai")).toBe("fixture-other-window-key"));
  });

  it("broadcasts key invalidation without including credentials in the event payload", async () => {
    vi.useFakeTimers();
    const store = await import("./store");
    store.setKey("openai", "fixture-must-stay-private");
    await vi.advanceTimersByTimeAsync(400);
    expect(emit).toHaveBeenCalledWith("husk-ai-keys-changed", { source: expect.any(String) });
    expect(JSON.stringify(vi.mocked(emit).mock.calls)).not.toContain("fixture-must-stay-private");
  });

  it("does not overwrite a locally edited key with a concurrent keychain refresh", async () => {
    vi.useFakeTimers();
    fixtures.keychain.set("openai", "fixture-old-key");
    const store = await import("./store");
    await store.initKeys();
    await store.initialiseAiSync();
    store.setKey("openai", "fixture-being-edited");
    fixtures.listeners.get("husk-ai-keys-changed")!({ payload: { source: "another-window" } });
    await Promise.resolve();
    expect(store.getKey("openai")).toBe("fixture-being-edited");
    await vi.advanceTimersByTimeAsync(400);
    expect(fixtures.keychain.get("openai")).toBe("fixture-being-edited");
  });
});
