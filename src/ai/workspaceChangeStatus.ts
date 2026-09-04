import type { AppliedEdit, PendingEdit } from "./pendingEdits";

type WorkspaceChangeStatusInput = {
  workspaceRoot: string;
  pending: PendingEdit[];
  applied: AppliedEdit[];
};

function relativeLabel(path: string, root: string): string {
  const normalizedRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  const prefix = `${normalizedRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path.split("/").pop() || path;
}

/**
 * Gives the model the same workspace-change state the composer is showing.
 * This contains paths and status only—never file content—and is bounded so a
 * long editing session cannot silently consume the chat context budget.
 */
export function workspaceChangeStatusContext({
  workspaceRoot,
  pending,
  applied,
}: WorkspaceChangeStatusInput): string {
  if (!workspaceRoot || (pending.length === 0 && applied.length === 0)) return "";

  const waiting = [...pending]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 8)
    .map((edit) => `${relativeLabel(edit.path, workspaceRoot)} (${edit.operation === "create" ? "new file" : "update"})`);
  const completed = [...applied]
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5)
    .map((edit) => `${relativeLabel(edit.path, workspaceRoot)} (${edit.operation === "create" ? "created" : "updated"})`);

  return [
    "## Current Husk workspace-change status",
    "This is trusted application state captured when the user sent this message. Use it when answering whether a change is done; do not rely only on an earlier assistant reply.",
    waiting.length ? `Waiting for approval: ${waiting.join(", ")}.` : "Waiting for approval: none.",
    completed.length ? `Already applied to disk: ${completed.join(", ")}.` : "Already applied to disk: none.",
    "An applied change is complete. Its Show diff control only displays what changed and does not require another approval.",
  ].join("\n");
}
