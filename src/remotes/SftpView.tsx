import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { open, save } from "@tauri-apps/plugin-dialog";
import {
  sftpConnect,
  sftpDisconnect,
  sftpListDir,
  sftpDownload,
  sftpUpload,
  sftpMkdir,
  sftpRename,
  sftpDelete,
  type SftpEntry,
} from "../remote/sftpApi";
import { cn } from "@/lib/utils";
import { toast } from "../toast";
import { getHomeDir } from "../fs";
import { markHostConnected, markHostDisconnected } from "../remote/connectionStore";

interface SftpViewProps {
  host: string;
  onClose: () => void;
}

interface TransferProgress {
  type: "download" | "upload";
  path: string;
  progress: number;
  copied?: number;
  total?: number;
  done?: boolean;
}

export function SftpView({ host, onClose }: SftpViewProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [cwd, setCwd] = useState(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry?: SftpEntry } | null>(null);
  const [transfers, setTransfers] = useState<TransferProgress[]>([]);
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "details">("list");

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        // Normalize path: remove trailing slashes, handle empty paths
        const normalized = path.replace(/\/+$/, "") || "/";
        const list = await sftpListDir(host, normalized);
        setEntries(list);
        setCwd(normalized);
      } catch (e) {
        toast({ title: String(e), variant: "error" });
      } finally {
        setLoading(false);
      }
    },
    [host]
  );

  useEffect(() => {
    let mounted = true;
    let progressUnlisten: (() => void) | null = null;

    // Listen for transfer progress events
    listen<TransferProgress>(`sftp://progress/${host}`, (e) => {
      if (!mounted) return;
      const data = e.payload;
      setTransfers((prev) => {
        const existing = prev.findIndex((t) => t.path === data.path && t.type === data.type);
        if (existing >= 0) {
          const next = [...prev];
          if (data.done) {
            next.splice(existing, 1);
          } else {
            next[existing] = data;
          }
          return next;
        }
        return data.done ? prev : [...prev, data];
      });
    }).then((unlisten) => {
      if (mounted) progressUnlisten = unlisten;
    });

    sftpConnect(host)
      .then(() => {
        if (!mounted) return;
        setConnected(true);
        markHostConnected(host);
        return load(".");
      })
      .catch((e) => {
        if (!mounted) return;
        toast({ title: `SFTP connect failed: ${e}`, variant: "error" });
        onCloseRef.current();
      });

    return () => {
      mounted = false;
      progressUnlisten?.();
      sftpDisconnect(host).catch(() => {});
      markHostDisconnected(host);
    };
  }, [host, load]);

  const handleDownload = async (entry: SftpEntry) => {
    try {
      const home = await getHomeDir();
      // Show save dialog with default filename in Downloads
      const localPath = await save({
        defaultPath: `${home}/Downloads/${entry.name}`,
      });
      if (!localPath) {
        setContextMenu(null);
        return; // User cancelled
      }
      await sftpDownload(host, entry.path, localPath);
      toast({
        title: `Downloaded ${entry.name}`,
        message: `Saved to ${localPath}`,
        variant: "info",
      });
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
    setContextMenu(null);
  };

  const handleUpload = async () => {
    try {
      const home = await getHomeDir();
      // Show open dialog to pick file(s)
      const selected = await open({
        multiple: true,
        defaultPath: home,
      });
      if (!selected) return; // User cancelled

      const files = Array.isArray(selected) ? selected : [selected];
      for (const filePath of files) {
        const fileName = filePath.split("/").pop() || filePath;
        const remotePath = cwd === "/" ? `/${fileName}` : `${cwd}/${fileName}`;
        await sftpUpload(host, filePath, remotePath);
      }
      toast({
        title: `Uploaded ${files.length} file(s)`,
        message: `To ${cwd}`,
        variant: "info",
      });
      load(cwd);
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
  };

  const handleDelete = async (entry: SftpEntry) => {
    try {
      await sftpDelete(host, entry.path, entry.is_dir);
      toast({ title: `Deleted ${entry.name}`, variant: "info" });
      load(cwd);
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
    setContextMenu(null);
  };

  const handleRename = async () => {
    if (!renameTarget || !newName) return;
    try {
      const to = `${cwd}/${newName}`;
      await sftpRename(host, renameTarget.path, to);
      toast({ title: `Renamed to ${newName}`, variant: "info" });
      setRenameTarget(null);
      setNewName("");
      load(cwd);
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
  };

  const handleMkdir = async () => {
    if (!mkdirName) return;
    try {
      const path = cwd === "." ? mkdirName : `${cwd}/${mkdirName}`;
      await sftpMkdir(host, path);
      toast({ title: `Created ${mkdirName}`, variant: "info" });
      setMkdirOpen(false);
      setMkdirName("");
      load(cwd);
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
  };

  const breadcrumbs = cwd === "." ? ["~"] : cwd.split("/").filter(Boolean);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-medium text-muted-foreground truncate">{host}</span>
          <span className={cn("w-1.5 h-1.5 rounded-full", connected ? "bg-green-500" : "bg-red-500")} />
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={handleUpload}
            title="Upload"
          >
            ↑
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={() => setMkdirOpen(true)}
            title="New Folder"
          >
            +
          </button>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              className={cn(
                "p-1 rounded text-[11px] w-6 h-6 flex items-center justify-center",
                viewMode === "list" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={() => setViewMode("list")}
              title="List view"
            >
              ☰
            </button>
            <button
              type="button"
              className={cn(
                "p-1 rounded text-[11px] w-6 h-6 flex items-center justify-center",
                viewMode === "details" ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
              onClick={() => setViewMode("details")}
              title="Details view"
            >
              ☰☰
            </button>
          </div>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-500"
            onClick={() => {
              sftpDisconnect(host).catch(() => {});
              markHostDisconnected(host);
              onCloseRef.current();
            }}
            title="Disconnect"
          >
            ⏻
          </button>
        </div>
      </div>

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 px-3 py-1.5 text-[11px] border-b border-border/50 overflow-x-auto">
        <button
          type="button"
          className="hover:text-foreground text-muted-foreground transition-colors mr-1"
          onClick={() => load("/")}
          title="Root"
        >
          /
        </button>
        {cwd !== "/" && (
          <button
            type="button"
            className="hover:text-foreground text-muted-foreground transition-colors mr-1"
            onClick={() => {
              const parent = cwd.split("/").filter(Boolean).slice(0, -1).join("/") || "/";
              load(parent);
            }}
            title="Parent"
          >
            ..
          </button>
        )}
        {breadcrumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-muted-foreground">/</span>}
            <button
              type="button"
              className="hover:text-foreground text-muted-foreground transition-colors"
              onClick={() => {
                const path = breadcrumbs.slice(0, i + 1).join("/");
                load(path || ".");
              }}
            >
              {crumb}
            </button>
          </span>
        ))}
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-xs text-muted-foreground">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="p-4 text-xs text-muted-foreground">Empty directory</div>
        ) : viewMode === "details" ? (
          /* Details view */
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-background border-b border-border">
              <tr className="text-muted-foreground text-[10px] uppercase">
                <th className="text-left px-3 py-1 font-medium">Name</th>
                <th className="text-right px-3 py-1 font-medium w-24">Size</th>
                <th className="text-left px-3 py-1 font-medium w-32">Modified</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.path}
                  className={cn(
                    "cursor-pointer hover:bg-accent/50 border-b border-border/30",
                    selected.has(entry.path) && "bg-accent"
                  )}
                  onClick={() => {
                    if (entry.is_dir) {
                      load(entry.path);
                    } else {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(entry.path)) next.delete(entry.path);
                        else next.add(entry.path);
                        return next;
                      });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, entry });
                  }}
                >
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="text-muted-foreground">{entry.is_dir ? "📁" : "📄"}</span>
                      <span className="truncate">{entry.name}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right text-muted-foreground">
                    {entry.is_dir ? "—" : formatSize(entry.size)}
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground text-[10px]">
                    {entry.modified ? formatDate(entry.modified) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* List view (default) */
          entries.map((entry) => (
            <div
              key={entry.path}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-[12px] cursor-pointer hover:bg-accent/50",
                selected.has(entry.path) && "bg-accent"
              )}
              onClick={() => {
                if (entry.is_dir) {
                  load(entry.path);
                } else {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (next.has(entry.path)) next.delete(entry.path);
                    else next.add(entry.path);
                    return next;
                  });
                }
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, entry });
              }}
            >
              <span className="text-muted-foreground w-4">
                {entry.is_dir ? "📁" : "📄"}
              </span>
              <span className="flex-1 truncate">{entry.name}</span>
              <span className="text-muted-foreground text-[10px]">
                {entry.is_dir ? "—" : formatSize(entry.size)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 min-w-[140px] rounded-lg border border-border/60 bg-popover shadow-lg py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            {contextMenu.entry && !contextMenu.entry.is_dir && (
              <button
                type="button"
                className="w-full text-left px-2.5 py-1 text-[12px] hover:bg-accent"
                onClick={() => contextMenu.entry && handleDownload(contextMenu.entry)}
              >
                Download
              </button>
            )}
            <button
              type="button"
              className="w-full text-left px-2.5 py-1 text-[12px] hover:bg-accent"
              onClick={() => {
                if (contextMenu.entry) {
                  setRenameTarget(contextMenu.entry);
                  setNewName(contextMenu.entry.name);
                }
                setContextMenu(null);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="w-full text-left px-2.5 py-1 text-[12px] hover:bg-accent text-red-500"
              onClick={() => contextMenu.entry && handleDelete(contextMenu.entry)}
            >
              Delete
            </button>
          </div>
        </>
      )}

      {/* Transfer progress */}
      {transfers.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 bg-popover border-t border-border p-2 space-y-1.5 max-h-32 overflow-y-auto">
          {transfers.map((t) => (
            <div key={`${t.type}-${t.path}`} className="flex items-center gap-2 text-[11px]">
              <span className="text-muted-foreground w-16 shrink-0">
                {t.type === "download" ? "↓ Download" : "↑ Upload"}
              </span>
              <span className="flex-1 truncate text-foreground">{t.path.split("/").pop()}</span>
              <span className="text-muted-foreground w-12 text-right shrink-0">{t.progress}%</span>
              <div className="w-16 h-1 bg-muted rounded-full overflow-hidden shrink-0">
                <div
                  className="h-full bg-primary transition-all duration-200"
                  style={{ width: `${t.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Rename dialog */}
      {renameTarget && (
        <div className="absolute inset-x-0 bottom-0 bg-popover border-t border-border p-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-[12px] outline-none focus:border-ring"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
                if (e.key === "Escape") {
                  setRenameTarget(null);
                  setNewName("");
                }
              }}
            />
            <button
              type="button"
              className="px-2 py-1 text-[11px] rounded bg-primary text-primary-foreground"
              onClick={handleRename}
            >
              Rename
            </button>
          </div>
        </div>
      )}

      {/* Mkdir dialog */}
      {mkdirOpen && (
        <div className="absolute inset-x-0 bottom-0 bg-popover border-t border-border p-3">
          <div className="flex items-center gap-2">
            <input
              autoFocus
              className="flex-1 bg-transparent border border-border rounded px-2 py-1 text-[12px] outline-none focus:border-ring"
              placeholder="Folder name"
              value={mkdirName}
              onChange={(e) => setMkdirName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleMkdir();
                if (e.key === "Escape") {
                  setMkdirOpen(false);
                  setMkdirName("");
                }
              }}
            />
            <button
              type="button"
              className="px-2 py-1 text-[11px] rounded bg-primary text-primary-foreground"
              onClick={handleMkdir}
            >
              Create
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp * 1000);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const isThisYear = d.getFullYear() === now.getFullYear();
  if (isThisYear) {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
