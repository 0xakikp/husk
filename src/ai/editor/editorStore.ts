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
