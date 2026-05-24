import { jsonSchema, tool, type Tool } from "ai";
import {
  callMcpTool,
  connectMcpServer,
  disconnectMcpServer,
  getAllMcpTools,
  type McpDiscoveredTool,
} from "./client";
import { loadMcpServers } from "./store";

let cachedDiscovered: McpDiscoveredTool[] = [];

/**
 * Connect to all enabled MCP servers and build AI SDK tools from their tools.
 * Call before an AI run to get a fresh tool set.
 */
export async function buildMcpTools(): Promise<Record<string, Tool>> {
  const enabled = loadMcpServers().filter((c) => c.enabled);

  // Drop servers that are no longer enabled.
  const enabledIds = new Set(enabled.map((c) => c.id));
  for (const id of new Set(getAllMcpTools().map((t) => t.serverId))) {
    if (!enabledIds.has(id)) await disconnectMcpServer(id);
  }

  // Connect enabled servers.
  for (const config of enabled) {
    try {
      await connectMcpServer(config.id, config.name, {
        command: config.command,
        args: config.args,
        env: config.env,
        cwd: config.cwd,
      });
    } catch (e) {
      console.warn(`[mcp] failed to connect to ${config.name}:`, e);
    }
  }

  cachedDiscovered = getAllMcpTools();

  const result: Record<string, Tool> = {};
  for (const t of cachedDiscovered) {
    result[`mcp_${t.serverId}_${t.name}`] = tool({
      description: `[${t.serverName}] ${t.description ?? t.name}`,
      inputSchema: jsonSchema(t.inputSchema as unknown as Record<string, unknown>),
      execute: async (input) => {
        try {
          return mcpResultToString(
            await callMcpTool(t.serverId, t.name, input as Record<string, unknown>),
          );
        } catch (e) {
          return `MCP tool error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  }
  return result;
}

function mcpResultToString(result: unknown): string {
  if (result == null) return "";
  if (typeof result === "string") return result;

  const r = result as Record<string, unknown>;
  if (Array.isArray(r.content)) {
    const parts: string[] = [];
    for (const item of r.content) {
      const typed = item as Record<string, unknown>;
      if (typed.type === "text" && typeof typed.text === "string") parts.push(typed.text);
      else if (typed.type === "image" || typed.type === "audio") parts.push(`[${typed.type} data]`);
      else if (typed.type === "resource") parts.push("[resource]");
      else parts.push(JSON.stringify(typed));
    }
    return parts.join("\n");
  }
  if (r.isError) return `Error: ${JSON.stringify(r)}`;
  return JSON.stringify(result, null, 2);
}

export function getMcpToolMeta(): Array<{
  serverId: string;
  serverName: string;
  name: string;
  description?: string;
}> {
  return cachedDiscovered.map((t) => ({
    serverId: t.serverId,
    serverName: t.serverName,
    name: t.name,
    description: t.description,
  }));
}
