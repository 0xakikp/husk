/** Track which editor files have unsaved modifications, are newly created, or are
 *  deleted-but-still-open, so the file explorer can show indicators. */

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

export function markSaved(path: string, versionId?: number): void {
  const entry = dirtyMap.get(path);
  if (entry?.state === "new") {
    // First save of a new file → clean
    dirtyMap.set(path, { state: "clean", savedVersionId: versionId });
  } else if (entry?.state === "modified") {
    dirtyMap.set(path, { state: "clean", savedVersionId: versionId });
  } else if (!entry && versionId != null) {
    dirtyMap.set(path, { state: "clean", savedVersionId: versionId });
  }
  emit();
}

export function markModified(path: string, currentVersionId: number): void {
  const entry = dirtyMap.get(path);
  if (!entry) {
    dirtyMap.set(path, { state: "modified", savedVersionId: currentVersionId - 1 });
    emit();
    return;
  }
  if (entry.state === "new") return; // new files stay "new" until saved
  const saved = entry.savedVersionId ?? entry.savedVersionId;
  if (saved == null || currentVersionId !== saved) {
    dirtyMap.set(path, { state: "modified", savedVersionId: saved });
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
  // Simple re-render trigger; consumer should call this in component
  // and rely on external re-render triggers (useSyncExternalStore not needed
  // for this simple case — we just need the parent FileExplorer to re-render).
  return getFileState(path);
}
