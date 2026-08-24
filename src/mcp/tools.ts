import { jsonSchema, tool, type Tool } from "ai";
import {
  connectMcpServer,
  disconnectMcpServer,
  getAllMcpTools,
  type McpDiscoveredTool,
} from "./client";
import { loadMcpServers, resolveMcpServerEnv } from "./store";
import { reportMcpConnecting, reportMcpResult } from "./health";
import { executeHuskAction, type HuskActionContext } from "../ai/actionBroker";

let cachedDiscovered: McpDiscoveredTool[] = [];

/**
 * Connect to all enabled MCP servers and build AI SDK tools from their tools.
 * Call before an AI run to get a fresh tool set.
 */
export async function buildMcpTools(actionContext: Pick<HuskActionContext, "sessionId"> = {}): Promise<Record<string, Tool>> {
  const enabled = loadMcpServers().filter((c) => c.enabled);

  // Drop servers that are no longer enabled.
  const enabledIds = new Set(enabled.map((c) => c.id));
  for (const id of new Set(getAllMcpTools().map((t) => t.serverId))) {
    if (!enabledIds.has(id)) await disconnectMcpServer(id);
  }

  // Connect enabled servers.
  for (const config of enabled) {
    reportMcpConnecting(config.id);
    try {
      const env = await resolveMcpServerEnv(config);
      const tools = await connectMcpServer(config.id, config.name, {
        command: config.command,
        args: config.args,
        env,
        cwd: config.cwd,
        onExit: (error) => reportMcpResult(
          config.id,
          false,
          undefined,
          error?.message ?? "MCP server stopped",
        ),
      });
      reportMcpResult(config.id, true, tools.map((t) => t.name));
    } catch (e) {
      console.warn(`[mcp] failed to connect to ${config.name}:`, e);
      reportMcpResult(config.id, false, undefined, e instanceof Error ? e.message : String(e));
    }
  }

  cachedDiscovered = getAllMcpTools();

  const result: Record<string, Tool> = {};
  for (const t of cachedDiscovered) {
    result[`mcp_${t.serverId}_${t.name}`] = tool({
      description: `[${t.serverName}] ${t.description ?? t.name}`,
      inputSchema: jsonSchema(t.inputSchema as unknown as Record<string, unknown>),
      execute: async (input) => {
        const result = await executeHuskAction(
          { kind: "mcp.call", serverId: t.serverId, toolName: t.name, input: input as Record<string, unknown> },
          { ...actionContext, fileToolsEnabled: false, mcpToolsEnabled: true },
        );
        return result.result ?? result.summary;
      },
    });
  }
  return result;
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
