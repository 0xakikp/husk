/** Pending edit queue — AI proposes edits, user reviews before applying. */

export interface PendingEdit {
  id: string;
  path: string;
  search: string;
  replace: string;
  timestamp: number;
}

let pendingEdits: PendingEdit[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) fn();
}

export function addPendingEdit(edit: Omit<PendingEdit, "id" | "timestamp">): PendingEdit {
  const item: PendingEdit = {
    ...edit,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  pendingEdits.push(item);
  notify();
  return item;
}

export function removePendingEdit(id: string): void {
  pendingEdits = pendingEdits.filter((e) => e.id !== id);
  notify();
}

export function getPendingEdits(): PendingEdit[] {
  return [...pendingEdits];
}

export function clearPendingEdits(): void {
  pendingEdits = [];
  notify();
}

export function subscribePendingEdits(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
