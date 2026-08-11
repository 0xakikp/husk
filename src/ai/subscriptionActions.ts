import { resolveWorkspacePath } from "./workspaceScope";
import type { HuskActionRequest } from "./actionBroker";

const ACTION_FENCE = /```husk-action\s*\n([\s\S]*?)```/gi;
const MAX_ACTIONS = 6;
const MAX_TEXT = 200_000;

export type SubscriptionActionParseResult = { actions: HuskActionRequest[]; rejected: number };

function records(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { actions?: unknown[] }).actions)) return (value as { actions: unknown[] }).actions;
  return [value];
}

/** Parse a deliberately tiny, explicit bridge format. A CLI never receives a
 * callable tool; it can only request a validated action for Husk to perform. */
export function parseSubscriptionActionProposals(text: string, workspaceRoot?: string): SubscriptionActionParseResult {
  const actions: HuskActionRequest[] = [];
  let rejected = 0;
  let match: RegExpExecArray | null;
  while ((match = ACTION_FENCE.exec(text)) !== null) {
    let payload: unknown;
    try { payload = JSON.parse(match[1]); } catch { rejected += 1; continue; }
    for (const item of records(payload)) {
      if (actions.length >= MAX_ACTIONS || !item || typeof item !== "object") { rejected += 1; continue; }
      const value = item as Record<string, unknown>;
      const kind = value.kind;
      const path = typeof value.path === "string" && workspaceRoot ? resolveWorkspacePath(value.path, workspaceRoot) : null;
      if (kind === "workspace.read" || kind === "workspace.list") {
        if (!path) { rejected += 1; continue; }
        actions.push({ kind, path: value.path as string });
      } else if (kind === "workspace.search") {
        if (typeof value.query !== "string" || !value.query.trim() || value.query.length > 400) { rejected += 1; continue; }
        actions.push({ kind, query: value.query, ...(typeof value.limit === "number" && value.limit > 0 && value.limit <= 30 ? { limit: value.limit } : {}) });
      } else if (kind === "workspace.write") {
        if (!path || typeof value.content !== "string" || value.content.length > MAX_TEXT) { rejected += 1; continue; }
        actions.push({ kind, path: value.path as string, content: value.content });
      } else if (kind === "workspace.edit") {
        if (!path || typeof value.search !== "string" || !value.search || value.search.length > MAX_TEXT || typeof value.replace !== "string" || value.replace.length > MAX_TEXT) { rejected += 1; continue; }
        actions.push({ kind, path: value.path as string, search: value.search, replace: value.replace });
      } else if (kind === "workspace.revertEdit") {
        if (!path) { rejected += 1; continue; }
        actions.push({ kind, path: value.path as string });
      } else if (kind === "mcp.call") {
        if (typeof value.serverId !== "string" || typeof value.toolName !== "string" || !value.serverId || !value.toolName || !value.input || typeof value.input !== "object" || Array.isArray(value.input)) { rejected += 1; continue; }
        actions.push({ kind, serverId: value.serverId, toolName: value.toolName, input: value.input as Record<string, unknown> });
      } else {
        rejected += 1;
      }
    }
  }
  return { actions, rejected };
}

export function stripSubscriptionActionProposals(text: string): string {
  return text.replace(ACTION_FENCE, "").replace(/\n{3,}/g, "\n\n").trim();
}
