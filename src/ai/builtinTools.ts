import { tool, jsonSchema } from "ai";
import {
  createDirScoped,
  readDirScoped,
  readFileScoped,
  writeFileScoped,
} from "../fs";
import { addPendingEdit } from "./pendingEdits";
import {
  buildCodebaseIndex,
  searchCodebase,
  formatSearchResults,
  getCodebaseIndex,
  getIndexedRoot,
} from "./codebaseSearch";
import { getWorkspaceRoot } from "../workspace/store";
import { normalizeWorkspacePath, resolveWorkspacePath } from "./workspaceScope";
import type { Tool } from "ai";

/**
 * Built-in tools for the AI bubble — file operations, edits, directory listing.
 * These run locally via Tauri FS APIs, no MCP server needed.
 */

export function buildBuiltinTools(
  sessionId?: string,
  /** `null` means this chat deliberately has no workspace scope. */
  selectedWorkspaceRoot: string | null = getWorkspaceRoot(),
): Record<string, Tool> {
  const workspaceRoot = normalizeWorkspacePath(selectedWorkspaceRoot);
  const resolvePath = (path: string): string | null => resolveWorkspacePath(path, workspaceRoot);
  const scopeMessage = (path?: string): string => {
    if (!workspaceRoot) {
      return "Refused: this chat has no workspace selected. Choose a folder from the chat header before using file tools.";
    }
    return `Refused: ${path || "that path"} is outside this chat's selected workspace (${workspaceRoot}). Choose another folder or use a path inside it.`;
  };

  return {
    readFile: tool({
      description: "Read a file inside the selected workspace. Paths may be workspace-relative or absolute within that workspace.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        const resolved = resolvePath(path);
        if (!resolved) return scopeMessage(path);
        try {
          const content = await readFileScoped(resolved, workspaceRoot);
          return content;
        } catch (e) {
          return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    writeFile: tool({
      description: "Write content inside the selected workspace. For small changes prefer applyEdit. Existing files are always proposed for review.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        const resolved = resolvePath(path);
        if (!resolved) return scopeMessage(path);
        try {
          // Check if file exists — if so, queue as pending edit for review
          const existing = await readFileScoped(resolved, workspaceRoot).catch(() => null);
          if (existing !== null) {
            // File exists — queue as a full-file pending edit for approval
            addPendingEdit({ path: resolved, search: existing, replace: content, sessionId, workspaceRoot });
            return `File ${resolved} already exists. Proposed overwrite queued for your review. Accept in the AI panel to apply.`;
          }
          // The native scoped commands re-check the boundary, including symlinks.
          const lastSlash = resolved.lastIndexOf("/");
          if (lastSlash > 0) {
            await createDirScoped(resolved.slice(0, lastSlash), workspaceRoot).catch(() => {});
          }
          await writeFileScoped(resolved, content, workspaceRoot);
          return `New file created: ${resolved}`;
        } catch (e) {
          return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    listFiles: tool({
      description: "List files and directories inside the selected workspace. Use '.' for its root.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path. Use '.' for workspace root." },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        const resolved = resolvePath(path);
        if (!resolved) return scopeMessage(path);
        try {
          const entries = await readDirScoped(resolved, workspaceRoot);
          if (!entries.length) return "Directory is empty.";
          return entries
            .map((e: { is_dir: boolean; name: string }) => `- ${e.is_dir ? "📁" : "📄"} ${e.name}${e.is_dir ? "/" : ""}`)
            .join("\n");
        } catch (e: any) {
          return `Error listing directory: ${e?.message ?? String(e)}`;
        }
      },
    }),

    applyEdit: tool({
      description: "Propose a surgical edit to a file inside the selected workspace. The user reviews a diff before applying.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          search: { type: "string", description: "Exact text to find (including whitespace)" },
          replace: { type: "string", description: "Replacement text" },
        },
        required: ["path", "search", "replace"],
      }),
      execute: async ({ path, search, replace }) => {
        const resolved = resolvePath(path);
        if (!resolved) return scopeMessage(path);
        try {
          const content = await readFileScoped(resolved, workspaceRoot).catch(() => null);
          if (content === null) {
            return `Error: file not found: ${resolved}`;
          }
          if (!content.includes(search)) {
            return `Error: search text not found in ${resolved}. The file may have changed.`;
          }
          addPendingEdit({ path: resolved, search, replace, sessionId, workspaceRoot });
          return `Edit proposed for ${resolved}. Review and accept in the AI panel.`;
        } catch (e) {
          return `Error proposing edit: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    revertPendingEdit: tool({
      description: "Revert/cancel a pending edit for a file. Use this when the user asks to undo a change that was queued but not yet applied.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "File path of the pending edit to cancel" },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        const resolved = resolvePath(path);
        if (!resolved) return scopeMessage(path);
        try {
          const { getPendingEdits, removePendingEdit } = await import("./pendingEdits");
          const edits = getPendingEdits().filter((e) =>
            e.path === resolved && e.workspaceRoot === workspaceRoot &&
            (!sessionId || e.sessionId === sessionId || e.sessionId === undefined),
          );
          if (edits.length === 0) {
            return `No pending edits found for ${resolved}.`;
          }
          for (const edit of edits) {
            removePendingEdit(edit.id);
          }
          return `Reverted ${edits.length} pending edit(s) for ${path}. The original content is preserved.`;
        } catch (e) {
          return `Error reverting: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    searchCodebase: tool({
      description: "Search the selected workspace for files, functions, or concepts. Builds an index for that workspace on first use.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language query or keywords to search for (e.g., 'auth middleware', 'user login', 'docker config')" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["query"],
      }),
      execute: async ({ query, limit = 10 }) => {
        if (!workspaceRoot) return scopeMessage();
        try {
          const idx = getCodebaseIndex();
          if (!idx || idx.size === 0 || getIndexedRoot() !== workspaceRoot) {
            await buildCodebaseIndex(workspaceRoot);
          }
          const results = searchCodebase(query, limit);
          return formatSearchResults(results);
        } catch (e) {
          return `Error searching codebase: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),
  };
}

/** Merge built-in tools with MCP tools. Built-ins take precedence on name collision. */
export function mergeTools(
  builtin: Record<string, Tool>,
  mcp: Record<string, Tool>
): Record<string, Tool> {
  return { ...mcp, ...builtin };
}
