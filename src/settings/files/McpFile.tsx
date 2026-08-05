import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { connectMcpServer, disconnectMcpServer } from "@/mcp/client";
import {
  addMcpServer,
  loadMcpServers,
  removeMcpServer,
  resolveMcpServerEnv,
  updateMcpServer,
  type McpServerConfig,
} from "@/mcp/store";
import { secretsDelete, secretsGet, secretsSet } from "@/secrets";
import { Switch } from "@/components/ui/switch";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

const GITHUB_TOKEN_ACCOUNT = "mcp.github.personal-access-token";

function githubServerConfig(readOnly: boolean): Omit<McpServerConfig, "id"> {
  return {
    name: "GitHub",
    command: "docker",
    args: [
      "run",
      "-i",
      "--rm",
      "-e",
      "GITHUB_PERSONAL_ACCESS_TOKEN",
      "-e",
      "GITHUB_READ_ONLY",
      "ghcr.io/github/github-mcp-server",
    ],
    // Docker receives this non-secret policy value through `-e` above.
    env: { GITHUB_READ_ONLY: readOnly ? "1" : "0" },
    // The PAT itself is resolved from the OS keychain at process launch.
    secretEnv: { GITHUB_PERSONAL_ACCESS_TOKEN: GITHUB_TOKEN_ACCOUNT },
    integration: "github",
    readOnly,
    enabled: true,
  };
}

export function McpFile() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [githubTokenStored, setGithubTokenStored] = useState(false);

  const githubServer = servers.find((server) => server.integration === "github") ?? null;
  const customServers = servers.filter((server) => server.integration !== "github");

  const reload = () => {
    setError(null);
    setLoading(true);
    Promise.resolve(loadMcpServers())
      .then((s) => {
        setServers(s);
        setLoading(false);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e));
        setServers([]);
        setLoading(false);
      });
  };

  useEffect(() => {
    let cancelled = false;
    Promise.resolve(loadMcpServers())
      .then((s) => {
        if (cancelled) return;
        setServers(s);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setServers([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void secretsGet(GITHUB_TOKEN_ACCOUNT)
      .then((token) => {
        if (!cancelled) setGithubTokenStored(!!token);
      })
      .catch(() => {
        if (!cancelled) setGithubTokenStored(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateMcpServer(id, { enabled });
    setServers((prev) => prev.map((s) => (s.id === id ? { ...s, enabled } : s)));
    if (!enabled) await disconnectMcpServer(id);
  };

  const handleDelete = async (id: string) => {
    await disconnectMcpServer(id);
    await removeMcpServer(id);
    setServers((prev) => prev.filter((s) => s.id !== id));
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      await disconnectMcpServer(server.id);
      const env = await resolveMcpServerEnv(server);
      const tools = await connectMcpServer(server.id, server.name, {
        command: server.command,
        args: server.args,
        env,
        cwd: server.cwd,
      });
      setTestResult({
        id: server.id,
        ok: true,
        msg: `ok · ${tools.length} tool${tools.length === 1 ? "" : "s"}`,
      });
    } catch (e) {
      setTestResult({
        id: server.id,
        ok: false,
        msg: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setTestingId(null);
    }
  };

  const handleSave = async (config: Omit<McpServerConfig, "id"> & { id?: string }) => {
    if (config.id) {
      await updateMcpServer(config.id, config);
      setServers((prev) =>
        prev.map((s) => (s.id === config.id ? { ...(s as McpServerConfig), ...config, id: config.id } : s)),
      );
    } else {
      const added = await addMcpServer(config);
      setServers((prev) => [...prev, added]);
    }
    setFormOpen(false);
    setEditing(null);
  };

  const handleGithubSave = async ({ token, readOnly }: { token: string; readOnly: boolean }) => {
    const nextToken = token.trim();
    if (nextToken) {
      await secretsSet(GITHUB_TOKEN_ACCOUNT, nextToken);
      setGithubTokenStored(true);
    }

    // A token may already be in the keychain while the input is intentionally
    // blank, because we never read it back into an editable field.
    const storedToken = nextToken || await secretsGet(GITHUB_TOKEN_ACCOUNT);
    if (!storedToken) throw new Error("Add a GitHub personal access token first.");

    const nextConfig = githubServerConfig(readOnly);
    let saved: McpServerConfig;
    if (githubServer) {
      saved = { ...githubServer, ...nextConfig, id: githubServer.id };
      await updateMcpServer(githubServer.id, nextConfig);
      setServers((previous) => previous.map((server) => (server.id === githubServer.id ? saved : server)));
    } else {
      saved = await addMcpServer(nextConfig);
      setServers((previous) => [...previous, saved]);
    }

    await handleTest(saved);
  };

  const handleGithubDisconnect = async () => {
    if (githubServer) {
      await disconnectMcpServer(githubServer.id);
      await removeMcpServer(githubServer.id);
      setServers((previous) => previous.filter((server) => server.id !== githubServer.id));
    }
    await secretsDelete(GITHUB_TOKEN_ACCOUNT);
    setGithubTokenStored(false);
    setTestResult(null);
  };

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.mcp} />
      <CfgBlank />

      <IntegrationAccessNotice />
      <GitHubIntegration
        server={githubServer}
        tokenStored={githubTokenStored}
        testing={testingId === githubServer?.id}
        testResult={testResult?.id === githubServer?.id ? testResult : null}
        onSave={handleGithubSave}
        onToggle={(enabled) => githubServer && handleToggle(githubServer.id, enabled)}
        onTest={() => githubServer && handleTest(githubServer)}
        onDisconnect={handleGithubDisconnect}
      />
      <CfgBlank />

      {loading ? (
        <CfgComment>loading servers…</CfgComment>
      ) : error ? (
        <>
          <CfgComment>failed to load servers: {error}</CfgComment>
          <CfgRow>
            <CfgAct onClick={reload}>retry</CfgAct>
          </CfgRow>
        </>
      ) : customServers.length === 0 ? (
        <CfgComment>no custom servers configured — add one to give the AI more external tools</CfgComment>
      ) : (
        <>
          {customServers.map((server) => (
            <div key={server.id}>
              <CfgSection name="servers" array />
              <CfgRow name="name" comment="Server name, used to namespace its tools.">
                <CfgStr>{server.name}</CfgStr>
                {testResult?.id === server.id ? (
                  <span className={testResult.ok ? "cfg-num" : "cfg-hint"} style={testResult.ok ? undefined : { color: "#f87171" }}>
                    {testResult.ok ? testResult.msg : `failed: ${testResult.msg}`}
                  </span>
                ) : null}
              </CfgRow>
              <CfgRow name="command" comment="Executable that starts the server, e.g. npx or uvx.">
                <CfgStr>{server.command}</CfgStr>
              </CfgRow>
              <CfgRow name="args" comment="Arguments passed to the command, one per line.">
                <span className="cfg-punct">[</span>
                <span className="cfg-str">{server.args.map((a) => `"${a}"`).join(", ")}</span>
                <span className="cfg-punct">]</span>
              </CfgRow>
              <CfgRow name="enabled" comment="Load this server's tools into the AI. Disable to keep the config without running it.">
                <Switch checked={server.enabled} onCheckedChange={(v) => void handleToggle(server.id, v)} />
              </CfgRow>
              <CfgRow>
                <CfgAct onClick={() => void handleTest(server)}>
                  {testingId === server.id ? "testing…" : "test"}
                </CfgAct>
                <CfgAct
                  onClick={() => {
                    setEditing(server);
                    setFormOpen(true);
                  }}
                >
                  edit
                </CfgAct>
                <CfgAct onClick={() => void handleDelete(server.id)} danger>
                  delete
                </CfgAct>
              </CfgRow>
              <CfgBlank />
            </div>
          ))}
        </>
      )}

      {formOpen ? (
        <McpServerForm
          editing={editing}
          onCancel={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : (
        <CfgRow>
          <CfgAct
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            + add custom server
          </CfgAct>
        </CfgRow>
      )}
    </ConfigEditor>
  );
}

/** One integration-wide boundary, stated before a user connects any server.
    Terminal utilities have their own Command tools page; this applies only to
    MCP capabilities that an AI model needs to call. */
function IntegrationAccessNotice() {
  return (
    <aside className="settings-integration-notice" role="note">
      <span className="settings-integration-notice-mark" aria-hidden="true">i</span>
      <p>
        <strong>Connected tools require an API-key model.</strong>
        Select one in AI &amp; Models to use GitHub or another MCP server. Claude Code and Codex &ldquo;my subscription&rdquo; modes can chat, but cannot call connected tools.
      </p>
    </aside>
  );
}

function GitHubIntegration({
  server,
  tokenStored,
  testing,
  testResult,
  onSave,
  onToggle,
  onTest,
  onDisconnect,
}: {
  server: McpServerConfig | null;
  tokenStored: boolean;
  testing: boolean;
  testResult: { ok: boolean; msg: string } | null;
  onSave: (input: { token: string; readOnly: boolean }) => Promise<void>;
  onToggle: (enabled: boolean) => void;
  onTest: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [editingToken, setEditingToken] = useState(!tokenStored);
  const [readOnly, setReadOnly] = useState(server?.readOnly ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReadOnly(server?.readOnly ?? true);
  }, [server?.id, server?.readOnly]);

  useEffect(() => {
    if (!tokenStored) setEditingToken(true);
  }, [tokenStored]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({ token, readOnly });
      setToken("");
      setEditingToken(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const disconnect = async () => {
    setSaving(true);
    setError(null);
    try {
      await onDisconnect();
      setToken("");
      setEditingToken(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="settings-github-integration" aria-label="GitHub integration">
      <CfgSection name="connect.github" />
      <CfgComment>
        Connect GitHub&apos;s official MCP server. Docker must be installed and running; your token is stored in the OS keychain, never in MCP settings.
      </CfgComment>
      <CfgRow
        name="personalAccessToken"
        comment={tokenStored ? "A token is stored in your OS keychain." : "Use a fine-grained GitHub personal access token with only the repositories and permissions you need."}
      >
        {editingToken ? (
          <CfgText secret value={token} onChange={setToken} placeholder="github_pat_…" widthCh={34} />
        ) : (
          <>
            <CfgStr>stored in OS keychain</CfgStr>
            <CfgAct onClick={() => setEditingToken(true)}>replace</CfgAct>
          </>
        )}
      </CfgRow>
      <CfgRow
        name="readOnly"
        comment="Starts enabled. Keep this on to prevent the assistant from changing repositories, issues, pull requests, or other GitHub data."
      >
        <Switch checked={readOnly} onCheckedChange={setReadOnly} />
      </CfgRow>
      {server ? (
        <CfgRow name="enabled" comment="Load GitHub tools into the assistant when it runs.">
          <Switch checked={server.enabled} onCheckedChange={onToggle} />
        </CfgRow>
      ) : null}
      <CfgRow name="status" comment="Test starts the official MCP server and lists the tools Husk can use.">
        <CfgStr>{server ? (server.enabled ? "configured" : "configured · disabled") : "not connected"}</CfgStr>
        {testResult ? (
          <span className={testResult.ok ? "cfg-num" : "cfg-hint"} style={testResult.ok ? undefined : { color: "#f87171" }}>
            {testResult.ok ? testResult.msg : `failed: ${testResult.msg}`}
          </span>
        ) : null}
      </CfgRow>
      {error ? <CfgComment>GitHub setup failed: {error}</CfgComment> : null}
      <CfgRow>
        <CfgAct onClick={() => void save()}>{saving ? "connecting…" : server ? "save & test" : "connect & test"}</CfgAct>
        {server ? <CfgAct onClick={onTest}>{testing ? "testing…" : "test"}</CfgAct> : null}
        {server ? <CfgAct onClick={() => void disconnect()} danger>disconnect</CfgAct> : null}
      </CfgRow>
    </section>
  );
}

/** In-place editor using the same section-and-row pattern as every other
 * settings surface. Its validation and saved payload are unchanged. */
function McpServerForm({
  editing,
  onCancel,
  onSave,
}: {
  editing: McpServerConfig | null;
  onCancel: () => void;
  onSave: (config: Omit<McpServerConfig, "id"> & { id?: string }) => void;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [cwd, setCwd] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (editing) {
      setName(editing.name);
      setCommand(editing.command);
      setArgs(editing.args.join(" "));
      setEnv(Object.entries(editing.env).map(([k, v]) => `${k}=${v}`).join("\n"));
      setCwd(editing.cwd ?? "");
      setEnabled(editing.enabled);
    } else {
      setName("");
      setCommand("");
      setArgs("");
      setEnv("");
      setCwd("");
      setEnabled(true);
    }
  }, [editing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !command.trim()) return;
    const envMap: Record<string, string> = {};
    for (const line of env.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx > 0) envMap[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
    }
    onSave({
      id: editing?.id,
      name: name.trim(),
      command: command.trim(),
      args: args.trim().split(/\s+/).filter((s) => s.length > 0),
      env: envMap,
      secretEnv: editing?.secretEnv,
      integration: editing?.integration,
      readOnly: editing?.readOnly,
      cwd: cwd.trim() || undefined,
      enabled,
    });
  };

  return (
    <section className="mcp-inline-form" aria-label={editing ? "Edit MCP server" : "Add MCP server"}>
      <CfgSection name={editing ? "edit_server" : "add_custom_server"} />
      <form onSubmit={handleSubmit}>
        <CfgRow name="name" comment="A short label for this server in the integrations list.">
          <Input className="mcp-inline-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Filesystem" required />
        </CfgRow>
        <CfgRow name="command" comment="The executable that starts the server, for example npx or uvx.">
          <Input className="mcp-inline-input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. npx" required />
        </CfgRow>
        <CfgRow name="arguments" comment="Arguments passed to the command, separated by spaces.">
          <Input className="mcp-inline-input" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path" />
        </CfgRow>
        <CfgRow name="environment" comment="Optional KEY=value entries, one per line. Token, secret, password, and API-key values are moved to your OS keychain automatically.">
          <textarea className="mcp-inline-textarea" value={env} onChange={(e) => setEnv(e.target.value)} placeholder={`LOG_LEVEL=debug\nAPI_TOKEN=stored securely`} rows={4} />
        </CfgRow>
        <CfgRow name="workingDirectory" comment="Optional directory where Husk starts the server.">
          <Input className="mcp-inline-input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/dir" />
        </CfgRow>
        <CfgRow name="enabled" comment="Load this server's tools into the AI as soon as it is saved.">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </CfgRow>
        <CfgRow>
          <CfgAct onClick={onCancel}>cancel</CfgAct>
          <button type="submit" className="cfg-act">[ {editing ? "save changes" : "add server"} ]</button>
        </CfgRow>
      </form>
    </section>
  );
}
