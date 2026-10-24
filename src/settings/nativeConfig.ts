import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/** Secrets and chat history intentionally live outside this document. */
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
  revision?: number;
};
type ConfigSave = { path: string; document: HuskConfigDocument; revision: number };
export type ConfigStatus = {
  ready: boolean;
  path: string | null;
  error: string | null;
  phase: "loading" | "saved" | "dirty" | "saving" | "error";
  dirty: boolean;
  saving: boolean;
};
type ConfigSection = keyof Omit<HuskConfigDocument, "config_version">;
export type ConfigPatch = { path: string[]; value?: unknown };

let documentCache: HuskConfigDocument | null = null;
let durableCache: HuskConfigDocument | null = null;
let revision = -1;
let status: ConfigStatus = { ready: false, path: null, error: null, phase: "loading", dirty: false, saving: false };
const subscribers = new Set<() => void>();
const documentSubscribers = new Set<(document: HuskConfigDocument) => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pending: ConfigPatch[] = [];
let inFlight: ConfigPatch[] = [];
let activeSave: Promise<void> | null = null;
let syncStarted: Promise<void> | null = null;
let latestNativeEvent: ConfigSave | null = null;

function setStatus(next: Partial<ConfigStatus>) {
  status = { ...status, ...next };
  status.dirty = pending.length > 0 || inFlight.length > 0;
  status.saving = activeSave !== null;
  status.phase = status.error ? "error" : status.saving ? "saving" : status.dirty ? "dirty" : status.ready ? "saved" : "loading";
  for (const subscriber of subscribers) subscriber();
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function normaliseDocument(value: HuskConfigDocument): HuskConfigDocument {
  return { config_version: 1, preferences: asRecord(value.preferences), ai: asRecord(value.ai), mcp: asRecord(value.mcp), appearance_presets: asRecord(value.appearance_presets) };
}
const safeKey = (key: string) => !["__proto__", "prototype", "constructor"].includes(key);

/** Only changed leaves are sent. Object spreads in one window must not revert
 * another window's newer font, provider, or nested wallpaper setting. */
export function diffConfigValues(before: unknown, after: unknown, path: string[]): ConfigPatch[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isRecord(after) && (isRecord(before) || before === undefined)) {
    const previous = asRecord(before);
    return [...new Set([...Object.keys(previous), ...Object.keys(after)])]
      .filter(safeKey).flatMap((key) => diffConfigValues(previous[key], after[key], [...path, key]));
  }
  return [{ path, ...(after === undefined ? {} : { value: clone(after) }) }];
}
function applyPatches(document: HuskConfigDocument, patches: ConfigPatch[]): HuskConfigDocument {
  const next = clone(document);
  for (const { path, value } of patches) {
    if (!path.every(safeKey)) continue;
    let parent = next as unknown as Record<string, unknown>;
    for (const key of path.slice(0, -1)) {
      if (!isRecord(parent[key])) parent[key] = {};
      parent = parent[key] as Record<string, unknown>;
    }
    if (value === undefined) delete parent[path[path.length - 1]];
    else parent[path[path.length - 1]] = clone(value);
  }
  return next;
}
function notifyDocument() {
  if (!documentCache) return;
  for (const listener of documentSubscribers) listener(clone(documentCache));
}
function acceptDocument(saved: ConfigSave) {
  if (saved.revision >= revision) {
    revision = saved.revision;
    durableCache = normaliseDocument(saved.document);
  }
  // An older reply may acknowledge our write after a newer foreign event.
  // Rebase even then: the acknowledged in-flight overlay must disappear.
  if (durableCache) documentCache = applyPatches(durableCache, [...inFlight, ...pending]);
  setStatus({ path: saved.path });
  notifyDocument();
}
export function subscribeNativeConfigDocument(listener: (document: HuskConfigDocument) => void): () => void {
  documentSubscribers.add(listener);
  return () => { documentSubscribers.delete(listener); };
}
export function getNativeConfigSnapshot(): HuskConfigDocument | null { return documentCache ? clone(documentCache) : null; }

async function initialiseSync(): Promise<void> {
  syncStarted ??= (async () => {
    try {
      const { listen } = await import("@tauri-apps/api/event");
      await listen<ConfigSave>("husk:config-changed", ({ payload }) => {
        if (!latestNativeEvent || payload.revision >= latestNativeEvent.revision) latestNativeEvent = payload;
        if (documentCache && status.ready) acceptDocument(payload);
      });
    } catch { /* Browser previews have no native event bus. */ }
  })();
  await syncStarted;
}

/** A malformed file is never replaced automatically. */
export async function readNativeConfig(): Promise<ConfigLoad> {
  try {
    // Listen before reading, so edits made by another window during startup
    // migration/hydration cannot fall between the load and event registration.
    await initialiseSync();
    const result = await invoke<ConfigLoad>("config_load");
    setStatus({ path: result.path, ...(result.error ? { error: result.error } : {}) });
    return result;
  } catch (cause) {
    const error = "Could not open Husk config: " + String(cause instanceof Error ? cause.message : cause);
    setStatus({ error });
    return { path: "", exists: false, document: null, error };
  }
}

export async function initialiseNativeConfig(loaded: ConfigLoad, legacy: HuskConfigDocument): Promise<HuskConfigDocument> {
  await initialiseSync();
  if (loaded.document) {
    const newer = latestNativeEvent && latestNativeEvent.revision > (loaded.revision ?? 0) ? latestNativeEvent : null;
    documentCache = normaliseDocument(newer?.document ?? loaded.document);
    durableCache = documentCache;
    revision = newer?.revision ?? loaded.revision ?? 0;
    setStatus({ ready: true, path: newer?.path ?? (loaded.path || status.path), error: null });
    return clone(documentCache);
  }
  documentCache = normaliseDocument(legacy);
  durableCache = documentCache;
  if (loaded.exists || loaded.error) {
    setStatus({ ready: false, path: loaded.path || status.path, error: loaded.error ?? "The existing config could not be read." });
    return clone(documentCache);
  }
  try {
    // Migration is create-if-absent: another window's winning config is adopted.
    const saved = await invoke<ConfigSave>("config_save", { document: documentCache });
    const newer = latestNativeEvent && latestNativeEvent.revision > saved.revision ? latestNativeEvent : saved;
    documentCache = normaliseDocument(newer.document);
    durableCache = documentCache;
    revision = newer.revision;
    setStatus({ ready: true, path: newer.path, error: null });
  } catch (cause) {
    setStatus({ ready: false, path: loaded.path || status.path, error: "Could not create Husk config: " + String(cause instanceof Error ? cause.message : cause) });
  }
  return clone(documentCache);
}

function scheduleWrite() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void flushNativeConfig().catch(() => {}); }, 250);
}

/** previous is the caller's actual runtime snapshot, before its edit. This
 * avoids treating hydrated defaults or cross-window storage updates as edits. */
export function persistNativeConfigSection(section: ConfigSection, value: unknown, previous?: unknown) {
  if (!documentCache) return;
  const patches = diffConfigValues(previous ?? documentCache[section], clone(asRecord(value)), [section]);
  if (!patches.length) return;
  for (const patch of patches) {
    // Keep slider/text bursts bounded. A later replacement also supersedes
    // earlier edits below that path; an ancestor edit followed by a child is
    // retained in order because both operations may be needed.
    pending = pending.filter((item) => !patch.path.every((key, index) => item.path[index] === key));
    pending.push(patch);
  }
  documentCache = applyPatches(documentCache, patches);
  setStatus({});
  if (status.ready) scheduleWrite();
}

/** Wait for every queued edit, including edits made during a write. A clean
 * flush never writes; failures reject so close/import cannot claim success. */
export async function flushNativeConfig(): Promise<void> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (activeSave) { await activeSave; return flushNativeConfig(); }
  if (!status.ready || !documentCache) throw new Error(status.error ?? "Husk config is not ready to save.");
  if (!pending.length) {
    if (status.error) throw new Error(status.error);
    return;
  }
  activeSave = Promise.resolve().then(async () => {
    while (pending.length) {
      inFlight = pending;
      pending = [];
      setStatus({ error: null });
      try {
        const saved = await invoke<ConfigSave>("config_patch", { patches: inFlight });
        inFlight = [];
        acceptDocument(saved);
        setStatus({ error: null });
      } catch (cause) {
        pending = [...inFlight, ...pending];
        inFlight = [];
        const error = "Could not save Husk config: " + String(cause instanceof Error ? cause.message : cause);
        setStatus({ error });
        throw new Error(error);
      }
    }
  }).finally(() => { activeSave = null; setStatus({}); });
  setStatus({});
  return activeSave;
}

export async function retryNativeConfig(): Promise<void> {
  if (activeSave) return activeSave;
  const loaded = await readNativeConfig();
  if (loaded.error || (loaded.exists && !loaded.document)) throw new Error(loaded.error ?? "Could not read Husk config.");
  if (!loaded.document) {
    if (!documentCache) throw new Error("Husk config has not been initialized.");
    const saved = await invoke<ConfigSave>("config_save", { document: documentCache });
    acceptDocument(saved);
  } else {
    acceptDocument({ path: loaded.path, document: loaded.document, revision: loaded.revision ?? revision });
  }
  setStatus({ ready: true, error: null });
  await flushNativeConfig();
}

export async function readLatestNativeConfig(): Promise<HuskConfigDocument> {
  await flushNativeConfig();
  const loaded = await readNativeConfig();
  if (loaded.error || !loaded.document) throw new Error(loaded.error ?? "Husk config is unavailable.");
  acceptDocument({ path: loaded.path, document: loaded.document, revision: loaded.revision ?? revision });
  return clone(documentCache!);
}

export async function applyNativeConfigSections(
  sections: Partial<Omit<HuskConfigDocument, "config_version">>,
  previous?: Partial<Omit<HuskConfigDocument, "config_version">>,
): Promise<void> {
  for (const section of ["preferences", "ai", "mcp", "appearance_presets"] as const) {
    if (sections[section]) persistNativeConfigSection(section, sections[section], previous?.[section]);
  }
  await flushNativeConfig();
}

/** Explicit Save forms commit before publishing runtime changes. Failed drafts
 * remain only in their editor, so Discard cannot accidentally save them later.
 * Other live preferences still use the debounced optimistic queue above. */
export async function commitNativeConfigSections(
  sections: Partial<Omit<HuskConfigDocument, "config_version">>,
  previous?: Partial<Omit<HuskConfigDocument, "config_version">>,
): Promise<HuskConfigDocument> {
  const baseline = previous ?? getNativeConfigSnapshot();
  if (!baseline) throw new Error("Husk config has not been initialized.");
  const patches = (["preferences", "ai", "mcp", "appearance_presets"] as const).flatMap((section) => (
    sections[section] ? diffConfigValues(baseline[section], sections[section], [section]) : []
  ));
  await flushNativeConfig();
  // Several forms/windows can request saves concurrently. Recheck after the
  // await before taking this window's write slot.
  while (activeSave) await flushNativeConfig();
  if (!patches.length) return clone(documentCache!);
  activeSave = Promise.resolve().then(async () => {
    const saved = await invoke<ConfigSave>("config_patch", { patches });
    acceptDocument(saved);
  }).finally(() => {
    activeSave = null;
    setStatus({});
    if (pending.length) scheduleWrite();
  });
  setStatus({});
  // Do not turn an unsuccessful draft into a queued config edit or a global
  // save error that survives discarding it. The form owns its retry/error UI.
  await activeSave;
  return clone(documentCache!);
}
export function getNativeConfigStatus(): ConfigStatus { return status; }
export function useNativeConfigStatus(): ConfigStatus {
  return useSyncExternalStore((subscriber) => { subscribers.add(subscriber); return () => subscribers.delete(subscriber); }, getNativeConfigStatus, getNativeConfigStatus);
}
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushNativeConfig().catch(() => {});
  });
}
