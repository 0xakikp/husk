import { useSyncExternalStore } from "react";

export type SavedFixesViewRequest = { leafId: number; id: number };
let current: SavedFixesViewRequest | null = null;
let sequence = 0;
const listeners = new Set<() => void>();
const emit = () => { for (const listener of listeners) listener(); };

/** UI navigation only. Opening or closing the library never changes a saved
 * record, executes a command, or grants any terminal/workspace permission. */
export function openSavedFixes(leafId: number): void {
  if (!Number.isInteger(leafId) || leafId < 0) return;
  current = { leafId, id: ++sequence };
  emit();
}

/** Request identity keeps an old pane's cleanup from closing a newer open. */
export function closeSavedFixes(leafId: number, id?: number): void {
  if (current?.leafId !== leafId || (id !== undefined && current.id !== id)) return;
  current = null;
  emit();
}

export function getSavedFixesView(leafId: number): SavedFixesViewRequest | null {
  return current?.leafId === leafId ? current : null;
}

export function subscribeSavedFixesView(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSavedFixesView(leafId: number): SavedFixesViewRequest | null {
  return useSyncExternalStore(subscribeSavedFixesView, () => getSavedFixesView(leafId), () => null);
}
