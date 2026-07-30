import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { connectMcpServer, disconnectMcpServer } from "@/mcp/client";
import {
  addMcpServer,
  loadMcpServers,
  removeMcpServer,
  updateMcpServer,
  type McpServerConfig,
} from "@/mcp/store";
import { McpMarketplaceDialog } from "@/mcp/McpMarketplaceDialog";
import { getMarketplaceItemById } from "@/mcp/marketplace";
import { Switch } from "@/components/ui/switch";
import {
  ConfigEditor,
  CfgAct,
  CfgBlank,
  CfgComment,
  CfgRow,
  CfgSection,
  CfgStr,
} from "../config/controls";

export function McpFile() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);

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
    setDialogOpen(false);
    setEditing(null);
  };

  const handleMarketplaceInstall = async (
    item: NonNullable<ReturnType<typeof getMarketplaceItemById>>,
    envOverrides: Record<string, string>,
  ) => {
    const mcpItem = getMarketplaceItemById(item.id);
    if (!mcpItem) return;
    const added = await addMcpServer({
      name: mcpItem.name,
      command: mcpItem.command,
      args: mcpItem.args,
      env: { ...mcpItem.env, ...envOverrides },
      enabled: true,
    });
    setServers((prev) => [...prev, added]);
  };

  const handleMarketplaceUninstall = async (id: string) => {
    const server = servers.find((s) => s.id === id);
    if (server) {
      await disconnectMcpServer(id);
      await removeMcpServer(id);
      setServers((prev) => prev.filter((s) => s.id !== id));
    }
  };

  return (
    <ConfigEditor>
      <CfgComment>──────────────────────────────────────────</CfgComment>
      <CfgComment>mcp.toml — Model Context Protocol servers</CfgComment>
      <CfgComment>──────────────────────────────────────────</CfgComment>
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
        <>
          <CfgComment>no servers configured — add one to give the AI external tools</CfgComment>
          <CfgRow>
            <CfgAct onClick={() => setMarketplaceOpen(true)}>browse marketplace</CfgAct>
            <CfgAct
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              + add custom
            </CfgAct>
          </CfgRow>
        </>
      ) : (
        <>
          {servers.map((server) => (
            <div key={server.id}>
              <CfgSection name="servers" array />
              <CfgRow name="name">
                <CfgStr>{server.name}</CfgStr>
                {testResult?.id === server.id ? (
                  <span className={testResult.ok ? "cfg-num" : "cfg-hint"} style={testResult.ok ? undefined : { color: "#f87171" }}>
                    {testResult.ok ? testResult.msg : `failed: ${testResult.msg}`}
                  </span>
                ) : null}
              </CfgRow>
              <CfgRow name="command">
                <CfgStr>{server.command}</CfgStr>
              </CfgRow>
              <CfgRow name="args">
                <span className="cfg-punct">[</span>
                <span className="cfg-str">{server.args.map((a) => `"${a}"`).join(", ")}</span>
                <span className="cfg-punct">]</span>
              </CfgRow>
              <CfgRow name="enabled">
                <Switch checked={server.enabled} onCheckedChange={(v) => void handleToggle(server.id, v)} />
              </CfgRow>
              <CfgRow>
                <CfgAct onClick={() => void handleTest(server)}>
                  {testingId === server.id ? "testing…" : "test"}
                </CfgAct>
                <CfgAct
                  onClick={() => {
                    setEditing(server);
                    setDialogOpen(true);
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
          <CfgRow>
            <CfgAct onClick={() => setMarketplaceOpen(true)}>marketplace</CfgAct>
            <CfgAct
              onClick={() => {
                setEditing(null);
                setDialogOpen(true);
              }}
            >
              + add custom
            </CfgAct>
          </CfgRow>
        </>
      )}

      <McpServerDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSave={handleSave}
      />
      <McpMarketplaceDialog
        open={marketplaceOpen}
        onOpenChange={setMarketplaceOpen}
        installedIds={servers.map((s) => s.id)}
        onInstall={handleMarketplaceInstall}
        onUninstall={handleMarketplaceUninstall}
      />
    </ConfigEditor>
  );
}

/* Add/edit dialog — same fields and payload as the previous implementation. */
function McpServerDialog({
  open,
  onOpenChange,
  editing,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing: McpServerConfig | null;
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
  }, [editing, open]);

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">{editing ? "Edit MCP server" : "Add MCP server"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Filesystem" className="h-8 text-[12px]" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Command</label>
            <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. npx" className="h-8 text-[12px]" required />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Arguments</label>
            <Input value={args} onChange={(e) => setArgs(e.target.value)} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path" className="h-8 text-[12px]" />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Environment variables</label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={`KEY=value\nANOTHER=secret`}
              className="h-20 rounded-md border border-input bg-transparent px-3 py-2 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">Working directory (optional)</label>
            <Input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/path/to/dir" className="h-8 text-[12px]" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Enabled
          </label>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="rounded px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
            <button type="submit" className="rounded bg-primary/10 px-3 py-1 text-[11px] font-medium text-primary hover:bg-primary/15">
              {editing ? "Update" : "Add"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
