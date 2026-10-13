import { useEffect, useId, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { runInActiveTerminal, readActiveTerminalCommand, getActiveRemoteTerminal } from "../ai/terminalContext";
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
  ClockIcon,
  Tag01Icon,
  CloudUploadIcon,
  ArrowDown01Icon,
  Copy01Icon,
  Delete02Icon,
  RepeatIcon,
  AlertCircleIcon,
} from "@hugeicons/core-free-icons";
import { encodeSftpTarget, parseSshFileTarget, sftpTargetFromConnection, type SftpTarget } from "./sftpTarget";
import { useConnectedHosts } from "../remote/connectionStore";
import {
  useConnections,
  getRecentConnections,
  recordConnection,
  addConnection,
  deleteConnection,
  removeRecentConnection,
  connectionInheritsSshConfig,
  type SshConnection,
} from "../remote/connectionManager";
import { ConnectionDialog } from "./ConnectionDialog";
import { PortForwardDialog } from "./PortForwardDialog";
import { sshCommandForConnection, sshConnectionAddress } from "./sshCommand";
import { useSftpTargetPreview } from "./useSftpTargetPreview";
import "./RemotesView.css";
import {
  HuskContextMenu,
  HuskContextMenuContent,
  HuskContextMenuItem,
  HuskContextMenuSeparator,
  HuskContextMenuTrigger,
} from "../components/HuskContextMenu";

function ConnectionSummary({ connection, descriptionId }: { connection: SshConnection; descriptionId: string }) {
  const inherited = connectionInheritsSshConfig(connection);
  const { preview, error } = useSftpTargetPreview(inherited ? { host: connection.host } : null);
  const address = inherited
    ? preview ? `${preview.username}@${preview.hostname}:${preview.port}` : connection.host
    : `${connection.user ? `${connection.user}@` : ""}${connection.host}:${connection.port}`;
  const details = [address, inherited ? `SSH config · Alias: ${connection.host}` : "",
    !inherited && connection.jumpHost ? `Via ${connection.jumpHost}` : "", error ? `Preview unavailable: ${error}` : ""].filter(Boolean).join("\n");
  return <span className="remote-connection-summary">
    <span className="remote-connection-heading">
      <span className="remote-connection-name" title={connection.name}>{connection.name}</span>
      {inherited && <span className="remote-connection-source" title={error ? `Preview unavailable: ${error}` : "Settings inherited from SSH config"}>
        SSH config
        {error && <HugeiconsIcon icon={AlertCircleIcon} size={11} role="img" aria-label="Preview unavailable" />}
      </span>}
    </span>
    <span className="remote-connection-address" title={details}>{address}</span>
    <span id={descriptionId} className="sr-only">{details}</span>
  </span>;
}

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
  const descriptionPrefix = useId();
  const [sshConfigHosts, setSshConfigHosts] = useState<string[] | "loading">("loading");
  const connected = useConnectedHosts();
  const connectedSet = new Set(connected);
  const savedConnections = useConnections();
  const [showConnDialog, setShowConnDialog] = useState(false);
  const [editingConn, setEditingConn] = useState<string | undefined>();
  const [showPfDialog, setShowPfDialog] = useState<string | undefined>();
  const [importingHost, setImportingHost] = useState<string | undefined>();
  const [showSshConfig, setShowSshConfig] = useState(false);
  const [previewVersion, setPreviewVersion] = useState(0);

  const load = () => {
    setPreviewVersion((version) => version + 1);
    void readSshHosts().then(setSshConfigHosts);
  };

  useEffect(() => {
    void readSshHosts().then(setSshConfigHosts);
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
      inheritSshConfig: true,
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
    if (runInActiveTerminal(sshCommandForConnection(conn))) {
      recordConnection(conn.id);
      toast({ title: `ssh ${conn.name}`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const openSftp = (host: string | SftpTarget) => {
    if (!onSftp) return;
    // SFTP must not silently retarget the separate Files/SSH backend.
    onSftp(typeof host === "string" ? host : encodeSftpTarget(host));
  };

  const openSavedSftp = (connection: SshConnection) => {
    try { openSftp(sftpTargetFromConnection(connection)); }
    catch (error) { toast({ title: "Check this SSH connection", message: String(error), variant: "error" }); }
  };

  const browseActiveSsh = () => {
    const target = getActiveRemoteTerminal().isRemote ? parseSshFileTarget(readActiveTerminalCommand()) : null;
    if (!target) {
      toast({ title: "SSH connection could not be identified safely", message: "Use a saved connection. Custom SSH options, wrappers, nested sessions and non-SSH shells are not inferred.", variant: "info" });
      return;
    }
    openSftp(target);
  };

  const editConnection = (id: string) => {
    setEditingConn(id);
    setShowConnDialog(true);
  };

  const duplicateSavedConnection = (connection: SshConnection) => {
    const base = `${connection.name} copy`;
    const names = new Set(savedConnections.map((item) => item.name.toLocaleLowerCase()));
    let name = base;
    let copyNumber = 2;
    while (names.has(name.toLocaleLowerCase())) name = `${base} ${copyNumber++}`;
    addConnection({
      name,
      host: connection.host,
      port: connection.port,
      user: connection.user,
      authType: connection.authType,
      inheritSshConfig: connection.inheritSshConfig,
      password: connection.password,
      privateKeyPath: connection.privateKeyPath,
      passphrase: connection.passphrase,
      jumpHost: connection.jumpHost,
      tags: [...connection.tags],
      color: connection.color,
    });
    toast({ title: `Duplicated ${connection.name}`, message: `Saved as ${name}.`, variant: "success" });
  };

  const copyConnectionText = async (text: string, label: string) => {
    try {
      await writeText(text);
      toast({ title: `${label} copied`, variant: "success" });
    } catch (error) {
      toast({ title: `Could not copy ${label.toLocaleLowerCase()}`, message: String(error), variant: "error" });
    }
  };

  const removeSavedConnection = (connection: SshConnection) => {
    if (!confirm(`Delete saved connection “${connection.name}”?`)) return;
    deleteConnection(connection.id);
    toast({ title: `Deleted ${connection.name}`, variant: "success" });
  };

  const forgetRecentConnection = (connection: SshConnection) => {
    if (!removeRecentConnection(connection.id)) return;
    toast({ title: `Removed ${connection.name} from Recent`, variant: "success" });
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
        {onSftp && <button type="button" onClick={browseActiveSsh} className="mb-3 w-full rounded border border-border px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground">Browse active SSH files…</button>}
        <HuskContextMenu>
          <HuskContextMenuTrigger asChild>
            <div className="min-h-full min-w-0">
        {/* Quick Connect — Recent */}
        {recentConns.length > 0 && (
          <section className="remote-connection-section" aria-label="Recent connections">
            <div className="remote-section-heading">
              <HugeiconsIcon icon={ClockIcon} size={12} />
              Recent
            </div>
            <div className="remote-connection-list">
              {recentConns.map((conn) => (
                <HuskContextMenu key={conn.id}>
                  <HuskContextMenuTrigger asChild>
                    <button
                      type="button"
                      onContextMenu={(event) => event.stopPropagation()}
                      onClick={() => connectSaved(conn)}
                      aria-label={`Connect to ${conn.name}`}
                      aria-describedby={`${descriptionPrefix}-recent-${conn.id}`}
                      className="remote-connection-row remote-connection-trigger"
                      data-section="recent"
                      style={conn.color ? { borderInlineStartColor: conn.color } : undefined}
                    >
                      <ConnectionSummary key={previewVersion} connection={conn} descriptionId={`${descriptionPrefix}-recent-${conn.id}`} />
                    </button>
                  </HuskContextMenuTrigger>
                  <HuskContextMenuContent title={conn.name}>
                    <HuskContextMenuItem icon={PlayIcon} onSelect={() => connectSaved(conn)}>Connect in active terminal</HuskContextMenuItem>
                    {onSftp ? <HuskContextMenuItem icon={FolderUploadIcon} onSelect={() => openSavedSftp(conn)}>Open SFTP</HuskContextMenuItem> : null}
                    <HuskContextMenuItem icon={Settings02Icon} onSelect={() => editConnection(conn.id)}>Edit connection…</HuskContextMenuItem>
                    <HuskContextMenuSeparator />
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(sshCommandForConnection(conn), "SSH command")}>Copy SSH command</HuskContextMenuItem>
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(sshConnectionAddress(conn), "Address")}>Copy address</HuskContextMenuItem>
                    <HuskContextMenuSeparator />
                    <HuskContextMenuItem icon={ClockIcon} onSelect={() => forgetRecentConnection(conn)}>Remove from Recent</HuskContextMenuItem>
                  </HuskContextMenuContent>
                </HuskContextMenu>
              ))}
            </div>
          </section>
        )}

        {/* Section: Saved Connections */}
        <div className="remote-section-header">
          <div className="remote-section-heading">
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
          <div className="remote-connection-list mb-3" role="group" aria-label="Saved connections">
            {savedConnections.map((conn) => (
              <HuskContextMenu key={conn.id}>
                <HuskContextMenuTrigger asChild>
                  <div
                    className="remote-connection-row"
                    data-section="saved"
                    style={conn.color ? { borderInlineStartColor: conn.color } : undefined}
                    onContextMenu={(event) => event.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => connectSaved(conn)}
                      aria-label={`Connect to ${conn.name}`}
                      aria-describedby={`${descriptionPrefix}-saved-${conn.id}`}
                      className="remote-connection-trigger"
                    >
                      <ConnectionSummary key={previewVersion} connection={conn} descriptionId={`${descriptionPrefix}-saved-${conn.id}`} />
                    </button>
                    <div className="remote-connection-actions">
                      {onSftp && (
                        <button
                          type="button"
                          onClick={() => openSavedSftp(conn)}
                          className="remote-connection-action"
                          aria-label={`Open SFTP for ${conn.name}`}
                          title="Open SFTP"
                        >
                          <HugeiconsIcon icon={FolderUploadIcon} size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => editConnection(conn.id)}
                        className="remote-connection-action"
                        aria-label={`Edit ${conn.name}`}
                        title="Edit"
                      >
                        <HugeiconsIcon icon={Settings02Icon} size={12} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowPfDialog(conn.id)}
                        className="remote-connection-action"
                        aria-label={`Port forwards for ${conn.name}`}
                        title="Port Forwards"
                      >
                        <HugeiconsIcon icon={Tag01Icon} size={12} />
                      </button>
                    </div>
                  </div>
                </HuskContextMenuTrigger>
                <HuskContextMenuContent title={conn.name}>
                  <HuskContextMenuItem icon={PlayIcon} onSelect={() => connectSaved(conn)}>Connect in active terminal</HuskContextMenuItem>
                  {onSftp ? <HuskContextMenuItem icon={FolderUploadIcon} onSelect={() => openSavedSftp(conn)}>Open SFTP</HuskContextMenuItem> : null}
                  <HuskContextMenuItem icon={Settings02Icon} onSelect={() => editConnection(conn.id)}>Edit connection…</HuskContextMenuItem>
                  <HuskContextMenuItem icon={RepeatIcon} onSelect={() => duplicateSavedConnection(conn)}>Duplicate</HuskContextMenuItem>
                  <HuskContextMenuItem icon={Tag01Icon} onSelect={() => setShowPfDialog(conn.id)}>Port forwards…</HuskContextMenuItem>
                  <HuskContextMenuSeparator />
                  <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(sshCommandForConnection(conn), "SSH command")}>Copy SSH command</HuskContextMenuItem>
                  <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(sshConnectionAddress(conn), "Address")}>Copy address</HuskContextMenuItem>
                  <HuskContextMenuSeparator />
                  <HuskContextMenuItem icon={Delete02Icon} danger onSelect={() => removeSavedConnection(conn)}>Delete saved connection…</HuskContextMenuItem>
                </HuskContextMenuContent>
              </HuskContextMenu>
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
                  <HuskContextMenu key={h}>
                    <HuskContextMenuTrigger asChild>
                      <div
                        className="group flex items-center gap-1 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/10"
                        onContextMenu={(event) => event.stopPropagation()}
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
                        {onSftp ? (
                          <button
                            type="button"
                            title="SFTP"
                            onClick={() => openSftp(h)}
                            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                          >
                            <HugeiconsIcon icon={FolderUploadIcon} size={11} strokeWidth={2} />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          title="Connect terminal"
                          onClick={() => connect(h)}
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                        >
                          <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
                        </button>
                      </div>
                    </HuskContextMenuTrigger>
                    <HuskContextMenuContent title={h}>
                      <HuskContextMenuItem icon={PlayIcon} onSelect={() => connect(h)}>Connect in active terminal</HuskContextMenuItem>
                      {onSftp ? <HuskContextMenuItem icon={FolderUploadIcon} onSelect={() => openSftp(h)}>Open SFTP</HuskContextMenuItem> : null}
                      <HuskContextMenuItem icon={CloudUploadIcon} onSelect={() => importHost(h)}>Import to Saved…</HuskContextMenuItem>
                      <HuskContextMenuSeparator />
                      <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(`ssh ${shq(h)}`, "SSH command")}>Copy SSH command</HuskContextMenuItem>
                      <HuskContextMenuItem icon={Copy01Icon} onSelect={() => void copyConnectionText(h, "Host")}>Copy host</HuskContextMenuItem>
                    </HuskContextMenuContent>
                  </HuskContextMenu>
                ))}
              </div>
            )}
          </>
        )}
            </div>
          </HuskContextMenuTrigger>
          <HuskContextMenuContent title="Remotes">
            <HuskContextMenuItem
              icon={Add01Icon}
              onSelect={() => {
                setEditingConn(undefined);
                setShowConnDialog(true);
              }}
            >
              New connection…
            </HuskContextMenuItem>
            <HuskContextMenuItem icon={Refresh01Icon} onSelect={load}>Refresh SSH config</HuskContextMenuItem>
          </HuskContextMenuContent>
        </HuskContextMenu>
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
              The saved connection will follow this alias's SSH config, including its port, username and authentication. You can switch to manual settings later.
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
