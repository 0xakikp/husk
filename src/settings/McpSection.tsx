import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  connectMcpServer,
  disconnectMcpServer,
} from "@/mcp/client";
import {
  addMcpServer,
  loadMcpServers,
  removeMcpServer,
  updateMcpServer,
  type McpServerConfig,
} from "@/mcp/store";
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  CloudServerIcon,
  Delete02Icon,
  Edit02Icon,
  Link01Icon,
  ShoppingBasket01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";
import { McpMarketplaceDialog } from "@/mcp/McpMarketplaceDialog";
import { getMarketplaceItemById } from "@/mcp/marketplace";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";

export function McpSection() {
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<McpServerConfig | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    id: string;
    ok: boolean;
    msg: string;
  } | null>(null);
  const [marketplaceOpen, setMarketplaceOpen] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

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
        console.error("[mcp] failed to load servers:", e);
        setError(e instanceof Error ? e.message : String(e));
        setServers([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keyboard shortcut: Cmd/Ctrl+Shift+N to open add dialog
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialogOpen) return;
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.shiftKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        setEditing(null);
        setDialogOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogOpen]);

  const handleToggle = async (id: string, enabled: boolean) => {
    await updateMcpServer(id, { enabled });
    setServers((prev) =>
      prev.map((s) => (s.id === id ? { ...s, enabled } : s)),
    );
    if (!enabled) {
      await disconnectMcpServer(id);
    }
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
        msg: `Connected · ${tools.length} tool${tools.length === 1 ? "" : "s"} discovered`,
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

  const handleSave = async (
    config: Omit<McpServerConfig, "id"> & { id?: string },
  ) => {
    if (config.id) {
      await updateMcpServer(config.id, config);
      setServers((prev) =>
        prev.map((s) =>
          s.id === config.id
            ? { ...(s as McpServerConfig), ...config, id: config.id }
            : s,
        ),
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
    <section ref={sectionRef}>
      <SectionHeader
        title="MCP Servers"
        description="Connect Model Context Protocol servers to extend AI capabilities with external tools."
      />

      <div className="mt-5 flex flex-col gap-2">
        {loading ? (
          <div className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
            <span className="inline-block size-3.5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            Loading servers…
          </div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
            <p className="text-[13px] font-medium text-destructive">
              Failed to load MCP servers
            </p>
            <p className="mt-1 text-[11px] text-destructive/70">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 h-7 text-[11px]"
              onClick={() => {
                setError(null);
                setLoading(true);
                Promise.resolve(loadMcpServers())
                  .then((s) => {
                    setServers(s);
                    setLoading(false);
                  })
                  .catch((e) => {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                  });
              }}
            >
              Retry
            </Button>
          </div>
        ) : servers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 px-6 py-10 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon
                icon={CloudServerIcon}
                size={24}
                className="text-primary"
              />
            </div>
            <p className="mt-4 text-[13px] font-medium text-foreground">
              No MCP servers configured
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Add a server to give the AI access to external tools.
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => setMarketplaceOpen(true)}
              >
                <HugeiconsIcon icon={ShoppingBasket01Icon} size={14} />
                Browse Marketplace
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-[12px]"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <HugeiconsIcon icon={Add01Icon} size={14} />
                Add custom
              </Button>
            </div>
          </div>
        ) : (
          <>
            {servers.map((server) => (
              <div
                key={server.id}
                className="rounded-lg border border-border/40 bg-card/40"
              >
                <SettingRow
                  title={
                    <span className="flex items-center gap-2">
                      {server.name}
                      {testResult?.id === server.id && (
                        <span
                          className={cn(
                            "text-[10px]",
                            testResult.ok
                              ? "text-emerald-500"
                              : "text-red-500",
                          )}
                        >
                          {testResult.ok
                            ? testResult.msg
                            : `Failed: ${testResult.msg}`}
                        </span>
                      )}
                    </span>
                  }
                  description={`${server.command} ${server.args.join(" ")}`}
                >
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      disabled={testingId === server.id}
                      onClick={() => handleTest(server)}
                      title="Test connection"
                    >
                      <HugeiconsIcon
                        icon={
                          testingId === server.id
                            ? Link01Icon
                            : testResult?.id === server.id && testResult.ok
                              ? CheckmarkCircle02Icon
                              : Link01Icon
                        }
                        size={14}
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setEditing(server);
                        setDialogOpen(true);
                      }}
                      title="Edit"
                    >
                      <HugeiconsIcon icon={Edit02Icon} size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(server.id)}
                      title="Delete"
                    >
                      <HugeiconsIcon icon={Delete02Icon} size={14} />
                    </Button>
                    <Switch
                      checked={server.enabled}
                      onCheckedChange={(v) => handleToggle(server.id, v)}
                      className="ml-1"
                    />
                  </div>
                </SettingRow>
              </div>
            ))}
            <div className="flex gap-2">
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-[11px]"
                onClick={() => setMarketplaceOpen(true)}
              >
                <HugeiconsIcon icon={ShoppingBasket01Icon} size={14} />
                Marketplace
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 w-fit gap-1.5 text-[11px]"
                onClick={() => {
                  setEditing(null);
                  setDialogOpen(true);
                }}
              >
                <HugeiconsIcon icon={Add01Icon} size={14} />
                Add custom
              </Button>
            </div>
          </>
        )}
      </div>

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
    </section>
  );
}

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
      setEnv(
        Object.entries(editing.env)
          .map(([k, v]) => `${k}=${v}`)
          .join("\n"),
      );
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
      if (idx > 0) {
        envMap[trimmed.slice(0, idx)] = trimmed.slice(idx + 1);
      }
    }

    onSave({
      id: editing?.id,
      name: name.trim(),
      command: command.trim(),
      args: args
        .trim()
        .split(/\s+/)
        .filter((s) => s.length > 0),
      env: envMap,
      cwd: cwd.trim() || undefined,
      enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {editing ? "Edit MCP server" : "Add MCP server"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Name
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Filesystem"
              className="h-8 text-[12px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Command
            </label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="e.g. npx"
              className="h-8 text-[12px]"
              required
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Arguments
            </label>
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="e.g. -y @modelcontextprotocol/server-filesystem /path"
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Environment variables
            </label>
            <textarea
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={`KEY=value\nANOTHER=secret`}
              className="h-20 rounded-md border border-input bg-transparent px-3 py-2 text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-medium text-muted-foreground">
              Working directory
            </label>
            <Input
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="Optional — defaults to workspace root"
              className="h-8 text-[12px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              id="mcp-enabled"
            />
            <label htmlFor="mcp-enabled" className="text-[12px]">
              Enabled
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-7 text-[11px]">
              {editing ? "Save" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
