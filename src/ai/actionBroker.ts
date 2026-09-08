import { readDirScoped, readFileScoped } from "../fs";
import { callMcpTool, getAllMcpTools } from "../mcp/client";
import { loadMcpServers } from "../mcp/store";
import { addPendingEdit, applyPendingEdit, getPendingEdits, isAutoApplyEligible, removePendingEdit, replaceVerifiedEdit, type PendingEdit } from "./pendingEdits";
import {
  buildCodebaseIndex,
  formatSearchResults,
  searchCodebase,
} from "./codebaseSearch";
import { normalizeWorkspacePath, resolveWorkspacePath } from "./workspaceScope";
import { addPendingMcpAction } from "./pendingActions";
import { loadProjectLensSnapshot } from "./projectLens";
import { sshReadDirScoped, sshReadFileScoped } from "../remote/remoteFs";
import { getActiveRemoteTerminal } from "./terminalContext";
import { loadRemoteProjectLensSnapshot } from "./remoteProjectLens";
import {
  normalizeRemoteWorkspace,
  resolveRemoteWorkspacePath,
  type RemoteWorkspaceScope,
} from "./remoteWorkspace";

/**
 * The one local boundary for model-requested work. Providers can differ in how
 * they formulate a request (native API tool call or a signed-in CLI proposal),
 * but they never receive raw filesystem, terminal, keychain, or MCP access.
 */
export type HuskActionRequest =
  | { kind: "workspace.read"; path: string }
  | { kind: "workspace.list"; path: string }
  | { kind: "workspace.inspect" }
  | { kind: "workspace.search"; query: string; limit?: number }
  | { kind: "workspace.write"; path: string; content: string }
  | { kind: "workspace.edit"; path: string; search: string; replace: string }
  | { kind: "workspace.revertEdit"; path: string }
  | { kind: "mcp.call"; serverId: string; toolName: string; input: Record<string, unknown> };

export type HuskActionContext = {
  sessionId?: string;
  workspaceRoot?: string | null;
  remoteWorkspace?: RemoteWorkspaceScope | null;
  fileToolsEnabled: boolean;
  mcpToolsEnabled: boolean;
  /** A user has explicitly approved a non-read-only integration request. */
  confirmMcpCall?: boolean;
  /** Explicit per-chat write consent. Reading a workspace does not grant it. */
  workspaceEditAccess?: boolean;
  autoApply?: boolean;
  signal?: AbortSignal;
};

type WorkspaceScope =
  | { kind: "local"; root: string; resolved: string }
  | { kind: "remote"; root: string; resolved: string; host: string };

export type HuskActionResult = {
  state: "complete" | "queued" | "refused" | "error";
  summary: string;
  /** Sent back to a planning model, never used as an instruction itself. */
  result?: string;
  activity: string;
};

function workspaceScope(context: HuskActionContext, path?: string): WorkspaceScope | HuskActionResult {
  const remote = normalizeRemoteWorkspace(context.remoteWorkspace);
  if (remote) {
    const activeRemote = getActiveRemoteTerminal();
    if (!activeRemote.isRemote || activeRemote.host !== remote.host) {
      return {
        state: "refused",
        summary: "Remote workspace is not connected",
        result: `Refused: focus the SSH terminal for ${remote.host} before Husk accesses ${remote.path}.`,
        activity: "remote workspace scope",
      };
    }
    const resolved = resolveRemoteWorkspacePath(path ?? ".", remote.path);
    if (!resolved) {
      return {
        state: "refused",
        summary: "Path outside remote workspace",
        result: `Refused: ${path || "that path"} is outside the selected remote workspace (${remote.host}:${remote.path}).`,
        activity: "remote workspace scope",
      };
    }
    return { kind: "remote", root: remote.path, resolved, host: remote.host };
  }
  const root = normalizeWorkspacePath(context.workspaceRoot ?? null);
  if (!root) {
    return {
      state: "refused",
      summary: "No workspace selected",
      result: "Refused: this chat has no workspace selected. Ask the user to choose one from the chat header.",
      activity: "workspace scope",
    };
  }
  const resolved = resolveWorkspacePath(path ?? ".", root);
  if (!resolved) {
    return {
      state: "refused",
      summary: "Path outside workspace",
      result: `Refused: ${path || "that path"} is outside the selected workspace (${root}).`,
      activity: "workspace scope",
    };
  }
  return { kind: "local", root, resolved };
}

function isScopeResult(value: ReturnType<typeof workspaceScope>): value is HuskActionResult {
  return "state" in value;
}

function fail(activity: string, error: unknown): HuskActionResult {
  const message = error instanceof Error ? error.message : String(error);
  return { state: "error", summary: message, result: `Error: ${message}`, activity };
}

function mcpResultToString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;
  const record = result as Record<string, unknown>;
  if (Array.isArray(record.content)) {
    return record.content.map((item) => {
      const value = item as Record<string, unknown>;
      if (value.type === "text" && typeof value.text === "string") return value.text;
      if (value.type === "image" || value.type === "audio") return `[${value.type} data]`;
      if (value.type === "resource") return "[resource]";
      return JSON.stringify(value);
    }).join("\n");
  }
  return record.isError ? `Error: ${JSON.stringify(record)}` : JSON.stringify(result, null, 2);
}

function checkCancellation(context: HuskActionContext): void {
  if (context.signal?.aborted) throw new Error("The request was cancelled; no further actions will run.");
}

async function readExisting(scope: WorkspaceScope): Promise<string | null> {
  try {
    return scope.kind === "remote"
      ? await sshReadFileScoped(scope.host, scope.root, scope.resolved)
      : await readFileScoped(scope.resolved, scope.root);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Permission, size-limit, disconnection and symlink errors are not evidence
    // that a file is absent. In particular never turn a truncated read into an
    // overwrite or a misleading create proposal.
    if (/no such file or directory|os error 2\b/i.test(message)) return null;
    throw error;
  }
}

async function proposeEdit(
  edit: Omit<PendingEdit, "id" | "timestamp">,
  context: HuskActionContext,
  label: string,
): Promise<HuskActionResult> {
  checkCancellation(context);
  const pending = addPendingEdit(edit);
  const activity = edit.operation === "create" ? "propose file" : edit.operation === "overwrite" ? "propose overwrite" : "propose edit";
  if (context.autoApply && isAutoApplyEligible(pending)) {
    checkCancellation(context);
    const applied = await applyPendingEdit(pending, { signal: context.signal });
    if (applied.ok) {
      removePendingEdit(pending.id);
      return { state: "complete", summary: `Applied ${label}`, result: `Applied ${label}. The change is recorded and can be undone while unchanged.`, activity: "apply edit" };
    }
    return { state: "error", summary: `Could not apply ${label}`, result: `Error: ${applied.reason}. The proposal remains available for review.`, activity };
  }
  return { state: "queued", summary: `${label} is ready for review`, result: "The file was not changed. Husk queued a diff for review.", activity };
}

/** Execute or queue one request under the same policy for every provider. */
export async function executeHuskAction(
  request: HuskActionRequest,
  context: HuskActionContext,
): Promise<HuskActionResult> {
  if (context.signal?.aborted) return { state: "refused", summary: "Request cancelled", result: "Refused: this request was cancelled.", activity: request.kind };
  if (request.kind.startsWith("workspace.") && !context.fileToolsEnabled) {
    return {
      state: "refused",
      summary: "Workspace actions are disabled",
      result: "Refused: workspace actions are disabled in Settings → Agents.",
      activity: "workspace action",
    };
  }
  if ((request.kind === "workspace.write" || request.kind === "workspace.edit") && context.workspaceEditAccess !== true) {
    return { state: "refused", summary: "Workspace edits are disabled", result: "Refused: ask the user to enable workspace edits for this chat before proposing changes.", activity: "workspace edit" };
  }

  try {
    switch (request.kind) {
      case "workspace.read": {
        const scope = workspaceScope(context, request.path);
        if (isScopeResult(scope)) return scope;
        const content = scope.kind === "remote"
          ? await sshReadFileScoped(scope.host, scope.root, scope.resolved)
          : await readFileScoped(scope.resolved, scope.root);
        return { state: "complete", summary: `Read ${request.path}`, result: content, activity: "read file" };
      }
      case "workspace.list": {
        const scope = workspaceScope(context, request.path);
        if (isScopeResult(scope)) return scope;
        const entries = scope.kind === "remote"
          ? await sshReadDirScoped(scope.host, scope.root, scope.resolved)
          : await readDirScoped(scope.resolved, scope.root);
        const shown = entries.slice(0, 200);
        const result = entries.length
          ? `${shown.map((entry: { is_dir: boolean; name: string }) => `- ${entry.is_dir ? "[dir]" : "[file]"} ${entry.name}${entry.is_dir ? "/" : ""}`).join("\n")}${entries.length > shown.length ? `\n… ${entries.length - shown.length} more entries not shown` : ""}`
          : "Directory is empty.";
        return { state: "complete", summary: `Listed ${request.path}`, result, activity: "list files" };
      }
      case "workspace.inspect": {
        const scope = workspaceScope(context);
        if (isScopeResult(scope)) return scope;
        const snapshot = scope.kind === "remote"
          ? await loadRemoteProjectLensSnapshot({ kind: "ssh", host: scope.host, path: scope.root }, true)
          : await loadProjectLensSnapshot(scope.root, true);
        return {
          state: "complete",
          summary: `Inspected ${snapshot.name}`,
          result: snapshot.context,
          activity: "Project Lens",
        };
      }
      case "workspace.search": {
        const scope = workspaceScope(context);
        if (isScopeResult(scope)) return scope;
        if (scope.kind === "remote") {
          return {
            state: "refused",
            summary: "Remote search needs a narrower request",
            result: "Remote workspace search does not crawl the server. List a folder or read a named file instead.",
            activity: "search remote workspace",
          };
        }
        // Use this request's fresh snapshot. Another chat may build an index at
        // the same time, and files may change between successive searches.
        const index = await buildCodebaseIndex(scope.root, { signal: context.signal });
        checkCancellation(context);
        return {
          state: "complete",
          summary: `Searched workspace for ${request.query}`,
          result: formatSearchResults(searchCodebase(request.query, request.limit ?? 10, index)),
          activity: "search workspace",
        };
      }
      case "workspace.write": {
        const scope = workspaceScope(context, request.path);
        if (isScopeResult(scope)) return scope;
        const existing = await readExisting(scope);
        return await proposeEdit({ path: scope.resolved, search: existing ?? "", replace: request.content,
          operation: existing === null ? "create" : "overwrite", sessionId: context.sessionId, workspaceRoot: scope.root,
          ...(scope.kind === "remote" ? { remoteHost: scope.host } : {}) }, context,
        `${existing === null ? "Creation" : "Overwrite"} of ${request.path}`);
      }
      case "workspace.edit": {
        const scope = workspaceScope(context, request.path);
        if (isScopeResult(scope)) return scope;
        const content = await readExisting(scope);
        if (content === null) {
          return { state: "error", summary: `File not found: ${request.path}`, result: `Error: file not found: ${request.path}`, activity: "propose edit" };
        }
        replaceVerifiedEdit(content, request);
        return await proposeEdit({ path: scope.resolved, search: request.search, replace: request.replace,
          operation: "edit", sessionId: context.sessionId, workspaceRoot: scope.root,
          ...(scope.kind === "remote" ? { remoteHost: scope.host } : {}) }, context, `Edit to ${request.path}`);
      }
      case "workspace.revertEdit": {
        const scope = workspaceScope(context, request.path);
        if (isScopeResult(scope)) return scope;
        checkCancellation(context);
        const matching = getPendingEdits().filter((edit) => edit.path === scope.resolved && edit.workspaceRoot === scope.root && edit.remoteHost === (scope.kind === "remote" ? scope.host : undefined) && edit.sessionId === context.sessionId);
        matching.forEach((edit) => removePendingEdit(edit.id));
        return {
          state: "complete",
          summary: matching.length ? `Discarded ${matching.length} pending edit${matching.length === 1 ? "" : "s"}` : "No pending edit found",
          result: matching.length ? `Discarded ${matching.length} pending edit proposal(s) for ${request.path}.` : `No pending edit proposal found for ${request.path}.`,
          activity: "discard edit",
        };
      }
      case "mcp.call": {
        if (!context.mcpToolsEnabled) {
          return { state: "refused", summary: "Connected tools are disabled", result: "Refused: connected MCP tools are disabled in Settings → Agents.", activity: "MCP action" };
        }
        const server = loadMcpServers().find((item) => item.id === request.serverId && item.enabled);
        const discovered = getAllMcpTools().find((item) => item.serverId === request.serverId && item.name === request.toolName);
        if (!server || !discovered) {
          return { state: "error", summary: "MCP tool is unavailable", result: "Error: this integration is not connected. Refresh or connect it in Settings → Integrations.", activity: "MCP action" };
        }
        const actionLabel = `${server.name} · ${request.toolName}`;
        /* A generic MCP declaration cannot reliably tell us whether a request
           mutates remote state. Only an explicitly read-only integration can
           execute inline; every other call uses the visible approval queue. */
        if (!server.readOnly && !context.confirmMcpCall) {
          addPendingMcpAction({ request, sessionId: context.sessionId, label: actionLabel });
          return {
            state: "queued",
            summary: `${actionLabel} needs approval`,
            result: "Husk queued this integration action for approval. It has not run yet.",
            activity: actionLabel,
          };
        }
        checkCancellation(context);
        const response = await callMcpTool(request.serverId, request.toolName, request.input);
        const output = mcpResultToString(response);
        if (response && typeof response === "object" && (response as { isError?: unknown }).isError === true) {
          return { state: "error", summary: `${actionLabel} failed`, result: output || "The integration reported an error.", activity: actionLabel };
        }
        // The tool may already have completed externally. Report its result
        // honestly; the cancelled signal still gates every subsequent action.
        return { state: "complete", summary: `${actionLabel} completed`, result: output, activity: actionLabel };
      }
    }
  } catch (error) {
    return fail(request.kind, error);
  }
}

export function actionCapabilitySummary(context: Pick<HuskActionContext, "workspaceRoot" | "remoteWorkspace" | "fileToolsEnabled" | "mcpToolsEnabled">): string {
  const parts: string[] = [];
  if (context.fileToolsEnabled) parts.push(context.remoteWorkspace ? "remote workspace" : context.workspaceRoot ? "workspace" : "workspace (select folder)");
  if (context.mcpToolsEnabled) parts.push("integrations");
  parts.push("reviewed changes");
  return parts.join(" · ");
}
