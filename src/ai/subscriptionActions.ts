import { resolveWorkspacePath } from "./workspaceScope";
import { resolveRemoteWorkspacePath, type RemoteWorkspaceScope } from "./remoteWorkspace";
import type { HuskActionRequest } from "./actionBroker";

const ACTION_OPEN = /```husk-action\b[ \t]*/gi;
const ACTION_CLOSE = /^[ \t]*```[ \t]*(?=\r?\n|$)/gm;
const MAX_ACTIONS = 6;
const MAX_TEXT = 200_000;

export type SubscriptionActionParseResult = { actions: HuskActionRequest[]; rejected: number };

type SubscriptionActionBlock = {
  start: number;
  end: number;
  payload: string;
  closed: boolean;
};

/**
 * Find explicit Husk protocol blocks without depending on a perfectly closed
 * Markdown fence. Signed-in CLIs occasionally finish a response after the
 * JSON but before the closing backticks. That must count as a rejected action
 * (so the bounded correction path runs), and the protocol tail must never be
 * shown as ordinary chat text.
 */
function actionBlocks(text: string): SubscriptionActionBlock[] {
  const blocks: SubscriptionActionBlock[] = [];
  const opening = new RegExp(ACTION_OPEN.source, ACTION_OPEN.flags);
  let match: RegExpExecArray | null;

  while ((match = opening.exec(text)) !== null) {
    let payloadStart = opening.lastIndex;
    if (text.startsWith("\r\n", payloadStart)) payloadStart += 2;
    else if (text[payloadStart] === "\n") payloadStart += 1;

    const closing = new RegExp(ACTION_CLOSE.source, ACTION_CLOSE.flags);
    closing.lastIndex = payloadStart;
    const closeMatch = closing.exec(text);
    if (!closeMatch) {
      blocks.push({
        start: match.index,
        end: text.length,
        payload: text.slice(payloadStart),
        closed: false,
      });
      break;
    }

    const end = closeMatch.index + closeMatch[0].length;
    blocks.push({
      start: match.index,
      end,
      payload: text.slice(payloadStart, closeMatch.index),
      closed: true,
    });
    opening.lastIndex = end;
  }

  return blocks;
}

function records(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray((value as { actions?: unknown[] }).actions)) return (value as { actions: unknown[] }).actions;
  return [value];
}

/** Parse a deliberately tiny, explicit bridge format. A CLI never receives a
 * callable tool; it can only request a validated action for Husk to perform. */
export function parseSubscriptionActionProposals(
  text: string,
  workspaceRoot?: string,
  remoteWorkspace?: RemoteWorkspaceScope,
): SubscriptionActionParseResult {
  const actions: HuskActionRequest[] = [];
  let rejected = 0;
  for (const block of actionBlocks(text)) {
    if (!block.closed) {
      rejected += 1;
      continue;
    }
    let payload: unknown;
    try { payload = JSON.parse(block.payload); } catch { rejected += 1; continue; }
    for (const item of records(payload)) {
      if (actions.length >= MAX_ACTIONS || !item || typeof item !== "object") { rejected += 1; continue; }
      const value = item as Record<string, unknown>;
      const kind = value.kind;
      const path = typeof value.path === "string"
        ? remoteWorkspace
          ? resolveRemoteWorkspacePath(value.path, remoteWorkspace.path)
          : workspaceRoot
            ? resolveWorkspacePath(value.path, workspaceRoot)
            : null
        : null;
      if (kind === "workspace.read" || kind === "workspace.list") {
        if (!path) { rejected += 1; continue; }
        actions.push({ kind, path: value.path as string });
      } else if (kind === "workspace.inspect") {
        if (!workspaceRoot && !remoteWorkspace) { rejected += 1; continue; }
        actions.push({ kind });
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
  const blocks = actionBlocks(text);
  if (!blocks.length) return text.trim();

  let visible = "";
  let cursor = 0;
  for (const block of blocks) {
    visible += text.slice(cursor, block.start);
    cursor = block.end;
  }
  visible += text.slice(cursor);
  return visible.replace(/\n{3,}/g, "\n\n").trim();
}
