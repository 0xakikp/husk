import { useSyncExternalStore } from "react";

/** Device-local convenience metadata, deliberately separate from portable
 * workflow definitions. Kept in this WebView's local storage until a link/pin
 * is removed or app browsing data is cleared; not included in workflow JSON
 * exports or cloud sync. A link stores a path, never the script's contents.
 * Loading, pinning and linking do not read or execute any file. */
export const WORKFLOW_LIBRARY_STORAGE_KEY = "huskv2.workflow-library.v1";
export type LinkedScript = Readonly<{ id: string; name: string; path: string; createdAt: number }>;
export type WorkflowLibrary = Readonly<{
  version: 1;
  pinnedWorkflowIds: readonly string[];
  scripts: readonly LinkedScript[];
  pinnedScriptIds: readonly string[];
}>;

const MAX_ITEMS = 500;
const MAX_BYTES = 1024 * 1024;
const EMPTY: WorkflowLibrary = Object.freeze({
  version: 1, pinnedWorkflowIds: Object.freeze([]), scripts: Object.freeze([]), pinnedScriptIds: Object.freeze([]),
});
let snapshot: WorkflowLibrary | null = null;
let storageError: string | null = null;
const subscribers = new Set<() => void>();
const byteLength = (value: string) => new TextEncoder().encode(value).length;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || byteLength(value) > max || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(value)) {
    throw new Error(`${label} must be nonempty text of at most ${max} UTF-8 bytes, without control characters.`);
  }
  return value;
}

function scriptPath(value: unknown): string {
  const path = text(value, 4096, "Script path");
  if (!(/^(?:\/(?!\/)|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])/.test(path)) || /[\\/]$/.test(path)) {
    throw new Error("Choose an absolute local script file path, not a folder or URL.");
  }
  return path;
}

function ids(raw: unknown, label: string): string[] {
  if (!Array.isArray(raw) || raw.length > MAX_ITEMS) throw new Error(`${label} supports at most ${MAX_ITEMS} items.`);
  const result = raw.map((id) => text(id, 120, label));
  if (new Set(result).size !== result.length) throw new Error(`${label} contains duplicate IDs.`);
  return result;
}

export function validateWorkflowLibrary(raw: unknown): WorkflowLibrary {
  if (!object(raw) || raw.version !== 1) throw new Error("Unsupported workflow library format.");
  const pinnedWorkflowIds = ids(raw.pinnedWorkflowIds, "Pinned workflows");
  const pinnedScriptIds = ids(raw.pinnedScriptIds, "Pinned scripts");
  if (!Array.isArray(raw.scripts) || raw.scripts.length > MAX_ITEMS) throw new Error(`The library supports at most ${MAX_ITEMS} linked scripts.`);
  const scripts = raw.scripts.map((value): LinkedScript => {
    if (!object(value)) throw new Error("Each linked script must be an object.");
    const id = text(value.id, 120, "Script ID");
    if (!id.startsWith("script_")) throw new Error("Linked script IDs must start with script_.");
    if (typeof value.createdAt !== "number" || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) throw new Error("Script creation time must be a valid timestamp.");
    return Object.freeze({ id, name: text(value.name, 160, "Script name").trim(), path: scriptPath(value.path), createdAt: value.createdAt });
  });
  if (new Set(scripts.map(({ id }) => id)).size !== scripts.length) throw new Error("Linked script IDs must be unique.");
  if (new Set(scripts.map(({ path }) => path)).size !== scripts.length) throw new Error("This script is already linked.");
  const scriptIds = new Set(scripts.map(({ id }) => id));
  if (pinnedScriptIds.some((id) => !scriptIds.has(id))) throw new Error("A pinned script is missing from the library.");
  const result: WorkflowLibrary = Object.freeze({
    version: 1,
    pinnedWorkflowIds: Object.freeze(pinnedWorkflowIds),
    scripts: Object.freeze(scripts),
    pinnedScriptIds: Object.freeze(pinnedScriptIds),
  });
  if (byteLength(JSON.stringify(result)) > MAX_BYTES) throw new Error("Workflow library exceeds 1 MiB.");
  return result;
}

function parse(raw: string | null): WorkflowLibrary {
  if (raw === null) return EMPTY;
  if (byteLength(raw) > MAX_BYTES) throw new Error("Workflow library exceeds 1 MiB.");
  return validateWorkflowLibrary(JSON.parse(raw));
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function publish(next: WorkflowLibrary, error: string | null = null): void {
  snapshot = next;
  storageError = error;
  subscribers.forEach((subscriber) => subscriber());
}

export function getWorkflowLibrary(): WorkflowLibrary {
  if (snapshot) return snapshot;
  try { snapshot = parse(localStorage.getItem(WORKFLOW_LIBRARY_STORAGE_KEY)); }
  catch (error) {
    snapshot = EMPTY;
    storageError = `Could not read the local workflow library. Original data is unchanged. ${message(error)}`;
  }
  return snapshot;
}

export function getWorkflowLibraryError(): string | null { getWorkflowLibrary(); return storageError; }
export function subscribeWorkflowLibrary(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => { subscribers.delete(subscriber); };
}
export function useWorkflowLibrary(): WorkflowLibrary {
  return useSyncExternalStore(subscribeWorkflowLibrary, getWorkflowLibrary, getWorkflowLibrary);
}
export function useWorkflowLibraryError(): string | null {
  return useSyncExternalStore(subscribeWorkflowLibrary, getWorkflowLibraryError, getWorkflowLibraryError);
}

/** Read the latest saved copy before applying one small mutation, including
 * when another window changed it before its storage event arrived. Persist
 * before publication; errors leave both the prior snapshot and saved data
 * intact. localStorage is not a transaction across simultaneous WebViews. */
function change(update: (current: WorkflowLibrary) => WorkflowLibrary): void {
  const previous = getWorkflowLibrary();
  let current: WorkflowLibrary;
  try { current = parse(localStorage.getItem(WORKFLOW_LIBRARY_STORAGE_KEY)); }
  catch (error) {
    const reason = `Could not read the local workflow library; nothing was saved. Original data is unchanged. ${message(error)}`;
    publish(previous, reason);
    throw new Error(reason);
  }
  const next = validateWorkflowLibrary(update(current));
  try { localStorage.setItem(WORKFLOW_LIBRARY_STORAGE_KEY, JSON.stringify(next)); }
  catch (error) {
    const reason = `Could not save the local workflow library; your change was not applied. ${message(error)}`;
    publish(previous, reason);
    throw new Error(reason);
  }
  publish(next);
}

function setPinned(list: readonly string[], id: string, pinned: boolean): string[] {
  text(id, 120, "Pinned item ID");
  return pinned ? list.includes(id) ? [...list] : [...list, id] : list.filter((entry) => entry !== id);
}

export function setWorkflowPinned(id: string, pinned: boolean): void {
  change((current) => ({ ...current, pinnedWorkflowIds: setPinned(current.pinnedWorkflowIds, id, pinned) }));
}
export function removeWorkflowPin(id: string): void { setWorkflowPinned(id, false); }

export function addLinkedScript(input: { name: string; path: string }): LinkedScript {
  const script: LinkedScript = { id: `script_${crypto.randomUUID()}`, name: input.name, path: input.path, createdAt: Date.now() };
  change((current) => ({ ...current, scripts: [...current.scripts, script] }));
  return getWorkflowLibrary().scripts.find(({ id }) => id === script.id)!;
}
export function removeLinkedScript(id: string): void {
  change((current) => ({ ...current, scripts: current.scripts.filter((script) => script.id !== id), pinnedScriptIds: current.pinnedScriptIds.filter((entry) => entry !== id) }));
}
export function setScriptPinned(id: string, pinned: boolean): void {
  change((current) => {
    if (!current.scripts.some((script) => script.id === id)) throw new Error("This linked script is no longer available.");
    return { ...current, pinnedScriptIds: setPinned(current.pinnedScriptIds, id, pinned) };
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== WORKFLOW_LIBRARY_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      // Read storage, rather than a potentially older queued event payload.
      publish(parse(localStorage.getItem(WORKFLOW_LIBRARY_STORAGE_KEY)));
    }
    catch (error) { publish(getWorkflowLibrary(), `Could not read the updated local workflow library. Original data is unchanged. ${message(error)}`); }
  });
}
