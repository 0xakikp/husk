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
