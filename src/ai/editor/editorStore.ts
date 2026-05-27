/** Simple store for communicating AI edit requests from the chat pane
 *  to the active Monaco editor instance. */

import { parseEdits as _parseEdits, stripEditBlocks as _stripEditBlocks } from "./diffParser";
import type { CodeEdit } from "./types";
export type { CodeEdit };
export { _parseEdits as parseEdits, _stripEditBlocks as stripEditBlocks };

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
