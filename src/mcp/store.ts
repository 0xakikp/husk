export type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  cwd?: string;
};

const LS_KEY = "huskv2.mcp.servers";

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as McpServerConfig[]) : [];
  } catch {
    return [];
  }
}

export function saveMcpServers(servers: McpServerConfig[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(servers));
  } catch {
    // storage unavailable — keep in memory only
  }
}

export function addMcpServer(server: Omit<McpServerConfig, "id">): McpServerConfig {
  const added: McpServerConfig = { ...server, id: crypto.randomUUID() };
  saveMcpServers([...loadMcpServers(), added]);
  return added;
}

export function updateMcpServer(
  id: string,
  patch: Partial<Omit<McpServerConfig, "id">>,
): void {
  saveMcpServers(loadMcpServers().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export function removeMcpServer(id: string): void {
  saveMcpServers(loadMcpServers().filter((s) => s.id !== id));
}
