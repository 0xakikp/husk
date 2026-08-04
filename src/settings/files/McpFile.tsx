import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { connectMcpServer, disconnectMcpServer } from "@/mcp/client";
import {
  addMcpServer,
  loadMcpServers,
  removeMcpServer,
  updateMcpServer,
  type McpServerConfig,
} from "@/mcp/store";
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
} from "../config/controls";
import { BANNERS } from "../config/banners";

export function McpFile() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);

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
      const tools = await connectMcpServer(server.id, server.name, {
        command: server.command,
        args: server.args,
        env: server.env,
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

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.mcp} />
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
      ) : servers.length === 0 ? (
        <CfgComment>no servers configured — add one to give the AI external tools</CfgComment>
      ) : (
        <>
          {servers.map((server) => (
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
        <CfgRow name="environment" comment="Optional KEY=value entries, one per line. Lines beginning with # are ignored.">
          <textarea className="mcp-inline-textarea" value={env} onChange={(e) => setEnv(e.target.value)} placeholder={`KEY=value\nANOTHER=secret`} rows={4} />
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
