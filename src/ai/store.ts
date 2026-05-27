import { useSyncExternalStore } from "react";
import { PROVIDERS } from "./providers";
import { secretsSet, secretsDelete, secretsGetAll } from "../secrets";

const LS_KEY = "huskv2.ai.config";

/** Non-secret AI config. API keys live in the OS keychain, not here. */
export type StoredConfig = {
  providerId: string;
  model: string;
  baseURL: string;
};

const DEFAULT: StoredConfig = {
  providerId: PROVIDERS[0].id,
  model: PROVIDERS[0].defaultModel,
  baseURL: PROVIDERS[0].baseURL ?? "",
};

export function loadConfig(): StoredConfig {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<StoredConfig>;
    return {
      providerId: parsed.providerId ?? DEFAULT.providerId,
      model: parsed.model ?? DEFAULT.model,
      baseURL: parsed.baseURL ?? DEFAULT.baseURL,
    };
  } catch {
    return DEFAULT;
  }
}

export function saveConfig(cfg: StoredConfig): void {
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
