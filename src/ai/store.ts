import { useSyncExternalStore } from "react";
import { PROVIDERS } from "./providers";
import { MODELS } from "./models";
import { resolveCodexSubscriptionModel } from "./codexModels";
import { secretsSet, secretsDelete, secretsGetAll } from "../secrets";
import { persistNativeConfigSection } from "../settings/nativeConfig";

export const AI_CONFIG_STORAGE_KEY = "huskv2.ai.config";

/** Non-secret AI config. API keys live in the OS keychain, not here. */
export type StoredConfig = {
  providerId: string;
  model: string;
  baseURL: string;
  providerBaseURLs?: Record<string, string>;
};

/* Named, not positional. This was PROVIDERS[0], so adding a provider to the top
   of the list silently changed the default for every new install — and the CLI
   provider must never be a default, since it needs a binary the user may not
   have. */
const DEFAULT_PROVIDER_ID = "anthropic";

const DEFAULT: StoredConfig = (() => {
  const p = PROVIDERS.find((x) => x.id === DEFAULT_PROVIDER_ID) ?? PROVIDERS[0];
  return { providerId: p.id, model: p.defaultModel, baseURL: p.baseURL ?? "" };
})();

/**
 * A stored model id is only honoured if the app still offers it.
 *
 * Retiring a model from MODELS otherwise leaves existing users pinned to it
 * forever — loadConfig returned `parsed.model` unchecked, so a saved
 * "claude-sonnet-4" survived the model being removed and the composer kept
 * reporting it, sending requests for an id the provider may no longer serve.
 * Unknown ids fall back to the provider's own default.
 */
function knownModel(id: string | undefined, providerId: string): string {
  // Codex models are discovered from the signed-in CLI at runtime, so they are
  // deliberately absent from the static registry. Preserve the saved slug and
  // let the CLI validate it; otherwise a refresh would silently replace a
  // user's selected Codex model with the generic default. Only explicitly
  // retired subscription IDs receive their documented replacement.
  if (providerId === "codex" && id) return resolveCodexSubscriptionModel(id);
  if (providerId === "local" && id) return id;
  if (id && MODELS.some((m) => m.id === id && m.provider.id === providerId)) return id;
  return PROVIDERS.find((p) => p.id === providerId)?.defaultModel ?? DEFAULT.model;
}

/* Cached snapshot. loadConfig() is called from render paths, so it used to parse
   localStorage on every render — and useSyncExternalStore needs a referentially
   stable snapshot or it re-renders forever. */
let configCache: StoredConfig | null = null;
const configSubs = new Set<() => void>();
// Preserve existing plaintext entries only when their keychain migration fails.
// Native hydration must not erase the user's only recoverable copy.
let unmigratedKeys: Record<string, string> = {};

export function providerBaseURL(config: StoredConfig, providerId: string): string {
  const provider = PROVIDERS.find((item) => item.id === providerId);
  if (!provider?.configurableBaseURL) return provider?.baseURL ?? "";
  return config.providerBaseURLs?.[providerId] ?? (config.providerId === providerId ? config.baseURL : undefined) ?? provider.baseURL ?? "";
}

function normaliseConfig(value: unknown): StoredConfig {
  const parsed = value && typeof value === "object" ? value as Partial<StoredConfig> : {};
  const provider = PROVIDERS.find((item) => item.id === parsed.providerId) ?? PROVIDERS.find((item) => item.id === DEFAULT_PROVIDER_ID)!;
  const endpoints: Record<string, string> = {};
  for (const candidate of PROVIDERS.filter((item) => item.configurableBaseURL)) {
    const url = parsed.providerBaseURLs?.[candidate.id];
    if (typeof url === "string") endpoints[candidate.id] = url;
  }
  // Only configurable providers have an editable URL. Old shared URLs on a
  // named provider can belong to whichever provider was previously selected.
  if (provider.configurableBaseURL && endpoints[provider.id] === undefined && typeof parsed.baseURL === "string") endpoints[provider.id] = parsed.baseURL;
  return {
    providerId: provider.id,
    model: knownModel(typeof parsed.model === "string" ? parsed.model : undefined, provider.id),
    baseURL: endpoints[provider.id] ?? provider.baseURL ?? "",
    providerBaseURLs: endpoints,
  };
}

function persistBrowserConfig(config: StoredConfig): void {
  try {
    localStorage.setItem(AI_CONFIG_STORAGE_KEY, JSON.stringify({
      ...config,
      ...(Object.keys(unmigratedKeys).length ? { keys: unmigratedKeys } : {}),
    }));
  } catch { /* Native settings remain the durable source when browser storage is unavailable. */ }
}

export function subscribeConfig(fn: () => void): () => void {
  configSubs.add(fn);
  return () => configSubs.delete(fn);
}

/** Reactive config, so switching provider or model updates the UI immediately. */
export function useConfig(): StoredConfig {
  return useSyncExternalStore(subscribeConfig, loadConfig, loadConfig);
}

function readConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT;
    return normaliseConfig(JSON.parse(raw));
  } catch {
    return DEFAULT;
  }
}

export function loadConfig(): StoredConfig {
  configCache ??= readConfig();
  return configCache;
}

export function saveConfig(cfg: StoredConfig): void {
  const previous = loadConfig();
  const endpoints = { ...previous.providerBaseURLs, ...cfg.providerBaseURLs };
  const provider = PROVIDERS.find((item) => item.id === cfg.providerId);
  if (provider?.configurableBaseURL && cfg.providerId === previous.providerId) endpoints[cfg.providerId] = cfg.baseURL;
  configCache = normaliseConfig({ ...cfg, baseURL: endpoints[cfg.providerId] ?? provider?.baseURL ?? "", providerBaseURLs: endpoints });
  for (const fn of configSubs) fn();
  persistBrowserConfig(configCache);
  persistNativeConfigSection("ai", configCache);
  broadcast("husk-ai-config-changed", { config: configCache });
}

/** Resolve the selected provider's own endpoint before changing providers. */
export function updateConfig(patch: Partial<StoredConfig>): void {
  const current = loadConfig();
  const providerId = patch.providerId ?? current.providerId;
  const endpoints = { ...current.providerBaseURLs, ...patch.providerBaseURLs };
  if (patch.baseURL !== undefined) endpoints[providerId] = patch.baseURL;
  saveConfig({
    ...current,
    ...patch,
    providerId,
    model: patch.model ?? (providerId !== current.providerId ? PROVIDERS.find((provider) => provider.id === providerId)?.defaultModel ?? DEFAULT.model : current.model),
    baseURL: patch.baseURL ?? providerBaseURL({ ...current, providerBaseURLs: endpoints }, providerId),
    providerBaseURLs: endpoints,
  });
}

/** Apply the non-secret AI selection from config.toml before either composer
 * renders. API keys are intentionally hydrated through the keychain below. */
export function hydrateAiConfigFromNative(value: unknown): void {
  configCache = normaliseConfig(value);
  persistBrowserConfig(configCache);
  for (const fn of configSubs) fn();
}

// --- API keys ---------------------------------------------------------------
// Stored in the OS keychain (Rust `secrets_*`), cached in memory for sync reads
// and reactive UI. Writes are debounced so typing a key doesn't hammer the
// keychain (and, on macOS, doesn't re-prompt per keystroke).

let keyCache: Record<string, string> = {};
const keySubs = new Set<() => void>();
const writeTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const keyErrors: Record<string, string> = {};
const keyVersions: Record<string, number> = {};
const writeChains: Record<string, Promise<void>> = {};
const writing = new Set<string>();

function emitKeys(): void {
  for (const fn of keySubs) fn();
}

export function subscribeKeys(fn: () => void): () => void {
  keySubs.add(fn);
  return () => keySubs.delete(fn);
}

export function getKey(providerId: string): string {
  return keyCache[providerId] ?? "";
}

export function setKey(providerId: string, value: string): void {
  keyCache = { ...keyCache, [providerId]: value };
  delete keyErrors[providerId];
  keyVersions[providerId] = (keyVersions[providerId] ?? 0) + 1;
  const version = keyVersions[providerId];
  emitKeys();
  clearTimeout(writeTimers[providerId]);
  writeTimers[providerId] = setTimeout(() => {
    delete writeTimers[providerId];
    writing.add(providerId);
    writeChains[providerId] = (writeChains[providerId] ?? Promise.resolve()).catch(() => {}).then(async () => {
      try {
        if (value) await secretsSet(providerId, value);
        else await secretsDelete(providerId);
        if (unmigratedKeys[providerId]) {
          delete unmigratedKeys[providerId];
          persistBrowserConfig(loadConfig());
        }
        broadcast("husk-ai-keys-changed");
      } catch {
        if (keyVersions[providerId] === version) keyErrors[providerId] = "Could not save this key to the OS keychain. Edit and save it again to retry.";
      } finally {
        if (keyVersions[providerId] === version) writing.delete(providerId);
        emitKeys();
      }
    });
  }, 400);
}

export function useKeyError(providerId: string): string {
  return useSyncExternalStore(subscribeKeys, () => keyErrors[providerId] ?? "");
}

export function useKey(providerId: string): string {
  return useSyncExternalStore(
    (fn) => {
      keySubs.add(fn);
      return () => keySubs.delete(fn);
    },
    () => keyCache[providerId] ?? "",
  );
}

/**
 * Hydrate the key cache from the keychain at startup. Also migrates any keys
 * left embedded in an older localStorage config blob, then strips them from
 * localStorage so plaintext keys no longer linger there.
 */
export async function initKeys(): Promise<void> {
  const ids = PROVIDERS.map((p) => p.id);

  let legacy: Record<string, string> = {};
  try {
    const raw = localStorage.getItem(AI_CONFIG_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { keys?: Record<string, string> };
      legacy = Object.fromEntries(Object.entries(parsed.keys ?? {}).filter((entry) => typeof entry[1] === "string" && !!entry[1]));
    }
  } catch {
    legacy = {};
  }
  unmigratedKeys = { ...legacy };

  try {
    const vals = await secretsGetAll(ids);
    const next: Record<string, string> = {};
    ids.forEach((id, i) => {
      const v = vals[i];
      if (v) next[id] = v;
    });
    // Migrate legacy keys not already in the keychain.
    for (const [id, v] of Object.entries(legacy)) {
      try {
        if (v && !next[id]) {
          await secretsSet(id, v);
          next[id] = v;
        }
        delete unmigratedKeys[id];
      } catch {
        next[id] = v;
        keyErrors[id] = "Could not migrate this key to the OS keychain. The existing key is retained; retry saving it.";
      }
    }
    keyCache = next;
    emitKeys();
    // Migration succeeded — remove plaintext keys from localStorage.
    if (Object.keys(legacy).length) persistBrowserConfig(loadConfig());
  } catch {
    // Keychain unavailable — keep working from whatever was in localStorage.
    keyCache = { ...legacy };
    for (const id of ids) keyErrors[id] = "The OS keychain is unavailable. Stored keys could not be loaded.";
    emitKeys();
  }
}

async function refreshKeys(): Promise<void> {
  const ids = PROVIDERS.map((provider) => provider.id);
  const versions = { ...keyVersions };
  try {
    const values = await secretsGetAll(ids);
    const next = { ...keyCache };
    ids.forEach((id, index) => {
      if (writeTimers[id] || writing.has(id) || keyVersions[id] !== versions[id]) return;
      next[id] = values[index] ?? unmigratedKeys[id] ?? "";
    });
    keyCache = next;
    emitKeys();
  } catch { /* Keep usable in-memory credentials if a keychain refresh fails. */ }
}

const syncSource = Math.random().toString(36).slice(2);
let syncStarted: Promise<void> | undefined;

function broadcast(event: string, payload: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  void import("@tauri-apps/api/event").then(({ emit }) => emit(event, { ...payload, source: syncSource })).catch(() => {});
}

/** Events carry public configuration or a key-cache invalidation, never credentials. */
export function initialiseAiSync(): Promise<void> {
  syncStarted ??= (async () => {
    if (typeof window === "undefined") return;
    const acceptConfig = (value: unknown) => {
      const next = normaliseConfig(value);
      if (JSON.stringify(next) === JSON.stringify(loadConfig())) return;
      configCache = next;
      persistBrowserConfig(next);
      persistNativeConfigSection("ai", next);
      for (const fn of configSubs) fn();
    };
    window.addEventListener("storage", (event) => {
      if (event.key === AI_CONFIG_STORAGE_KEY) acceptConfig(readConfig());
    });
    window.addEventListener("focus", () => { acceptConfig(readConfig()); void refreshKeys(); });
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<{ source: string; config: StoredConfig }>("husk-ai-config-changed", ({ payload }) => {
        if (payload.source !== syncSource) acceptConfig(payload.config);
      });
      await listen<{ source: string }>("husk-ai-keys-changed", ({ payload }) => {
        if (payload.source !== syncSource) void refreshKeys();
      });
    } catch { /* Browser preview uses storage/focus events. */ }
  })();
  return syncStarted;
}
