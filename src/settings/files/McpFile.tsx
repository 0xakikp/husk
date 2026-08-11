import { useEffect, useState, type ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { disconnectMcpServer } from "@/mcp/client";
import { getMcpHealth, testMcpConnection, useMcpHealth } from "@/mcp/health";
import {
  addMcpServer,
  loadMcpServers,
  removeMcpServer,
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
  CfgBlock,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

const GITHUB_TOKEN_ACCOUNT = "mcp.github.personal-access-token";

type McpView =
  | { kind: "overview" }
  | { kind: "github" }
  | { kind: "server"; id: string }
  | { kind: "add" };

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
  const [view, setView] = useState<McpView>({ kind: "overview" });
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
    setView({ kind: "overview" });
  };

  const handleTest = async (server: McpServerConfig) => {
    setTestingId(server.id);
    setTestResult(null);
    try {
      await disconnectMcpServer(server.id);
      await testMcpConnection(server);
      const h = getMcpHealth(server.id);
      setTestResult(
        h.state === "connected"
          ? { id: server.id, ok: true, msg: `ok · ${h.toolCount ?? 0} tool${h.toolCount === 1 ? "" : "s"}` }
          : { id: server.id, ok: false, msg: h.message ?? "connection failed" },
      );
    } finally {
      setTestingId(null);
    }
  };

  const handleSave = async (config: Omit<McpServerConfig, "id"> & { id?: string }) => {
    let saved: McpServerConfig;
    if (config.id) {
      saved = { ...(servers.find((server) => server.id === config.id) as McpServerConfig), ...config, id: config.id };
      await updateMcpServer(config.id, config);
      setServers((prev) =>
        prev.map((s) => (s.id === config.id ? { ...(s as McpServerConfig), ...config, id: config.id } : s)),
      );
    } else {
      saved = await addMcpServer(config);
      setServers((prev) => [...prev, saved]);
    }
    setView({ kind: "server", id: saved.id });
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

  const selectedServer = view.kind === "server"
    ? servers.find((server) => server.id === view.id) ?? null
    : null;

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.mcp} />
      <CfgBlank />

      {view.kind === "overview" ? (
        <>
          <IntegrationAccessNotice />
          {loading ? (
            <CfgComment>loading servers…</CfgComment>
          ) : error ? (
            <>
              <CfgComment>failed to load servers: {error}</CfgComment>
              <CfgRow><CfgAct onClick={reload}>retry</CfgAct></CfgRow>
            </>
          ) : (
            <McpOverview
              githubServer={githubServer}
              customServers={customServers}
              testingId={testingId}
              testResult={testResult}
              onOpenGithub={() => setView({ kind: "github" })}
              onOpenServer={(id) => setView({ kind: "server", id })}
              onAdd={() => setView({ kind: "add" })}
              onToggle={handleToggle}
              onTest={handleTest}
            />
          )}
        </>
      ) : view.kind === "github" ? (
        <McpInspectorFrame
          title="GitHub"
          subtitle="Official GitHub MCP server"
          onBack={() => setView({ kind: "overview" })}
        >
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
        </McpInspectorFrame>
      ) : view.kind === "add" ? (
        <McpInspectorFrame
          title="Connect server"
          subtitle="Add a custom MCP server"
          onBack={() => setView({ kind: "overview" })}
        >
          <McpServerForm editing={null} onCancel={() => setView({ kind: "overview" })} onSave={handleSave} />
        </McpInspectorFrame>
      ) : selectedServer ? (
        <McpServerInspector
          server={selectedServer}
          testing={testingId === selectedServer.id}
          testResult={testResult?.id === selectedServer.id ? testResult : null}
          onBack={() => setView({ kind: "overview" })}
          onSave={handleSave}
          onToggle={(enabled) => handleToggle(selectedServer.id, enabled)}
          onTest={() => handleTest(selectedServer)}
          onDelete={() => handleDelete(selectedServer.id)}
        />
      ) : (
        <CfgRow><CfgAct onClick={() => setView({ kind: "overview" })}>back to servers</CfgAct></CfgRow>
      )}
    </ConfigEditor>
  );
}

function McpOverview({
  githubServer,
  customServers,
  testingId,
  testResult,
  onOpenGithub,
  onOpenServer,
  onAdd,
  onToggle,
  onTest,
}: {
  githubServer: McpServerConfig | null;
  customServers: McpServerConfig[];
  testingId: string | null;
  testResult: { id: string; ok: boolean; msg: string } | null;
  onOpenGithub: () => void;
  onOpenServer: (id: string) => void;
  onAdd: () => void;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onTest: (server: McpServerConfig) => Promise<void>;
}) {
  const count = customServers.length + (githubServer ? 1 : 0);

  return (
    <>
      <CfgSection name="servers" />
      <section className="mcp-overview" aria-label="MCP servers">
        <div className="mcp-overview-topline">
          <div>
            <p className="mcp-overview-title">Connected services <span>{count}</span></p>
            <p className="mcp-overview-copy">Open a server to inspect or change its configuration.</p>
          </div>
          <CfgAct onClick={onAdd}>+ connect server</CfgAct>
        </div>

        <div className="mcp-summary-list">
          <McpServerSummary
            title="GitHub"
            description={githubServer ? "Official GitHub MCP server · credentials in OS keychain" : "Official GitHub MCP server · not connected"}
            server={githubServer}
            testing={testingId === githubServer?.id}
            testResult={testResult?.id === githubServer?.id ? testResult : null}
            onOpen={onOpenGithub}
            onToggle={onToggle}
            onTest={onTest}
          />
          {customServers.map((server) => (
            <McpServerSummary
              key={server.id}
              title={server.name}
              description={formatMcpCommand(server)}
              server={server}
              testing={testingId === server.id}
              testResult={testResult?.id === server.id ? testResult : null}
              onOpen={() => onOpenServer(server.id)}
              onToggle={onToggle}
              onTest={onTest}
            />
          ))}
        </div>

        {customServers.length === 0 ? (
          <p className="mcp-overview-empty">No custom servers yet. Connect one when you want the assistant to reach another service.</p>
        ) : null}
      </section>
    </>
  );
}

function formatMcpCommand(server: McpServerConfig) {
  const args = server.args.join(" ");
  return args ? `${server.command} · ${args}` : server.command;
}

function McpServerSummary({
  title,
  description,
  server,
  testing,
  testResult,
  onOpen,
  onToggle,
  onTest,
}: {
  title: string;
  description: string;
  server: McpServerConfig | null;
  testing: boolean;
  testResult: { ok: boolean; msg: string } | null;
  onOpen: () => void;
  onToggle: (id: string, enabled: boolean) => Promise<void>;
  onTest: (server: McpServerConfig) => Promise<void>;
}) {
  const health = useMcpHealth(server?.id ?? "github-mcp");
  const state = testResult
    ? testResult.ok ? testResult.msg : `failed: ${testResult.msg}`
    : !server ? "not connected"
      : health.state === "connected" ? `connected${health.toolCount != null ? ` · ${health.toolCount} tool${health.toolCount === 1 ? "" : "s"}` : ""}`
        : health.state === "error" ? "connection error"
          : server.enabled ? "configured" : "disabled";

  return (
    <article className="mcp-summary-row">
      <button type="button" className="mcp-summary-main" onClick={onOpen}>
        <span className={`mcp-summary-dot ${server?.enabled ? "is-enabled" : ""}`} aria-hidden="true" />
        <span className="mcp-summary-copy">
          <span className="mcp-summary-name">{title}</span>
          <span className="mcp-summary-description">{description}</span>
        </span>
        <span className={testResult && !testResult.ok ? "mcp-summary-state is-error" : "mcp-summary-state"}>{state}</span>
        <span className="mcp-summary-chevron" aria-hidden="true">›</span>
      </button>
      {server ? (
        <div className="mcp-summary-controls" onClick={(event) => event.stopPropagation()}>
          <Switch checked={server.enabled} onCheckedChange={(enabled) => void onToggle(server.id, enabled)} />
          <button type="button" className="mcp-summary-test" onClick={() => void onTest(server)}>
            {testing ? "testing…" : "test"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

function McpInspectorFrame({
  title,
  subtitle,
  onBack,
  actions,
  children,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mcp-inspector" aria-label={`${title} MCP server`}>
      <div className="mcp-inspector-head">
        <button type="button" className="mcp-inspector-back" onClick={onBack}>← all servers</button>
        <div className="mcp-inspector-title">
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        {actions ? <div className="mcp-inspector-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

function McpServerInspector({
  server,
  testing,
  testResult,
  onBack,
  onSave,
  onToggle,
  onTest,
  onDelete,
}: {
  server: McpServerConfig;
  testing: boolean;
  testResult: { ok: boolean; msg: string } | null;
  onBack: () => void;
  onSave: (config: Omit<McpServerConfig, "id"> & { id?: string }) => Promise<void>;
  onToggle: (enabled: boolean) => Promise<void>;
  onTest: () => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    setEditing(false);
  }, [server.id]);

  return (
    <McpInspectorFrame
      title={server.name}
      subtitle={formatMcpCommand(server)}
      onBack={onBack}
      actions={
        editing ? undefined : (
          <>
            <CfgAct onClick={() => void onTest()}>{testing ? "testing…" : "test"}</CfgAct>
            <CfgAct onClick={() => setEditing(true)}>edit</CfgAct>
          </>
        )
      }
    >
      {editing ? (
        <McpServerForm
          editing={server}
          onCancel={() => setEditing(false)}
          onSave={(config) => void onSave(config).then(() => setEditing(false))}
        />
      ) : (
        <>
          <CfgSection name="connection" />
          <CfgRow name="command" comment="Executable Husk runs when the AI needs this integration.">
            <CfgStr>{server.command}</CfgStr>
          </CfgRow>
          <CfgRow name="enabled" comment="Load this server's tools into an API-key-backed AI model.">
            <Switch checked={server.enabled} onCheckedChange={(enabled) => void onToggle(enabled)} />
          </CfgRow>
          {testResult ? (
            <CfgRow name="lastTest" comment="Result from the latest manual connection test.">
              <span className={testResult.ok ? "cfg-num" : "cfg-hint"} style={testResult.ok ? undefined : { color: "#f87171" }}>
                {testResult.ok ? testResult.msg : `failed: ${testResult.msg}`}
              </span>
            </CfgRow>
          ) : null}
          <McpHealthRow serverId={server.id} readOnly={server.readOnly} />

          <details className="mcp-advanced">
            <summary>
              <span>Advanced configuration</span>
              <small>Arguments, environment, working directory</small>
            </summary>
            <div className="mcp-advanced-content">
              <McpReadOnlyValue label="Arguments" value={server.args.length ? server.args.join(" ") : "No arguments"} />
              <McpReadOnlyValue label="Environment" value={Object.keys(server.env).length ? Object.entries(server.env).map(([key, value]) => `${key}=${value}`).join("\n") : "No environment variables"} />
              <McpReadOnlyValue label="Working directory" value={server.cwd ?? "Use the current workspace"} />
            </div>
          </details>

          <div className="mcp-danger-zone">
            <span>Remove this server and disconnect its tools.</span>
            <CfgAct onClick={() => void onDelete()} danger>disconnect</CfgAct>
          </div>
        </>
      )}
    </McpInspectorFrame>
  );
}

function McpReadOnlyValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="mcp-advanced-value">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}

/** Runtime status + tool inventory for one server. Configuration never means
    a server actually connected — this row shows only observed handshakes. */
function McpHealthRow({ serverId, readOnly }: { serverId: string; readOnly?: boolean }) {
  const health = useMcpHealth(serverId);
  const [showTools, setShowTools] = useState(false);

  const checkedAgo = (() => {
    if (!health.checkedAt) return null;
    const secs = Math.max(0, Math.floor((Date.now() - health.checkedAt) / 1000));
    if (secs < 10) return "just now";
    if (secs < 60) return `${secs}s ago`;
    return `${Math.floor(secs / 60)}m ago`;
  })();

  return (
    <>
      <CfgRow
        name="health"
        comment="Observed runtime status — a saved config never means the server actually connected. Status is session-only and refreshed by test or an AI run."
      >
        {health.state === "connected" ? (
          <span className="cfg-num">● connected{readOnly ? " · read-only" : ""}</span>
        ) : health.state === "connecting" ? (
          <span className="cfg-hint">… connecting</span>
        ) : health.state === "error" ? (
          <span className="cfg-hint" style={{ color: "#f87171" }}>✕ {health.message ?? "error"}</span>
        ) : (
          <span className="cfg-hint">○ not connected this session</span>
        )}
        {health.state === "connected" && health.toolCount != null ? (
          <CfgStr>{health.toolCount} tool{health.toolCount === 1 ? "" : "s"}</CfgStr>
        ) : null}
        {checkedAgo ? <CfgStr>checked {checkedAgo}</CfgStr> : null}
        {(health.toolNames?.length ?? 0) > 0 ? (
          <CfgAct onClick={() => setShowTools((v) => !v)}>{showTools ? "hide tools" : "view tools"}</CfgAct>
        ) : null}
      </CfgRow>
      {showTools && health.toolNames ? (
        <CfgRow
          name="tools"
          comment={
            readOnly
              ? "Read-only mode: the server exposes these reads; create/merge/delete operations are disabled by the integration."
              : "Tools Husk can call after this server is enabled. Non-read-only requests are shown for approval before they run."
          }
        >
          <CfgBlock
            value={health.toolNames.map((n) => `${readOnly ? "✓" : "•"} ${n}`).join("\n")}
            onChange={() => {}}
            rows={Math.min(8, health.toolNames.length)}
            readOnly
          />
        </CfgRow>
      ) : null}
    </>
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
        <strong>Husk owns connected-tool access.</strong>
        Enable an integration here, then enable Connected MCP tools in Settings → Agents. API models call the Husk Action Broker directly; signed-in CLI models submit a validated proposal to the same broker. Read-only calls can run in place; other calls require approval.
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
      {server ? <McpHealthRow serverId={server.id} readOnly={server.readOnly} /> : null}
      <CfgRow>
        <CfgAct onClick={() => void save()}>{saving ? "connecting…" : server ? "save & test" : "connect & test"}</CfgAct>
        {server ? <CfgAct onClick={onTest}>{testing ? "testing…" : "test"}</CfgAct> : null}
        {server ? <CfgAct onClick={() => void disconnect()} danger>disconnect</CfgAct> : null}
      </CfgRow>
    </section>
  );
}

/** The editor keeps primary fields visible and folds technical launch details
 * away until needed. Its validation and saved payload remain unchanged. */
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
      <CfgSection name={editing ? "edit_connection" : "new_connection"} />
      <form onSubmit={handleSubmit}>
        <CfgRow name="name" comment="A short label for this server in the integrations list.">
          <Input className="mcp-inline-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Filesystem" required />
        </CfgRow>
        <CfgRow name="command" comment="The executable that starts the server, for example npx or uvx.">
          <Input className="mcp-inline-input" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. npx" required />
        </CfgRow>
        <CfgRow name="enabled" comment="Load this server's tools into the AI as soon as it is saved.">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </CfgRow>
        <details className="mcp-advanced">
          <summary>
            <span>Advanced configuration</span>
            <small>Arguments, environment, working directory</small>
          </summary>
          <div className="mcp-advanced-content">
            <CfgRow name="arguments" comment="Arguments passed to the command, separated by spaces.">
              <Input className="mcp-inline-input" value={args} onChange={(e) => setArgs(e.target.value)} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path" />
            </CfgRow>
            <CfgRow name="environment" comment="Optional KEY=value entries, one per line. Token, secret, password, and API-key values are moved to your OS keychain automatically.">
              <textarea className="mcp-inline-textarea" value={env} onChange={(e) => setEnv(e.target.value)} placeholder={`LOG_LEVEL=debug\nAPI_TOKEN=stored securely`} rows={4} />
            </CfgRow>
            <CfgRow name="workingDirectory" comment="Optional directory where Husk starts the server.">
              <Input className="mcp-inline-input" value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/dir" />
            </CfgRow>
          </div>
        </details>
        <CfgRow>
          <CfgAct onClick={onCancel}>cancel</CfgAct>
          <button type="submit" className="cfg-act">[ {editing ? "save changes" : "add server"} ]</button>
        </CfgRow>
      </form>
    </section>
  );
}
