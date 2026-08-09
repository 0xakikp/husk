import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowUp01Icon,
  Cancel01Icon,
  ClipboardPasteIcon,
  Copy01Icon,
  Delete02Icon,
  Download01Icon,
  Edit02Icon,
  File02Icon,
  Folder01Icon,
  FolderDownloadIcon,
  FolderUploadIcon,
  GridViewIcon,
  LinkSquare01Icon,
  ListViewIcon,
  Move01Icon,
  MoreHorizontalIcon,
  Refresh01Icon,
  Upload01Icon,
} from "@hugeicons/core-free-icons";
import {
  sftpConnect,
  sftpCopy,
  sftpDelete,
  sftpDeleteRecursive,
  sftpDisconnect,
  sftpListDir,
  sftpMkdir,
  sftpRename,
  type SftpEntry,
} from "../remote/sftpApi";
import { cn } from "@/lib/utils";
import { toast } from "../toast";
import { getHomeDir } from "../fs";
import { markHostConnected, markHostDisconnected } from "../remote/connectionStore";
import {
  activateSftpTransferQueue,
  clearCompletedSftpTransfers,
  enqueueSftpTransfer,
  pauseSftpTransfer,
  removeSftpTransfer,
  resumeSftpTransfer,
  retrySftpTransfer,
  useSftpTransfers,
  type SftpFolderConflictStrategy,
  type SftpTransfer,
} from "../remote/sftpTransfers";

interface SftpViewProps {
  host: string;
  onClose: () => void;
}

type RemoteClipboard = {
  entry: SftpEntry;
  operation: "copy" | "move";
};

type ContextMenuState = {
  x: number;
  y: number;
  entry?: SftpEntry;
};

type FolderUploadConflict = {
  localPath: string;
  name: string;
  remoteParent: string;
  existing: SftpEntry;
};

function remoteJoin(parent: string, child: string): string {
  if (parent === "/") return `/${child}`;
  return `${parent.replace(/\/+$/, "")}/${child}`;
}

function remoteParent(path: string): string {
  if (path === "." || path === "/") return path;
  const trimmed = path.replace(/\/+$/, "");
  const parent = trimmed.slice(0, Math.max(0, trimmed.lastIndexOf("/")));
  if (!parent || parent === ".") return ".";
  return parent;
}

function oneDialogPath(value: string | string[] | null): string | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return "—";
  const date = new Date(timestamp * 1000);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return `Today, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function ToolbarButton({
  label,
  icon,
  onClick,
  danger = false,
  active = false,
}: {
  label: string;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
        active && "bg-primary/12 text-primary",
        danger && "hover:bg-red-500/10 hover:text-red-400",
      )}
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.7} />
    </button>
  );
}

function ContextAction({
  children,
  icon,
  onClick,
  danger = false,
  disabled = false,
}: {
  children: ReactNode;
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[10.5px] text-foreground transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-40",
        danger && "text-red-400 hover:bg-red-500/10",
      )}
    >
      <HugeiconsIcon icon={icon} size={13} strokeWidth={1.65} className="shrink-0 opacity-75" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  );
}

function ContextDivider() {
  return <div className="my-1 h-px bg-border/60" />;
}

function transferStateLabel(task: SftpTransfer): string {
  if (task.state === "completed") return "done";
  if (task.state === "running") return task.total ? `${task.progress}%` : "working";
  if (task.state === "queued") return "queued";
  if (task.state === "paused") return "paused";
  return "needs retry";
}

function TransferQueue({ host, transfers }: { host: string; transfers: SftpTransfer[] }) {
  const active = transfers.filter((task) => task.state === "running" || task.state === "queued").length;
  const completed = transfers.some((task) => task.state === "completed");
  const visible = transfers.slice(0, 4);

  return (
    <section className="shrink-0 border-t border-border/70 bg-muted/[0.09]" aria-label="SFTP transfer queue">
      <header className="flex h-8 items-center gap-2 border-b border-border/45 px-3 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        <span className={cn("size-1.5 rounded-full", active ? "bg-primary shadow-[0_0_7px_var(--primary)]" : "bg-muted-foreground/35")} />
        <span className="font-semibold text-foreground/85">Transfer queue</span>
        <span>{active ? `${active} active` : transfers.length ? `${transfers.length} saved` : "idle"}</span>
        {completed ? (
          <button type="button" onClick={() => clearCompletedSftpTransfers(host)} className="ml-auto text-[9px] normal-case tracking-normal text-muted-foreground transition-colors hover:text-foreground">clear finished</button>
        ) : null}
      </header>
      {visible.length === 0 ? (
        <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-muted-foreground">
          <span className="h-1 w-24 overflow-hidden rounded-full bg-border/70"><span className="block h-full w-0 bg-primary" /></span>
          <span>Transfers will stay here while they run.</span>
        </div>
      ) : (
        <div className="divide-y divide-border/35">
          {visible.map((task) => {
            const indeterminate = task.state === "running" && !task.total;
            return (
              <div key={task.id} className="flex min-h-10 items-center gap-2 px-3 py-1.5 text-[10px]">
                <HugeiconsIcon icon={task.direction === "download" ? ArrowDown01Icon : ArrowUp01Icon} size={12} className={cn("shrink-0", task.state === "failed" ? "text-red-400" : task.state === "paused" ? "text-amber-400" : task.state === "completed" ? "text-muted-foreground/55" : "text-primary")} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-foreground/90" title={task.label}>{task.label}</span>
                    <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground">{transferStateLabel(task)}</span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border/65">
                    <span
                      className={cn("block h-full bg-primary transition-[width] duration-200", indeterminate && "w-1/3 animate-pulse")}
                      style={indeterminate ? undefined : { width: `${task.state === "completed" ? 100 : task.progress}%` }}
                    />
                  </div>
                  {task.error && task.state !== "completed" ? <p className="mt-1 truncate text-[8.5px] text-muted-foreground/75" title={task.error}>{task.error}</p> : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {task.state === "running" ? <button type="button" onClick={() => pauseSftpTransfer(task.id)} className="rounded px-1.5 py-1 text-[9px] text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-400">cancel</button> : null}
                  {task.state === "paused" ? <button type="button" onClick={() => resumeSftpTransfer(task.id)} className="rounded px-1.5 py-1 text-[9px] text-primary transition-colors hover:bg-primary/10">resume</button> : null}
                  {task.state === "failed" ? <button type="button" onClick={() => retrySftpTransfer(task.id)} className="rounded px-1.5 py-1 text-[9px] text-primary transition-colors hover:bg-primary/10">retry</button> : null}
                  {task.state !== "running" ? <button type="button" onClick={() => removeSftpTransfer(task.id)} className="rounded px-1.5 py-1 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">×</button> : null}
                </div>
              </div>
            );
          })}
          {transfers.length > visible.length ? <p className="px-3 py-1.5 text-[9px] text-muted-foreground">+ {transfers.length - visible.length} more saved transfers</p> : null}
        </div>
      )}
    </section>
  );
}

/** A details-first SFTP browser. It intentionally behaves like a file manager:
    click selects, double-click opens a folder, and all destructive work is
    confirmed. Transfers use the Tauri SFTP backend rather than shelling out. */
export function SftpView({ host, onClose }: SftpViewProps) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const [cwd, setCwd] = useState(".");
  const [entries, setEntries] = useState<SftpEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [connected, setConnected] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [clipboard, setClipboard] = useState<RemoteClipboard | null>(null);
  const [renameTarget, setRenameTarget] = useState<SftpEntry | null>(null);
  const [newName, setNewName] = useState("");
  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [mkdirName, setMkdirName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SftpEntry | null>(null);
  const [folderUploadConflict, setFolderUploadConflict] = useState<FolderUploadConflict | null>(null);
  const [viewMode, setViewMode] = useState<"details" | "tiles">("details");
  const transfers = useSftpTransfers(host);

  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.path === selectedPath) ?? null,
    [entries, selectedPath],
  );

  const load = useCallback(
    async (path: string) => {
      setLoading(true);
      try {
        const normalized = path.replace(/\/+$/, "") || "/";
        const list = await sftpListDir(host, normalized);
        setEntries(list);
        setCwd(normalized);
        setSelectedPath(null);
      } catch (error) {
        toast({ title: "Could not list remote folder", message: String(error), variant: "error" });
      } finally {
        setLoading(false);
      }
    },
    [host],
  );

  useEffect(() => {
    let mounted = true;
    let deactivateQueue: (() => void) | undefined;

    void sftpConnect(host)
      .then(async () => {
        if (!mounted) return;
        setConnected(true);
        markHostConnected(host);
        deactivateQueue = activateSftpTransferQueue(host);
        await load(".");
      })
      .catch((error) => {
        if (!mounted) return;
        toast({ title: "SFTP connect failed", message: String(error), variant: "error" });
        onCloseRef.current();
      });

    return () => {
      mounted = false;
      deactivateQueue?.();
      void sftpDisconnect(host);
      markHostDisconnected(host);
    };
  }, [host, load]);

  useEffect(() => {
    const refreshAfterTransfer = (event: Event) => {
      if ((event as CustomEvent<{ host?: string }>).detail?.host === host) void load(cwd);
    };
    window.addEventListener("husk-sftp-transfer-complete", refreshAfterTransfer);
    return () => window.removeEventListener("husk-sftp-transfer-complete", refreshAfterTransfer);
  }, [cwd, host, load]);

  const openFolder = (entry: SftpEntry) => {
    if (entry.is_dir) void load(entry.path);
  };

  const handleDownload = async (entry: SftpEntry) => {
    try {
      const home = await getHomeDir();
      if (entry.is_dir) {
        const destination = oneDialogPath(await open({
          title: `Download ${entry.name} to…`,
          directory: true,
          defaultPath: `${home}/Downloads`,
        }));
        if (!destination) return;
        enqueueSftpTransfer({ host, direction: "download", kind: "folder", remotePath: entry.path, localPath: destination, label: entry.name });
        toast({ title: `Queued ${entry.name}`, message: `Folder will download to ${destination}`, variant: "success" });
      } else {
        const destination = await save({
          title: `Download ${entry.name}`,
          defaultPath: `${home}/Downloads/${entry.name}`,
        });
        if (!destination) return;
        enqueueSftpTransfer({ host, direction: "download", kind: "file", remotePath: entry.path, localPath: destination, label: entry.name });
        toast({ title: `Queued ${entry.name}`, message: `Download will be saved to ${destination}`, variant: "success" });
      }
    } catch (error) {
      toast({ title: "Download failed", message: String(error), variant: "error" });
    } finally {
      setContextMenu(null);
    }
  };

  const confirmOverwrite = (name: string): boolean => {
    if (!entries.some((entry) => entry.name === name)) return true;
    return window.confirm(`“${name}” already exists in this remote folder. Replace it?`);
  };

  const queueFolderUpload = (
    localPath: string,
    name: string,
    remoteParent: string,
    folderConflictStrategy: SftpFolderConflictStrategy,
  ) => {
    enqueueSftpTransfer({
      host,
      direction: "upload",
      kind: "folder",
      localPath,
      remotePath: remoteParent,
      label: name,
      folderConflictStrategy,
    });
    toast({
      title: `Queued ${name}`,
      message: folderConflictStrategy === "replace"
        ? `The existing destination will be replaced in ${remoteParent}.`
        : `Folder will merge into ${remoteParent}.`,
      variant: "success",
    });
  };

  const resolveFolderUploadConflict = (folderConflictStrategy: SftpFolderConflictStrategy) => {
    const conflict = folderUploadConflict;
    if (!conflict) return;
    queueFolderUpload(conflict.localPath, conflict.name, conflict.remoteParent, folderConflictStrategy);
    setFolderUploadConflict(null);
  };

  const handleUploadFiles = async () => {
    try {
      const home = await getHomeDir();
      const picked = await open({ title: "Upload files", multiple: true, defaultPath: home });
      if (!picked) return;
      const files = Array.isArray(picked) ? picked : [picked];
      let queued = 0;
      for (const localPath of files) {
        const fileName = localPath.split(/[\\/]/).pop() || localPath;
        if (!confirmOverwrite(fileName)) continue;
        enqueueSftpTransfer({ host, direction: "upload", kind: "file", localPath, remotePath: remoteJoin(cwd, fileName), label: fileName });
        queued += 1;
      }
      if (queued) toast({ title: `${queued} upload${queued === 1 ? "" : "s"} queued`, message: `To ${cwd}`, variant: "success" });
    } catch (error) {
      toast({ title: "Upload failed", message: String(error), variant: "error" });
    } finally {
      setContextMenu(null);
    }
  };

  const handleUploadFolder = async () => {
    try {
      const home = await getHomeDir();
      const localPath = oneDialogPath(await open({
        title: "Upload folder",
        directory: true,
        recursive: true,
        defaultPath: home,
      }));
      if (!localPath) return;
      const name = localPath.split(/[\\/]/).filter(Boolean).pop() || localPath;
      const existing = entries.find((entry) => entry.name === name);
      if (existing) {
        setFolderUploadConflict({ localPath, name, remoteParent: cwd, existing });
        return;
      }
      queueFolderUpload(localPath, name, cwd, "merge");
    } catch (error) {
      toast({ title: "Folder upload failed", message: String(error), variant: "error" });
    } finally {
      setContextMenu(null);
    }
  };

  const queueClipboard = (entry: SftpEntry, operation: RemoteClipboard["operation"]) => {
    setClipboard({ entry, operation });
    setContextMenu(null);
    toast({
      title: operation === "copy" ? `Copied ${entry.name}` : `Ready to move ${entry.name}`,
      message: "Open a remote folder and choose Paste.",
      variant: "info",
    });
  };

  const pasteClipboard = async () => {
    if (!clipboard) return;
    const destination = remoteJoin(cwd, clipboard.entry.name);
    if (destination === clipboard.entry.path) {
      toast({ title: "Choose a different destination folder", variant: "info" });
      return;
    }
    if (!confirmOverwrite(clipboard.entry.name)) return;
    try {
      if (clipboard.operation === "move") {
        await sftpRename(host, clipboard.entry.path, destination);
        setClipboard(null);
        toast({ title: `Moved ${clipboard.entry.name}`, message: `To ${cwd}`, variant: "success" });
      } else {
        await sftpCopy(host, clipboard.entry.path, destination);
        toast({ title: `Copied ${clipboard.entry.name}`, message: `To ${cwd}`, variant: "success" });
      }
      await load(cwd);
    } catch (error) {
      toast({ title: clipboard.operation === "move" ? "Move failed" : "Copy failed", message: String(error), variant: "error" });
    } finally {
      setContextMenu(null);
    }
  };

  const handleRename = async () => {
    const nextName = newName.trim();
    if (!renameTarget || !nextName) return;
    if (/[\\/]/.test(nextName) || nextName === "." || nextName === "..") {
      toast({ title: "Enter a valid item name", message: "Names cannot be . , .. , or contain a path separator.", variant: "error" });
      return;
    }
    try {
      await sftpRename(host, renameTarget.path, remoteJoin(remoteParent(renameTarget.path), nextName));
      toast({ title: `Renamed to ${nextName}`, variant: "success" });
      setRenameTarget(null);
      setNewName("");
      await load(cwd);
    } catch (error) {
      toast({ title: "Rename failed", message: String(error), variant: "error" });
    }
  };

  const handleMkdir = async () => {
    const name = mkdirName.trim();
    if (!name) return;
    if (/[\\/]/.test(name) || name === "." || name === "..") {
      toast({ title: "Enter a valid folder name", message: "Names cannot be . , .. , or contain a path separator.", variant: "error" });
      return;
    }
    try {
      await sftpMkdir(host, remoteJoin(cwd, name));
      toast({ title: `Created ${name}`, variant: "success" });
      setMkdirOpen(false);
      setMkdirName("");
      await load(cwd);
    } catch (error) {
      toast({ title: "Could not create folder", message: String(error), variant: "error" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.is_dir) await sftpDeleteRecursive(host, deleteTarget.path);
      else await sftpDelete(host, deleteTarget.path);
      toast({ title: `Deleted ${deleteTarget.name}`, variant: "success" });
      setDeleteTarget(null);
      await load(cwd);
    } catch (error) {
      toast({ title: "Delete failed", message: String(error), variant: "error" });
    }
  };

  const breadcrumbParts = cwd === "." || cwd === "/" ? [] : cwd.replace(/^\.\//, "").split("/").filter(Boolean);
  const breadcrumbBase = cwd.startsWith("/") ? "/" : ".";

  const showContextMenu = (event: React.MouseEvent, entry?: SftpEntry) => {
    event.preventDefault();
    event.stopPropagation();
    if (entry) setSelectedPath(entry.path);
    setContextMenu({
      x: Math.min(event.clientX, window.innerWidth - 208),
      y: Math.min(event.clientY, window.innerHeight - 300),
      entry,
    });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-background font-mono text-foreground">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-muted/15 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("size-1.5 shrink-0 rounded-full", connected ? "bg-emerald-400 shadow-[0_0_8px_rgba(74,222,128,.7)]" : "bg-red-400")} />
          <span className="truncate text-[11.5px] font-semibold text-foreground">{host}</span>
          <span className="hidden text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/65 sm:inline">SFTP</span>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <ToolbarButton label="Upload files" icon={Upload01Icon} onClick={() => void handleUploadFiles()} />
          <ToolbarButton label="Upload folder" icon={FolderUploadIcon} onClick={() => void handleUploadFolder()} />
          <ToolbarButton label="New remote folder" icon={Add01Icon} onClick={() => setMkdirOpen(true)} />
          <ToolbarButton label="Refresh" icon={Refresh01Icon} onClick={() => void load(cwd)} />
          <span className="mx-0.5 h-4 w-px bg-border/65" />
          <ToolbarButton label="Details view" icon={ListViewIcon} active={viewMode === "details"} onClick={() => setViewMode("details")} />
          <ToolbarButton label="Tiles view" icon={GridViewIcon} active={viewMode === "tiles"} onClick={() => setViewMode("tiles")} />
          <ToolbarButton
            label="Disconnect SFTP"
            icon={Cancel01Icon}
            danger
            onClick={() => {
              void sftpDisconnect(host);
              markHostDisconnected(host);
              onCloseRef.current();
            }}
          />
        </div>
      </header>

      <nav className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border/50 px-3 py-1.5 text-[10px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Remote path">
        <button type="button" onClick={() => void load(".")} className="shrink-0 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">~</button>
        {cwd !== "." && (
          <>
            <span className="text-muted-foreground/45">/</span>
            <button type="button" onClick={() => void load("/")} className="shrink-0 rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">root</button>
          </>
        )}
        {breadcrumbParts.map((part, index) => {
          const path = breadcrumbBase === "/"
            ? `/${breadcrumbParts.slice(0, index + 1).join("/")}`
            : `./${breadcrumbParts.slice(0, index + 1).join("/")}`;
          return (
            <span key={`${path}-${part}`} className="flex shrink-0 items-center gap-1">
              <span className="text-muted-foreground/45">/</span>
              <button type="button" onClick={() => void load(path)} className="rounded px-1 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">{part}</button>
            </span>
          );
        })}
        {cwd !== "." && (
          <button
            type="button"
            title="Parent folder"
            onClick={() => void load(remoteParent(cwd))}
            className="ml-auto shrink-0 rounded px-1 py-0.5 text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
          >
            ..
          </button>
        )}
      </nav>

      <main
        className="min-h-0 flex-1 overflow-auto"
        onContextMenu={(event) => {
          if ((event.target as HTMLElement).closest("[data-sftp-entry]")) return;
          showContextMenu(event);
        }}
      >
        {loading ? (
          <div className="flex h-36 items-center justify-center gap-2 text-[11px] text-muted-foreground"><span className="size-1.5 animate-pulse rounded-full bg-primary" />Loading remote folder…</div>
        ) : entries.length === 0 ? (
          <div className="flex h-36 flex-col items-center justify-center gap-2 text-center">
            <HugeiconsIcon icon={Folder01Icon} size={20} className="text-muted-foreground/45" />
            <p className="m-0 text-[11px] text-muted-foreground">This remote folder is empty.</p>
            <button type="button" onClick={() => setMkdirOpen(true)} className="text-[10px] text-primary hover:underline">[ create folder ]</button>
          </div>
        ) : viewMode === "details" ? (
          <table className="w-full min-w-[620px] table-fixed border-collapse text-[11px]">
            <thead className="sticky top-0 z-10 bg-background/95 text-left text-[9px] uppercase tracking-[0.11em] text-muted-foreground backdrop-blur">
              <tr className="border-b border-border/70">
                <th className="w-[48%] px-3 py-2 font-medium">Name</th>
                <th className="w-24 px-3 py-2 font-medium">Type</th>
                <th className="w-24 px-3 py-2 text-right font-medium">Size</th>
                <th className="w-40 px-3 py-2 font-medium">Modified</th>
                <th className="w-9 px-1 py-2" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => {
                const isSelected = selectedPath === entry.path;
                return (
                  <tr
                    key={entry.path}
                    data-sftp-entry
                    tabIndex={0}
                    className={cn("group cursor-default border-b border-border/35 outline-none transition-colors hover:bg-muted/55 focus-visible:bg-primary/10", isSelected && "bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]")}
                    onClick={() => setSelectedPath(entry.path)}
                    onDoubleClick={() => openFolder(entry)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") openFolder(entry);
                      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                        event.preventDefault();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setContextMenu({ x: Math.min(rect.left + 44, window.innerWidth - 208), y: Math.min(rect.bottom, window.innerHeight - 300), entry });
                      }
                    }}
                    onContextMenu={(event) => showContextMenu(event, entry)}
                  >
                    <td className="px-3 py-1.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <HugeiconsIcon icon={entry.is_dir ? Folder01Icon : File02Icon} size={14} strokeWidth={1.6} className={cn("shrink-0", entry.is_dir ? "text-primary" : "text-muted-foreground")} />
                        <span className="truncate font-medium text-foreground">{entry.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-[10px] text-muted-foreground">{entry.is_dir ? "Folder" : "File"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{entry.is_dir ? "—" : formatSize(entry.size)}</td>
                    <td className="px-3 py-1.5 tabular-nums text-[10px] text-muted-foreground">{formatDate(entry.modified)}</td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        title={`Actions for ${entry.name}`}
                        aria-label={`Actions for ${entry.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const rect = event.currentTarget.getBoundingClientRect();
                          setSelectedPath(entry.path);
                          setContextMenu({ x: Math.min(rect.right - 188, window.innerWidth - 208), y: Math.min(rect.bottom + 2, window.innerHeight - 300), entry });
                        }}
                        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <HugeiconsIcon icon={MoreHorizontalIcon} size={14} strokeWidth={1.7} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-2 p-3">
            {entries.map((entry) => {
              const isSelected = selectedPath === entry.path;
              return (
                <div
                  key={entry.path}
                  role="button"
                  tabIndex={0}
                  data-sftp-entry
                  onClick={() => setSelectedPath(entry.path)}
                  onDoubleClick={() => openFolder(entry)}
                  onContextMenu={(event) => showContextMenu(event, entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") openFolder(entry);
                    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setContextMenu({ x: Math.min(rect.left + 44, window.innerWidth - 208), y: Math.min(rect.bottom, window.innerHeight - 300), entry });
                    }
                  }}
                  title={entry.name}
                  className={cn(
                    "group relative flex min-h-28 cursor-default flex-col rounded-md border border-border/60 bg-card/45 p-2 text-left outline-none transition-[transform,background-color,border-color,box-shadow] duration-150 hover:-translate-y-px hover:border-primary/45 hover:bg-muted/55 hover:shadow-md focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/60",
                    isSelected && "border-primary/75 bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]",
                  )}
                >
                  <HugeiconsIcon icon={entry.is_dir ? Folder01Icon : File02Icon} size={22} strokeWidth={1.5} className={cn("mb-auto shrink-0", entry.is_dir ? "text-primary" : "text-muted-foreground/80")} />
                  <span className="mt-2 w-full truncate text-[10.5px] font-medium text-foreground">{entry.name}</span>
                  <span className="mt-0.5 w-full truncate text-[9px] text-muted-foreground">{entry.is_dir ? "Folder" : formatSize(entry.size)}</span>
                  <span className="mt-1 w-full truncate text-[8.5px] tabular-nums text-muted-foreground/65">{formatDate(entry.modified)}</span>
                  <button
                    type="button"
                    aria-label={`Actions for ${entry.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      const rect = event.currentTarget.getBoundingClientRect();
                      setSelectedPath(entry.path);
                      setContextMenu({ x: Math.min(rect.right - 188, window.innerWidth - 208), y: Math.min(rect.bottom + 2, window.innerHeight - 300), entry });
                    }}
                    className="absolute right-1 top-1 inline-flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
                  >
                    <HugeiconsIcon icon={MoreHorizontalIcon} size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center gap-2 border-t border-border/60 bg-muted/10 px-3 py-1.5 text-[9.5px] text-muted-foreground">
        <span>{entries.length} item{entries.length === 1 ? "" : "s"}</span>
        {selectedEntry ? <span className="truncate text-foreground/80">• {selectedEntry.name}</span> : null}
        {clipboard ? (
          <button type="button" onClick={() => setContextMenu({ x: 12, y: window.innerHeight - 240 })} className="ml-auto truncate text-primary hover:underline">
            {clipboard.operation === "copy" ? "copy" : "move"}: {clipboard.entry.name}
          </button>
        ) : <span className="ml-auto">right-click for actions</span>}
      </footer>

      <TransferQueue host={host} transfers={transfers} />

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} onContextMenu={(event) => { event.preventDefault(); setContextMenu(null); }} />
          <div
            role="menu"
            className="fixed z-50 w-48 overflow-hidden rounded-md border border-border/80 bg-popover py-1 shadow-xl shadow-black/45"
            style={{ left: Math.max(8, contextMenu.x), top: Math.max(8, contextMenu.y) }}
          >
            {contextMenu.entry ? (
              <>
                {contextMenu.entry.is_dir ? <ContextAction icon={Folder01Icon} onClick={() => { openFolder(contextMenu.entry!); setContextMenu(null); }}>Open folder</ContextAction> : null}
                <ContextAction icon={contextMenu.entry.is_dir ? FolderDownloadIcon : Download01Icon} onClick={() => void handleDownload(contextMenu.entry!)}>Download{contextMenu.entry.is_dir ? " folder" : ""}…</ContextAction>
                <ContextDivider />
                <ContextAction icon={Copy01Icon} onClick={() => queueClipboard(contextMenu.entry!, "copy")}>Copy</ContextAction>
                <ContextAction icon={Move01Icon} onClick={() => queueClipboard(contextMenu.entry!, "move")}>Move</ContextAction>
                <ContextAction icon={LinkSquare01Icon} onClick={() => { void writeText(contextMenu.entry!.path); toast({ title: "Remote path copied", variant: "success" }); setContextMenu(null); }}>Copy remote path</ContextAction>
                <ContextDivider />
                <ContextAction icon={Edit02Icon} onClick={() => { setRenameTarget(contextMenu.entry!); setNewName(contextMenu.entry!.name); setContextMenu(null); }}>Rename…</ContextAction>
                <ContextAction icon={Delete02Icon} danger onClick={() => { setDeleteTarget(contextMenu.entry!); setContextMenu(null); }}>Delete{contextMenu.entry.is_dir ? " folder" : ""}…</ContextAction>
              </>
            ) : (
              <>
                <ContextAction icon={Upload01Icon} onClick={() => void handleUploadFiles()}>Upload files…</ContextAction>
                <ContextAction icon={FolderUploadIcon} onClick={() => void handleUploadFolder()}>Upload folder…</ContextAction>
                <ContextAction icon={Add01Icon} onClick={() => { setMkdirOpen(true); setContextMenu(null); }}>New folder…</ContextAction>
                {clipboard ? <ContextAction icon={ClipboardPasteIcon} onClick={() => void pasteClipboard()}>Paste {clipboard.operation === "copy" ? "copy" : "move"}</ContextAction> : null}
                <ContextDivider />
                <ContextAction icon={Refresh01Icon} onClick={() => { void load(cwd); setContextMenu(null); }}>Refresh</ContextAction>
              </>
            )}
          </div>
        </>
      )}

      {(renameTarget || mkdirOpen || deleteTarget || folderUploadConflict) && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/65 p-4 backdrop-blur-[1px]">
          <div className="w-full max-w-sm rounded-lg border border-border bg-popover p-3 shadow-xl shadow-black/45">
            {folderUploadConflict ? (
              <>
                <p className={cn("m-0 text-[11px] font-semibold", folderUploadConflict.existing.is_dir ? "" : "text-amber-300")}>{folderUploadConflict.existing.is_dir ? `Folder ${folderUploadConflict.name} already exists` : `A file named ${folderUploadConflict.name} already exists`}</p>
                {folderUploadConflict.existing.is_dir ? (
                  <p className="mb-3 mt-1 text-[9.5px] leading-relaxed text-muted-foreground">Choose how to upload the local folder into <span className="text-foreground">{folderUploadConflict.remoteParent}</span>. Merging keeps remote-only content; matching files and incompatible paths are replaced by the local folder.</p>
                ) : (
                  <p className="mb-3 mt-1 text-[9.5px] leading-relaxed text-muted-foreground">A folder cannot merge with a file. Replacing it permanently deletes the remote file before the folder transfer starts.</p>
                )}
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => setFolderUploadConflict(null)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button>
                  {folderUploadConflict.existing.is_dir ? <button type="button" onClick={() => resolveFolderUploadConflict("merge")} className="rounded border border-border px-2 py-1 text-[10px] text-foreground transition-colors hover:border-primary/60 hover:bg-primary/10">Merge contents</button> : null}
                  <button type="button" onClick={() => resolveFolderUploadConflict("replace")} className="rounded bg-red-500/90 px-2 py-1 text-[10px] text-white hover:bg-red-500">{folderUploadConflict.existing.is_dir ? "Replace folder" : "Replace with folder"}</button>
                </div>
              </>
            ) : renameTarget ? (
              <>
                <p className="m-0 text-[11px] font-semibold">Rename {renameTarget.name}</p>
                <p className="mb-3 mt-1 text-[9.5px] text-muted-foreground">Only the name changes; the item stays in this remote folder.</p>
                <input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleRename(); if (event.key === "Escape") setRenameTarget(null); }} className="box-border w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary" />
                <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setRenameTarget(null)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button><button type="button" onClick={() => void handleRename()} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground">Rename</button></div>
              </>
            ) : mkdirOpen ? (
              <>
                <p className="m-0 text-[11px] font-semibold">New remote folder</p>
                <p className="mb-3 mt-1 text-[9.5px] text-muted-foreground">Create inside {cwd}.</p>
                <input autoFocus placeholder="Folder name" value={mkdirName} onChange={(event) => setMkdirName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleMkdir(); if (event.key === "Escape") setMkdirOpen(false); }} className="box-border w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary" />
                <div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setMkdirOpen(false)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button><button type="button" onClick={() => void handleMkdir()} className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground">Create</button></div>
              </>
            ) : deleteTarget ? (
              <>
                <p className="m-0 text-[11px] font-semibold text-red-300">Delete {deleteTarget.name}?</p>
                <p className="mb-3 mt-1 text-[9.5px] leading-relaxed text-muted-foreground">{deleteTarget.is_dir ? "This permanently removes the folder and everything inside it from the remote host." : "This permanently removes the remote file."} This cannot be undone.</p>
                <div className="flex justify-end gap-2"><button type="button" onClick={() => setDeleteTarget(null)} className="rounded px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted">Cancel</button><button type="button" onClick={() => void handleDelete()} className="rounded bg-red-500/90 px-2 py-1 text-[10px] text-white hover:bg-red-500">Delete permanently</button></div>
              </>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
