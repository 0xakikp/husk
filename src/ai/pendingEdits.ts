/** Pending edit queue — AI proposes edits, user reviews before applying. */

export interface PendingEdit {
  id: string;
  path: string;
  search: string;
  replace: string;
  /** `create` is a new file; `edit` replaces exactly one verified match. */
  operation?: "create" | "edit";
  /** The chat that proposed this edit. Older in-memory edits may not have one. */
  sessionId?: string;
  /** The chat scope enforced again when this reviewed edit is applied. */
  workspaceRoot?: string;
  timestamp: number;
}

/** In-memory evidence for an approved edit. Keeping the exact before/after
 * lets Undo refuse safely if a file changed again after Husk applied it. */
export interface AppliedEdit {
  id: string;
  sourceEditId?: string;
  path: string;
  operation: "create" | "edit";
  workspaceRoot: string;
  sessionId?: string;
  before: string | null;
  after: string;
  timestamp: number;
}

let pendingEdits: PendingEdit[] = [];
let appliedEdits: AppliedEdit[] = [];
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

export function getAppliedEdits(sessionId?: string): AppliedEdit[] {
  return appliedEdits.filter((edit) => !sessionId || edit.sessionId === sessionId);
}

function recordAppliedEdit(edit: PendingEdit, before: string | null, after: string): void {
  if (!edit.workspaceRoot) return;
  appliedEdits = [
    ...appliedEdits,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sourceEditId: edit.id,
      path: edit.path,
      operation: edit.operation === "create" ? "create" as const : "edit" as const,
      workspaceRoot: edit.workspaceRoot,
      sessionId: edit.sessionId,
      before,
      after,
      timestamp: Date.now(),
    },
  ].slice(-40);
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
  const { createDirScoped, readFileScoped, writeFileScoped, writeNewFileScoped } = await import("../fs");
  const workspaceRoot = edit.workspaceRoot;
  if (!workspaceRoot) {
    return {
      ok: false,
      path: edit.path,
      reason: "this proposed edit has no workspace scope; discard it and ask again from a scoped chat",
    };
  }
  try {
    if (edit.operation === "create") {
      const parent = edit.path.slice(0, edit.path.lastIndexOf("/"));
      if (parent) await createDirScoped(parent, workspaceRoot).catch(() => {});
      await writeNewFileScoped(edit.path, edit.replace, workspaceRoot);
      recordAppliedEdit(edit, null, edit.replace);
      return { ok: true, path: edit.path };
    }
    const current = await readFileScoped(edit.path, workspaceRoot);
    if (!current.includes(edit.search)) {
      return {
        ok: false,
        path: edit.path,
        reason: "the file changed since this edit was proposed",
      };
    }
    const after = current.replace(edit.search, edit.replace);
    await writeFileScoped(edit.path, after, workspaceRoot);
    recordAppliedEdit(edit, current, after);
    return { ok: true, path: edit.path };
  } catch (e) {
    return { ok: false, path: edit.path, reason: e instanceof Error ? e.message : String(e) };
  }
}

/** Undo only if the exact file content Husk wrote is still present. This makes
 * Undo safe around a subsequent user save or a different tool changing it. */
export async function undoAppliedEdit(edit: AppliedEdit): Promise<ApplyResult> {
  const { deleteFileScoped, readFileScoped, writeFileScoped } = await import("../fs");
  try {
    const current = await readFileScoped(edit.path, edit.workspaceRoot);
    if (current !== edit.after) {
      return {
        ok: false,
        path: edit.path,
        reason: "the file changed after Husk applied this edit, so it cannot be undone safely",
      };
    }
    if (edit.operation === "create") {
      await deleteFileScoped(edit.path, edit.workspaceRoot);
    } else if (edit.before !== null) {
      await writeFileScoped(edit.path, edit.before, edit.workspaceRoot);
    }
    appliedEdits = appliedEdits.filter((item) => item.id !== edit.id);
    notify();
    return { ok: true, path: edit.path };
  } catch (error) {
    return {
      ok: false,
      path: edit.path,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
