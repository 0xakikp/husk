import { tool, jsonSchema } from "ai";
import { readFile, writeFile, createDir, readDir } from "../fs";
import { addPendingEdit } from "./pendingEdits";
import { buildCodebaseIndex, searchCodebase, formatSearchResults, getCodebaseIndex } from "./codebaseSearch";
import { getWorkspaceRoot } from "../workspace/store";
import type { Tool } from "ai";

/**
 * Built-in tools for the AI bubble — file operations, edits, directory listing.
 * These run locally via Tauri FS APIs, no MCP server needed.
 */

/**
 * Writes are confined to the open workspace.
 *
 * The Rust side only rejects ".." and relative paths (fs.rs validate_path), so any
 * absolute path was previously writable. Combined with writeFile treating a
 * non-existent file as "safe" to create without review, that allowed silently
 * creating files that execute later — ~/Library/LaunchAgents/*.plist at login,
 * ~/.zshenv at every shell, ~/.ssh/authorized_keys — none of which needs "..",
 * and none of which is an overwrite. "It did not exist yet" is not a safety
 * property. This does not require a malicious model, only a confused one.
 */
function insideWorkspace(path: string): boolean {
  const root = getWorkspaceRoot();
  if (!root) return false;
  const trim = (p: string) => p.replace(/\/+$/, "");
  const r = trim(root);
  return path === r || path.startsWith(`${r}/`);
}

function outsideWorkspaceMessage(path: string): string {
  const root = getWorkspaceRoot();
  return root
    ? `Refused: ${path} is outside the open workspace (${root}). Ask the user to open that folder as a workspace, or choose a path inside it.`
    : `Refused: no workspace is open, so there is nowhere safe to write. Ask the user to open a folder first.`;
}

export function buildBuiltinTools(sessionId?: string): Record<string, Tool> {
  return {
    readFile: tool({
      description: "Read the contents of a file at the given path. Returns the full text or an error message.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        try {
          const content = await readFile(path);
          return content;
        } catch (e) {
          return `Error reading file: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    writeFile: tool({
      description: "Write content to a file. For small changes prefer applyEdit. For new files or full rewrites, the user will review before applying.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute or workspace-relative file path" },
          content: { type: "string", description: "Full file content to write" },
        },
        required: ["path", "content"],
      }),
      execute: async ({ path, content }) => {
        try {
          // Check if file exists — if so, queue as pending edit for review
          const existing = await readFile(path).catch(() => null);
          if (existing !== null) {
            // File exists — queue as a full-file pending edit for approval
            addPendingEdit({ path, search: existing, replace: content, sessionId });
            return `File ${path} already exists. Proposed overwrite queued for your review. Accept in the AI panel to apply.`;
          }
          // New file. Only create it without review when it lands inside the
          // workspace — see insideWorkspace above for why "new" is not "safe".
          if (!insideWorkspace(path)) return outsideWorkspaceMessage(path);
          const lastSlash = path.lastIndexOf("/");
          if (lastSlash > 0) {
            await createDir(path.slice(0, lastSlash)).catch(() => {});
          }
          await writeFile(path, content);
          return `New file created: ${path}`;
        } catch (e) {
          return `Error writing file: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    }),

    listFiles: tool({
      description: "List files and directories in a given directory. Returns a markdown list.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path. Use '.' for workspace root." },
        },
        required: ["path"],
      }),
      execute: async ({ path }) => {
        try {
          const entries = await readDir(path);
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
      description: "Propose a surgical edit to a file. The user will review a diff before applying. Use this for small changes rather than rewriting entire files.",
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
        try {
          const content = await readFile(path).catch(() => null);
          if (content === null) {
            return `Error: file not found: ${path}`;
          }
          if (!content.includes(search)) {
            return `Error: search text not found in ${path}. The file may have changed.`;
          }
          addPendingEdit({ path, search, replace, sessionId });
          return `Edit proposed for ${path}. Review and accept in the AI panel.`;
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
        try {
          const { getPendingEdits, removePendingEdit } = await import("./pendingEdits");
          const edits = getPendingEdits().filter((e) =>
            e.path === path && (!sessionId || e.sessionId === sessionId || e.sessionId === undefined),
          );
          if (edits.length === 0) {
            return `No pending edits found for ${path}.`;
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
      description: "Search the codebase for files, functions, or concepts. Use this when the user asks about code location, implementation details, or wants to find where something is defined. Builds an index on first use if needed. Returns ranked results with line numbers and snippets.",
      inputSchema: jsonSchema({
        type: "object",
        properties: {
          query: { type: "string", description: "Natural language query or keywords to search for (e.g., 'auth middleware', 'user login', 'docker config')" },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
        required: ["query"],
      }),
      execute: async ({ query, limit = 10 }) => {
        try {
          const idx = getCodebaseIndex();
          if (!idx || idx.size === 0) {
            const root = getWorkspaceRoot() || "/";
            await buildCodebaseIndex(root);
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
