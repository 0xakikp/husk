import { secretsDelete, secretsGetAll, secretsSet } from "../secrets";
import { persistNativeConfigSection } from "../settings/nativeConfig";

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

export const MCP_STORAGE_KEY = "huskv2.mcp.servers";

function isSecretEnvName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized.includes("token")
    || normalized.includes("secret")
    || normalized.includes("password")
    || normalized.includes("api_key")
    || normalized.includes("apikey")
    || normalized.includes("private_key");
}

function keychainAccount(serverId: string, name: string): string {
  return `mcp.${serverId}.${name.toLowerCase().replace(/[^a-z0-9_.-]/g, "-")}`;
}

/** A custom MCP form may receive KEY=value text. Move obviously sensitive
 * values into the OS keychain before anything reaches browser storage or
 * config.toml. The persisted config contains only the keychain reference. */
async function protectMcpSecrets(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const protectedServers: McpServerConfig[] = [];
  for (const server of servers) {
    const env = { ...server.env };
    const secretEnv = { ...(server.secretEnv ?? {}) };
    for (const [name, value] of Object.entries(env)) {
      if (!value || !isSecretEnvName(name)) continue;
      const account = secretEnv[name] ?? keychainAccount(server.id, name);
      await secretsSet(account, value);
      secretEnv[name] = account;
      delete env[name];
    }
    protectedServers.push({
      ...server,
      env,
      secretEnv: Object.keys(secretEnv).length > 0 ? secretEnv : undefined,
    });
  }
  return protectedServers;
}

export function loadMcpServers(): McpServerConfig[] {
  try {
    const raw = localStorage.getItem(MCP_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as McpServerConfig[]) : [];
  } catch {
    return [];
  }
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<void> {
  const safeServers = await protectMcpSecrets(servers);
  try {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(safeServers));
  } catch {
    // storage unavailable — keep in memory only
  }
  persistNativeConfigSection("mcp", { servers: safeServers });
}

export async function addMcpServer(server: Omit<McpServerConfig, "id">): Promise<McpServerConfig> {
  const added: McpServerConfig = { ...server, id: crypto.randomUUID() };
  const next = await protectMcpSecrets([...loadMcpServers(), added]);
  try {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  persistNativeConfigSection("mcp", { servers: next });
  return next.find((server) => server.id === added.id) ?? added;
}

export async function updateMcpServer(
  id: string,
  patch: Partial<Omit<McpServerConfig, "id">>,
): Promise<void> {
  await saveMcpServers(loadMcpServers().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export async function removeMcpServer(id: string): Promise<void> {
  const removed = loadMcpServers().find((server) => server.id === id);
  await saveMcpServers(loadMcpServers().filter((s) => s.id !== id));
  await Promise.all(Object.values(removed?.secretEnv ?? {}).map((account) => secretsDelete(account)));
}

/** Hydrate the synchronous compatibility cache at startup. The native TOML
 * document is authoritative after bootstrap; localStorage is only retained so
 * older call sites can stay synchronous during this migration. */
export function hydrateMcpServersFromNative(value: unknown): void {
  const servers = value && typeof value === "object" && Array.isArray((value as { servers?: unknown }).servers)
    ? (value as { servers: McpServerConfig[] }).servers
    : [];
  try {
    localStorage.setItem(MCP_STORAGE_KEY, JSON.stringify(servers));
  } catch {
    // The native config remains available next launch.
  }
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
