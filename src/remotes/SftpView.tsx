import { useCallback, useEffect, useRef, useState } from "react";
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

export function SftpView({ host, onClose }: SftpViewProps) {
  const [cwd, setCwd] = useState(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; entry?: SftpEntry } | null>(null);
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const list = await sftpListDir(host, path);
        setEntries(list);
        setCwd(path);
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
        onClose();
      });
    return () => {
      mounted = false;
      sftpDisconnect(host).catch(() => {});
      markHostDisconnected(host);
    };
  }, [host, load, onClose]);

  const handleDownload = async (entry: SftpEntry) => {
    try {
      const home = await getHomeDir();
      const localPath = `${home}/Downloads/${entry.name}`;
      await sftpDownload(host, entry.path, localPath);
      toast({ title: `Downloaded ${entry.name}`, variant: "info" });
    } catch (e) {
      toast({ title: String(e), variant: "error" });
    }
    setContextMenu(null);
  };

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const home = await getHomeDir();
      for (const file of Array.from(files)) {
        const localPath = `${home}/.husk-tmp-upload-${file.name}`;
        // Write to temp path via Tauri fs API would be needed here
        // For now, we rely on the user picking via dialog
        await sftpUpload(host, localPath, `${cwd}/${file.name}`);
      }
      toast({ title: `Uploaded ${files.length} file(s)`, variant: "info" });
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
            onClick={() => fileInputRef.current?.click()}
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
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-red-500"
            onClick={() => {
              sftpDisconnect(host).catch(() => {});
              markHostDisconnected(host);
              onClose();
            }}
            title="Disconnect"
          >
            ⏻
          </button>
          <button
            type="button"
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
            onClick={onClose}
            title="Close"
          >
            ×
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
        {cwd !== "." && cwd !== "/" && (
          <button
            type="button"
            className="hover:text-foreground text-muted-foreground transition-colors mr-1"
            onClick={() => {
              const parent = cwd.split("/").slice(0, -1).join("/") || ".";
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
        ) : (
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

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleUpload(e.target.files)}
      />
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}G`;
}
