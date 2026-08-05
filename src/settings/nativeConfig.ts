import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/** The only durable settings document owned by Husk itself. Secrets and chat
 * history intentionally live elsewhere. Keeping this small makes it readable,
 * reviewable, and safe to retain across an app uninstall. */
export type HuskConfigDocument = {
  config_version: 1;
  preferences: Record<string, unknown>;
  ai: Record<string, unknown>;
  mcp: Record<string, unknown>;
  appearance_presets: Record<string, unknown>;
};

type ConfigLoad = {
  path: string;
  exists: boolean;
  document: HuskConfigDocument | null;
  error: string | null;
};

type ConfigStatus = {
  ready: boolean;
  path: string | null;
  error: string | null;
};

type ConfigSection = keyof Omit<HuskConfigDocument, "config_version">;

let documentCache: HuskConfigDocument | null = null;
let status: ConfigStatus = { ready: false, path: null, error: null };
const subscribers = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveChain: Promise<void> = Promise.resolve();

function emit() {
  for (const subscriber of subscribers) subscriber();
}

function setStatus(next: Partial<ConfigStatus>) {
  status = { ...status, ...next };
  emit();
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normaliseDocument(value: HuskConfigDocument): HuskConfigDocument {
  return {
    config_version: 1,
    preferences: asRecord(value.preferences),
    ai: asRecord(value.ai),
    mcp: asRecord(value.mcp),
    appearance_presets: asRecord(value.appearance_presets),
  };
}

/** Read only. A malformed file remains untouched and is surfaced to the UI. */
export async function readNativeConfig(): Promise<ConfigLoad> {
  try {
    const result = await invoke<ConfigLoad>("config_load");
    setStatus({ path: result.path, error: result.error });
    return result;
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    setStatus({ error: `Could not open Husk config: ${error}` });
    return { path: "", exists: false, document: null, error };
  }
}

/**
 * Choose the native file when it exists. On the first native-enabled launch,
 * write a complete snapshot of legacy browser preferences once. We only erase
 * neither legacy browser state nor a malformed TOML file: both remain a safe
 * fallback until a user deliberately resets them.
 */
export async function initialiseNativeConfig(
  loaded: ConfigLoad,
  legacy: HuskConfigDocument,
): Promise<HuskConfigDocument> {
  if (loaded.document) {
    documentCache = normaliseDocument(loaded.document);
    setStatus({ ready: true, path: loaded.path || status.path, error: null });
    return clone(documentCache);
  }

  const initial = normaliseDocument(legacy);
  documentCache = initial;

  // A bad existing file must never be replaced automatically. The app keeps
  // running from its safe in-memory/legacy state and tells the user why.
  if (loaded.exists || loaded.error) {
    setStatus({ ready: false, path: loaded.path || status.path, error: loaded.error ?? status.error });
    return clone(initial);
  }

  try {
    const saved = await invoke<{ path: string }>("config_save", { document: initial });
    setStatus({ ready: true, path: saved.path, error: null });
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    setStatus({ ready: false, path: loaded.path || status.path, error: `Could not create Husk config: ${error}` });
  }
  return clone(initial);
}

async function writeNow() {
  if (!documentCache || !status.ready) return;
  const snapshot = clone(documentCache);
  saveChain = saveChain
    .catch(() => undefined)
    .then(async () => {
      try {
        const saved = await invoke<{ path: string }>("config_save", { document: snapshot });
        setStatus({ path: saved.path, error: null });
      } catch (cause) {
        const error = cause instanceof Error ? cause.message : String(cause);
        setStatus({ error: `Could not save Husk config: ${error}` });
      }
    });
  await saveChain;
}

function scheduleWrite() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void writeNow();
  }, 250);
}

/** Save one non-secret section. Callers keep their own synchronous runtime
 * state; this queues a single native write after bursts such as slider moves. */
export function persistNativeConfigSection(section: ConfigSection, value: unknown) {
  if (!documentCache || !status.ready) return;
  documentCache = { ...documentCache, [section]: clone(value) };
  scheduleWrite();
}

export function flushNativeConfig(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return writeNow();
}

export function getNativeConfigStatus(): ConfigStatus {
  return status;
}

export function useNativeConfigStatus(): ConfigStatus {
  return useSyncExternalStore(
    (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    getNativeConfigStatus,
    getNativeConfigStatus,
  );
}

if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNativeConfig();
  });
}
