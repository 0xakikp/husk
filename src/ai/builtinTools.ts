import { tool, jsonSchema } from "ai";
import { readFile, writeFile, createDir, readDir } from "../fs";
import { addPendingEdit } from "./pendingEdits";
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
      description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Creates parent directories automatically.",
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
          // Ensure parent dir exists
          const lastSlash = path.lastIndexOf("/");
          if (lastSlash > 0) {
            await createDir(path.slice(0, lastSlash)).catch(() => {});
          }
          await writeFile(path, content);
          return `File written successfully: ${path}`;
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
  };
}

/** Merge built-in tools with MCP tools. Built-ins take precedence on name collision. */
export function mergeTools(
  builtin: Record<string, Tool>,
  mcp: Record<string, Tool>
): Record<string, Tool> {
  return { ...mcp, ...builtin };
}
