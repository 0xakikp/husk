import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { TauriMcpTransport, type TauriMcpTransportOptions } from "./transport";

export type McpDiscoveredTool = Tool & { serverId: string; serverName: string };

const clients = new Map<string, Client>();
const discoveredTools = new Map<string, McpDiscoveredTool[]>();

/** Connect to an MCP server and discover its tools. */
export async function connectMcpServer(
  serverId: string,
  serverName: string,
  options: TauriMcpTransportOptions,
): Promise<McpDiscoveredTool[]> {
  await disconnectMcpServer(serverId);

  const requestedExitHandler = options.onExit;
  const transport = new TauriMcpTransport({
    ...options,
    onExit: (error) => {
      clients.delete(serverId);
      discoveredTools.delete(serverId);
      requestedExitHandler?.(error);
    },
  });
  const client = new Client({ name: "huskv2", version: "1.0.0" });
  await client.connect(transport);
  clients.set(serverId, client);

  const toolsResult = await client.listTools();
  const tools: McpDiscoveredTool[] = (toolsResult.tools ?? []).map((t) => ({
    ...t,
    serverId,
    serverName,
  }));
  discoveredTools.set(serverId, tools);
  return tools;
}

export async function disconnectMcpServer(serverId: string): Promise<void> {
  const client = clients.get(serverId);
  if (client) {
    try {
      await client.close();
    } catch {
      // ignore
    }
    clients.delete(serverId);
  }
  discoveredTools.delete(serverId);
}

export async function callMcpTool(
  serverId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const client = clients.get(serverId);
  if (!client) throw new Error(`MCP server ${serverId} is not connected`);
  return client.callTool({ name, arguments: args });
}

export function getAllMcpTools(): McpDiscoveredTool[] {
  const out: McpDiscoveredTool[] = [];
  for (const tools of discoveredTools.values()) out.push(...tools);
  return out;
}

export async function disconnectAllMcpServers(): Promise<void> {
  for (const id of [...clients.keys()]) await disconnectMcpServer(id);
}
