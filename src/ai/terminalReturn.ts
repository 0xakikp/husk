import type { AiSession } from "./sessionStore";
import type { Pane } from "../terminalPanes";
import type { TermTab } from "../useTerminalTabs";
import { isPathInWorkspace, normalizeWorkspacePath } from "./workspaceScope";

type ReturnTab = Pick<TermTab, "id" | "root" | "focused">;

export type TerminalReturnTarget =
  | { kind: "tab"; tabId: number; leafId: number; reason: "source" | "workspace" | "active" }
  | { kind: "new-local"; cwd?: string }
  | { kind: "reconnect-remote"; host: string; path: string };

function sourceTabId(session: AiSession): number | undefined {
  if (typeof session.tabId === "number" && Number.isSafeInteger(session.tabId) && session.tabId > 0) {
    return session.tabId;
  }
  const match = /^tab-(\d+)$/.exec(session.id);
  if (!match) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function leafInWorkspace(node: Pane, workspacePath: string): number | null {
  if (node.kind === "leaf") {
    const cwd = node.initialCwd || node.checkpoint?.cwd;
    return isPathInWorkspace(cwd, workspacePath) ? node.id : null;
  }
  return leafInWorkspace(node.a, workspacePath) ?? leafInWorkspace(node.b, workspacePath);
}

/**
 * Resolve the honest destination for "Terminal" in a full AI conversation.
 * A killed shell is never described as restored: Husk either reuses a live
 * terminal, opens a fresh local shell in the selected folder, or asks the user
 * to reconnect an SSH host explicitly.
 */
export function resolveTerminalReturn(
  session: AiSession,
  tabs: ReturnTab[],
  activeTabId: number,
): TerminalReturnTarget {
  const originalTabId = sourceTabId(session);
  const originalTab = originalTabId === undefined
    ? undefined
    : tabs.find((tab) => tab.id === originalTabId);
  if (originalTab) {
    return { kind: "tab", tabId: originalTab.id, leafId: originalTab.focused, reason: "source" };
  }

  /* Remote scope is an explicit trust boundary. If its source shell is gone,
     silently choosing a local or differently connected terminal would be both
     confusing and unsafe. */
  if (session.remoteWorkspace) {
    return {
      kind: "reconnect-remote",
      host: session.remoteWorkspace.host,
      path: session.remoteWorkspace.path,
    };
  }

  const workspacePath = normalizeWorkspacePath(session.workspacePath);
  if (workspacePath) {
    const activeFirst = [
      ...tabs.filter((tab) => tab.id === activeTabId),
      ...tabs.filter((tab) => tab.id !== activeTabId),
    ];
    for (const tab of activeFirst) {
      const leafId = leafInWorkspace(tab.root, workspacePath);
      if (leafId !== null) {
        return { kind: "tab", tabId: tab.id, leafId, reason: "workspace" };
      }
    }
    return { kind: "new-local", cwd: workspacePath };
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  if (activeTab) {
    return { kind: "tab", tabId: activeTab.id, leafId: activeTab.focused, reason: "active" };
  }
  return { kind: "new-local" };
}
