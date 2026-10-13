/** Track which editor files have unsaved modifications, are newly created, or are
 *  deleted-but-still-open, so the file explorer can show indicators. */

import { useSyncExternalStore } from "react";

export type FileState = "clean" | "modified" | "new" | "deleted";

type DirtyEntry = {
  state: FileState;
  /** For "modified": the versionId at last save. */
  savedVersionId?: number;
};

let dirtyMap: Map<string, DirtyEntry> = new Map();
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

export function getFileState(path: string): FileState {
  return dirtyMap.get(path)?.state ?? "clean";
}

/** Return the first unsaved editor model at or below a filesystem path. */
export function getUnsavedPathWithin(path: string): string | null {
  const normalized = path.replace(/\/+$/, "");
  for (const [candidate, entry] of dirtyMap) {
    const inside = candidate === normalized || candidate.startsWith(`${normalized}/`);
    if (inside && entry.state !== "clean") return candidate;
  }
  return null;
}

/** Record the version actually written, without discarding edits made while
 * persistence was pending. A successful save also recreates deleted files. */
export function markSaved(path: string, versionId?: number, currentVersionId = versionId): void {
  dirtyMap.set(path, {
    state: currentVersionId !== versionId ? "modified" : "clean",
    savedVersionId: versionId,
  });
  emit();
}

export function markModified(path: string, currentVersionId: number): void {
  const entry = dirtyMap.get(path);
  if (!entry) {
    dirtyMap.set(path, { state: "modified", savedVersionId: currentVersionId - 1 });
    emit();
    return;
  }
  if (entry.state === "new" || entry.state === "deleted") return;
  const saved = entry.savedVersionId;
  const state = saved != null && currentVersionId === saved ? "clean" : "modified";
  if (entry.state !== state) {
    dirtyMap.set(path, { state, savedVersionId: saved });
    emit();
  }
}

export function markNew(path: string): void {
  dirtyMap.set(path, { state: "new" });
  emit();
}

export function markDeleted(path: string): void {
  const entry = dirtyMap.get(path);
  if (entry) {
    dirtyMap.set(path, { ...entry, state: "deleted" });
    emit();
  }
}

export function clearState(path: string): void {
  dirtyMap.delete(path);
  emit();
}

export function subscribeDirty(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useFileState(path: string): FileState {
  return useSyncExternalStore(subscribeDirty, () => getFileState(path), () => getFileState(path));
}
