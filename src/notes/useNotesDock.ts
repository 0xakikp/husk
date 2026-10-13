import { useCallback, useReducer, useState } from "react";
import type { OpenFile } from "../editor/EditorArea";
import { isVaultPathWithin, replaceVaultPath } from "./vaultPaths";

export type NotesOpeningMode = "panel" | "tab";
export const NOTES_OPENING_MODE_KEY = "husk.notes.openingMode";
export type NotesDockState = {
  /** Retain models while switching notes, tabs or dock tools. Never store content here. */
  files: OpenFile[];
  activePath: string | null;
  panelRequestId: number;
  revealTarget: { path: string; line: number; requestId: number } | null;
};
export const initialNotesDockState: NotesDockState = { files: [], activePath: null, panelRequestId: 0, revealTarget: null };
export type NotesDockAction =
  | { type: "open"; file: OpenFile; panel: boolean; line?: number }
  | { type: "move"; from: string; to: string }
  | { type: "delete"; path: string };

export function notesDockReducer(state: NotesDockState, action: NotesDockAction): NotesDockState {
  if (action.type === "open") {
    const file = { ...action.file, remoteHost: null };
    return {
      files: state.files.some((item) => item.path === file.path) ? state.files : [...state.files, file],
      activePath: file.path,
      panelRequestId: state.panelRequestId + (action.panel ? 1 : 0),
      revealTarget: action.line && Number.isInteger(action.line) && action.line > 0
        ? { path: file.path, line: action.line, requestId: (state.revealTarget?.requestId ?? 0) + 1 }
        : state.revealTarget,
    };
  }
  if (action.type === "move") {
    const remap = (path: string) => isVaultPathWithin(path, action.from) ? replaceVaultPath(path, action.from, action.to) : path;
    return {
      ...state,
      files: state.files.map((file) => {
        const path = remap(file.path);
        return path === file.path ? file : { ...file, path, name: path.split("/").pop() || path };
      }),
      activePath: state.activePath ? remap(state.activePath) : null,
      revealTarget: state.revealTarget ? { ...state.revealTarget, path: remap(state.revealTarget.path) } : null,
    };
  }
  const files = state.files.filter((file) => !isVaultPathWithin(file.path, action.path));
  return {
    ...state,
    files,
    activePath: state.activePath && isVaultPathWithin(state.activePath, action.path) ? files[files.length - 1]?.path ?? null : state.activePath,
    revealTarget: state.revealTarget && isVaultPathWithin(state.revealTarget.path, action.path) ? null : state.revealTarget,
  };
}

function readOpeningMode(): NotesOpeningMode {
  try { return localStorage.getItem(NOTES_OPENING_MODE_KEY) === "tab" ? "tab" : "panel"; }
  catch { return "panel"; }
}

export function useNotesDock() {
  const [state, dispatch] = useReducer(notesDockReducer, initialNotesDockState);
  const [preferredMode, setMode] = useState(readOpeningMode);
  const setPreferredMode = useCallback((mode: NotesOpeningMode) => {
    setMode(mode);
    try { localStorage.setItem(NOTES_OPENING_MODE_KEY, mode); } catch { /* Session preference still works. */ }
  }, []);
  const open = useCallback((path: string, name: string, line?: number, mode: NotesOpeningMode = preferredMode) => {
    dispatch({ type: "open", file: { path, name, remoteHost: null }, panel: mode === "panel", line });
    return mode;
  }, [preferredMode]);
  const movePath = useCallback((from: string, to: string) => dispatch({ type: "move", from, to }), []);
  const deletePath = useCallback((path: string) => dispatch({ type: "delete", path }), []);
  return { ...state, preferredMode, setPreferredMode, open, movePath, deletePath };
}

export type NotesDockApi = ReturnType<typeof useNotesDock>;
