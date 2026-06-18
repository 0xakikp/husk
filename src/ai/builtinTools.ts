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

export function buildBuiltinTools(): Record<string, Tool> {
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
            addPendingEdit({ path, search: existing, replace: content });
            return `File ${path} already exists. Proposed overwrite queued for your review. Accept in the AI panel to apply.`;
          }
          // New file — write directly (safe)
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
          const content = await readFile(path);
          if (!content.includes(search)) {
            return `Error: search text not found in ${path}. The file may have changed.`;
          }
          addPendingEdit({ path, search, replace });
          return `Edit proposed for ${path}. User will review before applying.`;
        } catch (e) {
          return `Error proposing edit: ${e instanceof Error ? e.message : String(e)}`;
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
            const root = getWorkspaceRoot() || "/Users/akikp";
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
