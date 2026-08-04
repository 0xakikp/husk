import { useSyncExternalStore } from "react";
import { PROVIDERS } from "./providers";
import { MODELS } from "./models";
import { secretsSet, secretsDelete, secretsGetAll } from "../secrets";

const LS_KEY = "huskv2.ai.config";

/** Non-secret AI config. API keys live in the OS keychain, not here. */
export type StoredConfig = {
  providerId: string;
  model: string;
  baseURL: string;
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
  // user's selected Codex model with the generic default.
  if (providerId === "codex" && id) return id;
  if (id && MODELS.some((m) => m.id === id)) return id;
  return PROVIDERS.find((p) => p.id === providerId)?.defaultModel ?? DEFAULT.model;
}

/* Cached snapshot. loadConfig() is called from render paths, so it used to parse
   localStorage on every render — and useSyncExternalStore needs a referentially
   stable snapshot or it re-renders forever. */
let configCache: StoredConfig | null = null;
const configSubs = new Set<() => void>();

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
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    const providerId = parsed.providerId ?? DEFAULT.providerId;
    return {
      providerId,
      model: knownModel(parsed.model, providerId),
      baseURL: parsed.baseURL ?? DEFAULT.baseURL,
    };
  } catch {
    return DEFAULT;
  }
}

export function loadConfig(): StoredConfig {
  configCache ??= readConfig();
  return configCache;
}

export function saveConfig(cfg: StoredConfig): void {
  configCache = { providerId: cfg.providerId, model: cfg.model, baseURL: cfg.baseURL };
  for (const fn of configSubs) fn();
  try {
    // Persist only non-secret fields — never the keys.
    localStorage.setItem(
      LS_KEY,
      JSON.stringify({ providerId: cfg.providerId, model: cfg.model, baseURL: cfg.baseURL }),
    );
  } catch {
    // storage unavailable — keep config in memory only
  }
}

// --- API keys ---------------------------------------------------------------
// Stored in the OS keychain (Rust `secrets_*`), cached in memory for sync reads
// and reactive UI. Writes are debounced so typing a key doesn't hammer the
// keychain (and, on macOS, doesn't re-prompt per keystroke).

let keyCache: Record<string, string> = {};
const keySubs = new Set<() => void>();
const writeTimers: Record<string, ReturnType<typeof setTimeout>> = {};

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
  emitKeys();
  clearTimeout(writeTimers[providerId]);
  writeTimers[providerId] = setTimeout(() => {
    if (value) void secretsSet(providerId, value).catch(() => {});
    else void secretsDelete(providerId).catch(() => {});
  }, 400);
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
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { keys?: Record<string, string> };
      legacy = parsed.keys ?? {};
    }
  } catch {
    legacy = {};
  }

  try {
    const vals = await secretsGetAll(ids);
    const next: Record<string, string> = {};
    ids.forEach((id, i) => {
      const v = vals[i];
      if (v) next[id] = v;
    });
    // Migrate legacy keys not already in the keychain.
    for (const [id, v] of Object.entries(legacy)) {
      if (v && !next[id]) {
        next[id] = v;
        await secretsSet(id, v).catch(() => {});
      }
    }
    keyCache = next;
    emitKeys();
    // Migration succeeded — remove plaintext keys from localStorage.
    if (Object.keys(legacy).length) saveConfig(loadConfig());
  } catch {
    // Keychain unavailable — keep working from whatever was in localStorage.
    keyCache = { ...legacy };
    emitKeys();
  }
}
