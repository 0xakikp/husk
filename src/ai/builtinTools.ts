import { jsonSchema, tool, type Tool } from "ai";
import { getWorkspaceRoot } from "../workspace/store";
import { executeHuskAction, type HuskActionContext } from "./actionBroker";
import type { RemoteWorkspaceScope } from "./remoteWorkspace";

/**
 * API tool declarations are deliberately thin adapters over the Husk Action
 * Broker. Signed-in CLI models use the same broker through `husk-action`
 * proposals, so neither provider class owns a separate filesystem policy.
 */
export function buildBuiltinTools(
  sessionId?: string,
  selectedWorkspaceRoot: string | null = getWorkspaceRoot(),
  remoteWorkspace?: RemoteWorkspaceScope,
  options: Pick<HuskActionContext, "workspaceEditAccess" | "autoApply" | "signal"> = {},
): Record<string, Tool> {
  const context: HuskActionContext = {
    sessionId,
    workspaceRoot: selectedWorkspaceRoot,
    remoteWorkspace,
    fileToolsEnabled: true,
    mcpToolsEnabled: false,
    ...options,
  };
  const run = async (request: Parameters<typeof executeHuskAction>[0], abortSignal?: AbortSignal) => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const signals = [context.signal, abortSignal].filter((signal): signal is AbortSignal => !!signal);
    for (const signal of signals) {
      if (signal.aborted) cancel();
      signal.addEventListener("abort", cancel, { once: true });
    }
    try {
      const result = await executeHuskAction(request, { ...context, signal: controller.signal });
      return result;
    } finally {
      for (const signal of signals) signal.removeEventListener("abort", cancel);
    }
  };

  const tools: Record<string, Tool> = {
    readFile: tool({
      description: "Read a file inside the selected workspace. Paths may be workspace-relative or absolute within that workspace.",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
      execute: ({ path }, { abortSignal }) => run({ kind: "workspace.read", path }, abortSignal),
    }),
    writeFile: tool({
      description: "Propose a new file or a complete overwrite inside the selected workspace. Requires the chat's edit permission; changes are reviewed unless eligible for the user's auto-apply setting.",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] }),
      execute: ({ path, content }, { abortSignal }) => run({ kind: "workspace.write", path, content }, abortSignal),
    }),
    listFiles: tool({
      description: "List files and directories inside the selected workspace. Use '.' for its root.",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
      execute: ({ path }, { abortSignal }) => run({ kind: "workspace.list", path }, abortSignal),
    }),
    inspectProject: tool({
      description: "Create a bounded Project Lens snapshot of the selected workspace: root structure, known manifests, package commands, detected stack, and Git state. Prefer this when the user asks what a project is or how it is organised.",
      inputSchema: jsonSchema({ type: "object", properties: {}, additionalProperties: false }),
      execute: (_, { abortSignal }) => run({ kind: "workspace.inspect" }, abortSignal),
    }),
    applyEdit: tool({
      description: "Propose a surgical edit to a file inside the selected workspace. The user reviews a diff before applying.",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" }, search: { type: "string" }, replace: { type: "string" } }, required: ["path", "search", "replace"] }),
      execute: ({ path, search, replace }, { abortSignal }) => run({ kind: "workspace.edit", path, search, replace }, abortSignal),
    }),
    revertPendingEdit: tool({
      description: "Discard a pending edit for a file inside the selected workspace.",
      inputSchema: jsonSchema({ type: "object", properties: { path: { type: "string" } }, required: ["path"] }),
      execute: ({ path }, { abortSignal }) => run({ kind: "workspace.revertEdit", path }, abortSignal),
    }),
  };

  // Remote search would require crawling an arbitrary server. Keep the remote
  // surface deliberately bounded to explicit list/read/inspect operations.
  if (!remoteWorkspace) {
    tools.searchCodebase = tool({
      description: "Search the selected workspace for files, functions, or concepts.",
      inputSchema: jsonSchema({ type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] }),
      execute: ({ query, limit }, { abortSignal }) => run({ kind: "workspace.search", query, ...(typeof limit === "number" ? { limit } : {}) }, abortSignal),
    });
  }

  return tools;
}

/** Merge built-in tools with MCP tools. Built-ins take precedence on name collision. */
export function mergeTools(builtin: Record<string, Tool>, mcp: Record<string, Tool>): Record<string, Tool> {
  return { ...mcp, ...builtin };
}
