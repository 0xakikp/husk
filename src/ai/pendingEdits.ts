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

export type ApplyResult =
  | { ok: true; path: string }
  | { ok: false; path: string; reason: string };

/**
 * Write one queued edit to disk.
 *
 * Until this existed, "Accept all pending edits" and "Reject all pending edits"
 * were byte-for-byte identical — both merely dropped the queue and toasted
 * success — so no proposed edit was ever applied while the AI reported that it
 * had edited the file. Nothing anywhere performed the search/replace.
 *
 * The search text is re-checked against the file at apply time, because the file
 * may have changed since the model proposed the edit. Only the first occurrence
 * is replaced: `search` comes from a model that was told to include surrounding
 * whitespace for uniqueness, and a blind replace-all could rewrite unintended
 * matches.
 */
export async function applyPendingEdit(edit: PendingEdit): Promise<ApplyResult> {
  const { readFile, writeFile } = await import("../fs");
  try {
    const current = await readFile(edit.path);
    if (!current.includes(edit.search)) {
      return {
        ok: false,
        path: edit.path,
        reason: "the file changed since this edit was proposed",
      };
    }
    await writeFile(edit.path, current.replace(edit.search, edit.replace));
    return { ok: true, path: edit.path };
  } catch (e) {
    return { ok: false, path: edit.path, reason: e instanceof Error ? e.message : String(e) };
  }
}
