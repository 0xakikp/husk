import { secretsGetAll } from "../secrets";

export type McpServerConfig = {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Environment variable → OS-keychain account. Only this reference is saved
      in local storage; the secret itself is resolved immediately before spawn. */
  secretEnv?: Record<string, string>;
  /** A first-party setup card that owns this server's connection flow. */
  integration?: "github";
  /** Provider-specific safety setting. GitHub starts read-only by default. */
  readOnly?: boolean;
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

/**
 * Materialise keychain-backed variables only at the process boundary. This
 * keeps MCP config shareable and inspectable without ever serialising tokens
 * into localStorage or the settings UI's server list.
 */
export async function resolveMcpServerEnv(server: McpServerConfig): Promise<Record<string, string>> {
  const env = { ...server.env };
  const secretEntries = Object.entries(server.secretEnv ?? {});
  if (secretEntries.length === 0) return env;

  const values = await secretsGetAll(secretEntries.map(([, account]) => account));
  secretEntries.forEach(([name], index) => {
    const value = values[index];
    if (value) env[name] = value;
  });
  return env;
}
