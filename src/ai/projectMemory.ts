import { getWorkspaceRoot } from "../workspace/store";

/**
 * A short, user-written note about the current project, prepended to every AI
 * request for that workspace.
 *
 * Every session otherwise starts blank, so the same explanation — what this repo
 * is, which stack, which conventions — gets retyped in each new chat. This is
 * deliberately hand-written rather than generated: a wrong auto-summary would be
 * silently prepended to every request, which is worse than having none.
 *
 * Keyed by workspace path, so switching projects switches the note.
 */

const LS_KEY = "husk.ai.projectMemory";

/** Long enough for stack and conventions, short enough not to crowd the prompt. */
export const MAX_MEMORY_CHARS = 1200;

type MemoryMap = Record<string, string>;

function readAll(): MemoryMap {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as MemoryMap) : {};
  } catch {
    return {};
  }
}

function writeAll(map: MemoryMap): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // storage unavailable — nothing useful to do
  }
}

export function getProjectMemory(root = getWorkspaceRoot()): string {
  if (!root) return "";
  return readAll()[root] ?? "";
}

export function setProjectMemory(text: string, root = getWorkspaceRoot()): void {
  if (!root) return;
  const map = readAll();
  const trimmed = text.trim().slice(0, MAX_MEMORY_CHARS);
  if (trimmed) map[root] = trimmed;
  else delete map[root];
  writeAll(map);
}

/**
 * The block to prepend to a system prompt, or "" when there is no note.
 *
 * Labelled explicitly so the model treats it as background rather than as an
 * instruction from the user in this turn.
 */
export function projectMemoryBlock(root = getWorkspaceRoot()): string {
  const note = getProjectMemory(root);
  if (!note) return "";
  return `\n\nBackground on this project (written by the user, not part of their current question):\n${note}`;
}
