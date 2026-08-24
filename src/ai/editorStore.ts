/** Simple store for communicating AI edit requests from the chat
 *  to the active Monaco editor instance. */

type ApplyEditFn = (search: string, replace: string) => boolean;

let applyEditFn: ApplyEditFn | null = null;

export function registerEditorApplyEdit(fn: ApplyEditFn): () => void {
  applyEditFn = fn;
  return () => {
    if (applyEditFn === fn) applyEditFn = null;
  };
}

export function applyAiEdit(search: string, replace: string): boolean {
  return applyEditFn?.(search, replace) ?? false;
}

// ── Editor selection reader ────────────────────────────────────────────────

type GetSelectionFn = () => { text: string; startLine: number; endLine: number } | null;

let getSelectionFn: GetSelectionFn | null = null;

export function registerEditorGetSelection(fn: GetSelectionFn): () => void {
  getSelectionFn = fn;
  return () => {
    if (getSelectionFn === fn) getSelectionFn = null;
  };
}

export function getEditorSelection(): { text: string; startLine: number; endLine: number } | null {
  return getSelectionFn?.() ?? null;
}

// ── Current file path ──────────────────────────────────────────────────────

type GetFileFn = () => string | null;

let getFileFn: GetFileFn | null = null;

export function registerEditorFile(fn: GetFileFn): () => void {
  getFileFn = fn;
  return () => {
    if (getFileFn === fn) getFileFn = null;
  };
}

export function getEditorFile(): string | null {
  return getFileFn?.() ?? null;
}

// ── Live document reader / guarded whole-document replacement ──────────────

export type EditorDocument = { path: string; text: string };

type GetDocumentFn = (path?: string) => EditorDocument | null;
type ReplaceDocumentFn = (path: string, expected: string, replacement: string) => Promise<boolean>;

let getDocumentFn: GetDocumentFn | null = null;
let replaceDocumentFn: ReplaceDocumentFn | null = null;

/** Notes AI uses the Monaco model rather than a potentially stale disk copy.
 * This matters when a user invokes Organize before saving their latest edits. */
export function registerEditorDocument(
  getDocument: GetDocumentFn,
  replaceDocument: ReplaceDocumentFn,
): () => void {
  getDocumentFn = getDocument;
  replaceDocumentFn = replaceDocument;
  return () => {
    if (getDocumentFn === getDocument) getDocumentFn = null;
    if (replaceDocumentFn === replaceDocument) replaceDocumentFn = null;
  };
}

export function getEditorDocument(path?: string): EditorDocument | null {
  return getDocumentFn?.(path) ?? null;
}

/** Replace only the exact version the user reviewed. A false result means the
 * editor changed while AI was working, so the caller must not overwrite it. */
export async function replaceEditorDocument(
  path: string,
  expected: string,
  replacement: string,
): Promise<boolean> {
  return await replaceDocumentFn?.(path, expected, replacement) ?? false;
}

// ── Close find widget ────────────────────────────────────────────────────────

type CloseFindFn = () => void;

let closeFindFn: CloseFindFn | null = null;

export function registerEditorCloseFind(fn: CloseFindFn): () => void {
  closeFindFn = fn;
  return () => {
    if (closeFindFn === fn) closeFindFn = null;
  };
}

export function closeEditorFindWidget(): void {
  closeFindFn?.();
}
