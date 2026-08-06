import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { shq } from "../lib/shellQuote";
import { Modal } from "../components/Modal";
import { Button } from "../components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DatabaseIcon,
  Refresh01Icon,
  PlayIcon,
  FolderUploadIcon,
  Add01Icon,
  Settings02Icon,
  ArrowRight01Icon,
  ClockIcon,
  Tag01Icon,
  CloudUploadIcon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { setActiveSshHost } from "../remote/store";
import { useConnectedHosts } from "../remote/connectionStore";
import {
  useConnections,
  getRecentConnections,
  recordConnection,
  addConnection,
  type SshConnection,
} from "../remote/connectionManager";
import { ConnectionDialog } from "./ConnectionDialog";
import { PortForwardDialog } from "./PortForwardDialog";

async function readSshHosts(): Promise<string[]> {
  try {
    const home = await invoke<string>("home_dir");
    const content = await invoke<string>("read_file", {
      path: `${home}/.ssh/config`,
    }).catch(() => "");
    const hosts: string[] = [];
    for (const line of content.split("\n")) {
      const m = line.match(/^\s*Host\s+(.+)$/i);
      if (m) {
        for (const h of m[1].split(/\s+/)) {
          if (h && !h.includes("*")) hosts.push(h);
        }
      }
    }
    return [...new Set(hosts)];
  } catch {
    return [];
  }
}

export function RemotesView({
  onClose,
  inline,
  onSftp,
}: {
  onClose?: () => void;
  inline?: boolean;
  onSftp?: (host: string) => void;
}) {
  const [sshConfigHosts, setSshConfigHosts] = useState<string[] | "loading">("loading");
  const connected = useConnectedHosts();
  const connectedSet = new Set(connected);
  const savedConnections = useConnections();
  const [showConnDialog, setShowConnDialog] = useState(false);
  const [editingConn, setEditingConn] = useState<string | undefined>();
  const [showPfDialog, setShowPfDialog] = useState<string | undefined>();
  const [importingHost, setImportingHost] = useState<string | undefined>();
  const [showSshConfig, setShowSshConfig] = useState(false);

  const load = () => void readSshHosts().then(setSshConfigHosts);

  useEffect(() => {
    load();
  }, []);

  const importHost = (host: string) => {
    if (savedConnections.some((c) => c.host === host)) {
      toast({ title: `${host} already saved`, variant: "info" });
      return;
    }
    setImportingHost(host);
  };

  const confirmImport = (host: string) => {
    addConnection({
      name: host,
      host,
      port: 22,
      user: "",
      authType: "agent",
      tags: ["ssh-config"],
    });
    toast({ title: `Imported ${host}`, variant: "success" });
    setImportingHost(undefined);
    // Refresh SSH config list so imported host disappears
    load();
  };

  const connect = (h: string) => {
    if (runInActiveTerminal(`ssh ${shq(h)}`)) {
      toast({ title: `ssh ${h}`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const connectSaved = (conn: SshConnection) => {
    recordConnection(conn.id);
    let cmd = `ssh`;
    if (conn.port !== 22) cmd += ` -p ${conn.port}`;
    if (conn.authType === "key" && conn.privateKeyPath) {
      cmd += ` -i ${shq(conn.privateKeyPath)}`;
    }
    if (conn.jumpHost) {
      cmd += ` -J ${shq(conn.jumpHost)}`;
    }
    // Build target: user@host if user exists, otherwise just host
    const target = conn.user ? `${conn.user}@${conn.host}` : conn.host;
    cmd += ` ${shq(target)}`;

    if (runInActiveTerminal(cmd)) {
      toast({ title: `ssh ${conn.name}`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const headerActions = (
    <div className="flex gap-1">
      <button
        type="button"
        aria-label="New connection"
        title="New connection"
        onClick={() => {
          setEditingConn(undefined);
          setShowConnDialog(true);
        }}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.5} />
      </button>
      <button
        type="button"
        aria-label="Refresh"
        title="Refresh"
        onClick={load}
        className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.5} />
      </button>
    </div>
  );

  const recentConns = getRecentConnections(3);

  // SSH Config hosts that are NOT already saved
  const savedHosts = new Set(savedConnections.map((c) => c.host));
  const sshConfigOnly = sshConfigHosts === "loading" ? [] : sshConfigHosts.filter((h) => !savedHosts.has(h));

  return (
    <>
      <Modal title="Remotes" icon={DatabaseIcon} context={`${savedConnections.length} saved`} onClose={onClose} inline={inline} headerActions={headerActions}>
        {/* Quick Connect — Recent */}
        {recentConns.length > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              <HugeiconsIcon icon={ClockIcon} size={12} />
              Recent
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recentConns.map((conn) => (
                <button
                  key={conn.id}
                  onClick={() => connectSaved(conn)}
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs bg-accent hover:bg-accent/80 transition-colors"
                  style={conn.color ? { borderLeft: `3px solid ${conn.color}` } : undefined}
                >
                  <span className="truncate max-w-[120px]">{conn.name}</span>
                  <span className="text-muted-foreground">{conn.user}@{conn.host}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Section: Saved Connections */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            <HugeiconsIcon icon={DatabaseIcon} size={12} />
            Saved ({savedConnections.length})
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-xs"
            onClick={() => {
              setEditingConn(undefined);
              setShowConnDialog(true);
            }}
          >
            <HugeiconsIcon icon={Add01Icon} size={12} className="mr-1" />
            Add
          </Button>
        </div>

        {savedConnections.length === 0 && sshConfigOnly.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon icon={DatabaseIcon} size={20} className="text-primary" />
            </div>
            <div className="text-sm text-muted-foreground">
              No connections yet
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingConn(undefined);
                setShowConnDialog(true);
              }}
            >
              <HugeiconsIcon icon={Add01Icon} size={14} className="mr-1" />
              Add Connection
            </Button>
          </div>
        ) : (
          <div className="space-y-1 mb-3">
            {savedConnections.map((conn) => (
              <div
                key={conn.id}
                className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-accent/50 transition-colors"
                style={conn.color ? { borderLeft: `3px solid ${conn.color}` } : undefined}
              >
                <button
                  onClick={() => connectSaved(conn)}
                  className="flex-1 flex items-center gap-2 min-w-0 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{conn.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {conn.user}@{conn.host}:{conn.port}
                      {conn.jumpHost && ` via ${conn.jumpHost}`}
                    </div>
                  </div>
                  <HugeiconsIcon
                    icon={ArrowRight01Icon}
                    size={14}
                    className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity"
                  />
                </button>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onSftp && (
                    <button
                      onClick={() => {
                        setActiveSshHost(conn.host);
                        onSftp(conn.host);
                      }}
                      className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Open SFTP"
                    >
                      <HugeiconsIcon icon={FolderUploadIcon} size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setEditingConn(conn.id);
                      setShowConnDialog(true);
                    }}
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Edit"
                  >
                    <HugeiconsIcon icon={Settings02Icon} size={12} />
                  </button>
                  <button
                    onClick={() => setShowPfDialog(conn.id)}
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    title="Port Forwards"
                  >
                    <HugeiconsIcon icon={Tag01Icon} size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Section: SSH Config (Quick Connect) — collapsible */}
        {sshConfigOnly.length > 0 && (
          <>
            <button
              onClick={() => setShowSshConfig((v) => !v)}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mb-2 mt-4 hover:text-foreground transition-colors"
            >
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={12}
                className={`transition-transform ${showSshConfig ? "rotate-180" : ""}`}
              />
              From ~/.ssh/config ({sshConfigOnly.length})
              <span className="text-[9px] normal-case opacity-60">— click to import</span>
            </button>

            {showSshConfig && (
              <div className="flex flex-col gap-1">
                {sshConfigOnly.map((h) => (
                  <div
                    key={h}
                    className="group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/10"
                  >
                    <button
                      type="button"
                      onClick={() => connect(h)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <HugeiconsIcon
                        icon={DatabaseIcon}
                        size={14}
                        strokeWidth={1.75}
                        className="shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                        {h}
                      </span>
                      {connectedSet.has(h) && (
                        <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-green-500" title="Connected" />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Import to Saved"
                      onClick={() => importHost(h)}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    >
                      <HugeiconsIcon icon={CloudUploadIcon} size={11} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      title="SFTP"
                      onClick={() => {
                        setActiveSshHost(h);
                        onSftp?.(h);
                      }}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    >
                      <HugeiconsIcon icon={FolderUploadIcon} size={11} strokeWidth={2} />
                    </button>
                    <button
                      type="button"
                      title="Connect terminal"
                      onClick={() => connect(h)}
                      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                    >
                      <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Dialogs */}
      {showConnDialog && (
        <ConnectionDialog
          connectionId={editingConn}
          onClose={() => setShowConnDialog(false)}
          onSave={() => setShowConnDialog(false)}
        />
      )}
      {showPfDialog && (
        <PortForwardDialog
          connectionId={showPfDialog}
          onClose={() => setShowPfDialog(undefined)}
        />
      )}
      {importingHost && (
        <Modal
          title="Import Connection"
          onClose={() => setImportingHost(undefined)}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Import <strong>{importingHost}</strong> from SSH config to Saved connections?
            </p>
            <p className="text-xs text-muted-foreground">
              You can then edit it to add port, username, authentication, and other settings.
            </p>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setImportingHost(undefined)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => confirmImport(importingHost)}
              >
                <HugeiconsIcon icon={CloudUploadIcon} size={14} className="mr-1" />
                Import
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
