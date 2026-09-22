import type { PendingEdit } from "./pendingEdits";
import type { PendingMcpAction } from "./pendingActions";
import type { TerminalTarget } from "./terminalTarget";

export type ReviewItemKind = "edit" | "integration" | "terminal";
export type ReviewIndicatorItem = {
  id: string;
  kind: ReviewItemKind;
  label: string;
  target: string;
  detail?: string;
};

export type TerminalReviewItem = {
  id: "run" | "workspace-run" | "remote-run";
  sessionId: string;
  command: string;
  target: TerminalTarget;
  workspacePath?: string;
  productionTarget?: string | null;
};

/** Only live, explicitly session-owned queue entries count. Applied changes,
 * task events and historical assistant claims are not approval requests. */
export function collectReviewItems(
  sessionId: string,
  edits: readonly PendingEdit[],
  integrations: readonly PendingMcpAction[],
  terminals: readonly TerminalReviewItem[] = [],
): ReviewIndicatorItem[] {
  return [
    ...edits.filter((edit) => edit.sessionId === sessionId).map((edit) => ({
      id: edit.id,
      kind: "edit" as const,
      label: edit.operation === "create" ? "Create file" : edit.operation === "overwrite" ? "Overwrite file" : "Edit file",
      target: `${edit.remoteHost ? `SSH ${edit.remoteHost}` : "Local"} · ${edit.path}`,
    })),
    ...integrations.filter((action) => action.sessionId === sessionId).map((action) => ({
      id: action.id,
      kind: "integration" as const,
      label: "Integration action",
      // Server/tool identity is authoritative; a generated label need not be.
      target: `${action.request.serverId} · ${action.request.toolName}`,
    })),
    ...terminals.filter((action) => action.sessionId === sessionId).map((action) => ({
      id: action.id,
      kind: "terminal" as const,
      label: action.id === "workspace-run" ? "Choose run folder" : action.id === "remote-run" ? "Run on SSH host" : "Review command",
      target: `${action.target.isRemote ? `SSH ${action.target.host || "host unknown"}` : "Local terminal"} · ${action.target.cwd || "folder unknown"}${action.workspacePath ? ` → chat folder ${action.workspacePath}` : ""}${action.productionTarget ? ` · protected target ${action.productionTarget}` : ""}`,
      detail: action.command,
    })),
  ];
}
