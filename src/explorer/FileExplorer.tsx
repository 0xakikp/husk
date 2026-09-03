import { useCallback, useEffect, useState, type DragEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  readDir,
  homeDir,
  createFile,
  createDir,
  copyPath as copyLocalPath,
  renamePath,
  deletePath,
  type DirEntry,
} from "../fs";
import {
  sshReadDir,
  sshCreateFile,
  sshCreateDir,
  sshCopyPath,
  sshRenamePath,
  sshDeletePath,
  sshHomeDir,
  sshPwd,
} from "../remote/remoteFs";
import { fileIconUrl, folderIconUrl } from "./iconResolver";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Copy01Icon, FileAddIcon, FolderAddIcon, Refresh01Icon, Search01Icon, Cancel01Icon, GlobalIcon, Location01Icon, FolderTreeIcon, Move01Icon } from "@hugeicons/core-free-icons";
import { PanelHeader } from "../shell/PanelHeader";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspaceRoot } from "../workspace/store";
import { useActiveTerminalCwd, runInActiveTerminal } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { getFileState, getUnsavedPathWithin, subscribeDirty } from "../editor/dirtyStore";
import { setActiveSshHost } from "../remote/store";
import { status as gitStatus } from "../git/client";
import { Modal } from "../components/Modal";
import {
  explorerTransferError,
  isExplorerPathWithin,
  joinExplorerPath,
  normalizeExplorerPath,
  parentExplorerPath,
  type ExplorerPathItem,
  type ExplorerTransferOperation,
} from "./pathOperations";

import { IS_MAC, IS_WINDOWS } from "../lib/platform";

const REVEAL_LABEL = IS_MAC ? "Reveal in Finder" : IS_WINDOWS ? "Show in Explorer" : "Show in File Manager";

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

type ExplorerTransferRequest = {
  source: ExplorerPathItem;
  operation: ExplorerTransferOperation;
};

function ExBtn({
  icon,
  label,
  onClick,
}: {
  icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={14} strokeWidth={1.5} />
    </button>
  );
}

export function FileExplorer({
  onOpenFile,
  activeFile,
  remoteHost,
}: {
  onOpenFile: (path: string, name: string) => void;
  activeFile?: string | null;
  remoteHost?: string | null;
}) {
  const wsRoot = useWorkspaceRoot();
  const termCwd = useActiveTerminalCwd();
  const [home, setHome] = useState<string | null>(null);
  const [remoteHome, setRemoteHome] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [rootCreate, setRootCreate] = useState<null | "file" | "dir">(null);
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [gitMap, setGitMap] = useState<Record<string, string>>({});
  const [transferRequest, setTransferRequest] = useState<ExplorerTransferRequest | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);

  // Fetch git status for workspace
  useEffect(() => {
    if (remoteHost || !wsRoot) return;
    const load = async () => {
      try {
        const list = await gitStatus(wsRoot);
        const map: Record<string, string> = {};
        for (const f of list) {
          const abs = joinPath(wsRoot, f.path);
          // work tree status takes priority over index status
          map[abs] = f.work !== " " ? f.work : f.index;
        }
        setGitMap(map);
      } catch {
        setGitMap({});
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [wsRoot, remoteHost, refreshKey]);

  useEffect(() => {
    if (!termCwd && !wsRoot && !home && !remoteHost) void homeDir().then(setHome);
  }, [termCwd, wsRoot, home, remoteHost]);

  useEffect(() => {
    if (remoteHost && !remoteHome) {
      void sshHomeDir(remoteHost).then(setRemoteHome).catch(() => setRemoteHome("/"));
    }
  }, [remoteHost, remoteHome]);

  // When in remote mode, root is the remote home dir
  const root = remoteHost ? remoteHome : (termCwd || wsRoot || home);

  const performTransfer = useCallback(async (
    request: ExplorerTransferRequest,
    destinationDirectory: string,
  ): Promise<boolean> => {
    if (!root || transferBusy) return false;
    const source = request.source;
    const normalizedRoot = normalizeExplorerPath(root);
    const normalizedDestination = normalizeExplorerPath(destinationDirectory);
    if (!isExplorerPathWithin(source.path, normalizedRoot)) {
      toast({ title: "Item is outside this Files workspace", variant: "error" });
      return false;
    }
    const validationError = explorerTransferError(source, normalizedDestination, normalizedRoot);
    if (validationError) {
      toast({ title: validationError, variant: "info" });
      return false;
    }
    const unsaved = getUnsavedPathWithin(source.path);
    if (unsaved) {
      toast({
        title: "Save your changes first",
        message: `${unsaved.split("/").pop() || unsaved} has unsaved changes. Save it before ${request.operation === "copy" ? "copying" : "moving"}.`,
        variant: "info",
      });
      return false;
    }

    const destination = joinExplorerPath(normalizedDestination, source.name);
    setTransferBusy(true);
    try {
      if (remoteHost) {
        if (request.operation === "copy") await sshCopyPath(remoteHost, source.path, destination);
        else await sshRenamePath(remoteHost, source.path, destination);
      } else if (request.operation === "copy") {
        await copyLocalPath(source.path, destination);
      } else {
        await renamePath(source.path, destination);
      }

      if (request.operation === "move") {
        window.dispatchEvent(new CustomEvent("husk:explorer-path-moved", {
          detail: { from: source.path, to: destination, remoteHost: remoteHost ?? null },
        }));
      }
      setTransferRequest(null);
      setRefreshKey((key) => key + 1);
      toast({
        title: `${request.operation === "copy" ? "Copied" : "Moved"} ${source.name}`,
        message: `To ${normalizedDestination}`,
        variant: "success",
      });
      return true;
    } catch (error) {
      toast({
        title: `Could not ${request.operation} ${source.name}`,
        message: error instanceof Error ? error.message : String(error),
        variant: "error",
      });
      return false;
    } finally {
      setTransferBusy(false);
    }
  }, [remoteHost, root, transferBusy]);

  const beginDrag = useCallback((event: DragEvent, source: ExplorerPathItem) => {
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-husk-files-item", JSON.stringify({
      source,
      remoteHost: remoteHost ?? null,
    }));
    event.dataTransfer.setData("text/plain", source.path);
  }, [remoteHost]);

  const dropInto = useCallback((event: DragEvent, destinationDirectory: string) => {
    event.preventDefault();
    event.stopPropagation();
    const encoded = event.dataTransfer.getData("application/x-husk-files-item");
    if (!encoded) return;
    try {
      const payload = JSON.parse(encoded) as { source?: ExplorerPathItem; remoteHost?: string | null };
      if (!payload.source || (payload.remoteHost ?? null) !== (remoteHost ?? null)) {
        toast({ title: "Drag within the same Files workspace", variant: "info" });
        return;
      }
      void performTransfer({ source: payload.source, operation: "move" }, destinationDirectory);
    } catch {
      toast({ title: "Could not read the dragged file", variant: "error" });
    }
  }, [performTransfer, remoteHost]);

  if (!root) return <div className="explorer-loading">Loading…</div>;

  const name = remoteHost ? remoteHost : (root.split("/").filter(Boolean).pop() ?? root);

  const doRootCreate = async (raw: string) => {
    const kind = rootCreate;
    setRootCreate(null);
    const value = raw.trim();
    if (!value || !kind) return;
    const target = joinPath(root, value);
    try {
      if (remoteHost) {
        if (kind === "dir") {
          await sshCreateDir(remoteHost, target);
        } else {
          await sshCreateFile(remoteHost, target);
          onOpenFile(target, value);
        }
      } else {
        if (kind === "dir") {
          await createDir(target);
        } else {
          await createFile(target);
          onOpenFile(target, value);
        }
      }
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    }
  };

  return (
    <div className="explorer">
      {/* Banded-chip header (PanelHeader): rail glyph + workspace context + actions. */}
      <PanelHeader
        icon={remoteHost ? GlobalIcon : FolderTreeIcon}
        title="Files"
        context={remoteHost ?? name}
        actions={
          <>
            {!remoteHost && (
              <ExBtn icon={Search01Icon} label="Search files" onClick={() => setFilterOpen((v) => !v)} />
            )}
            {remoteHost && (
              <>
                <ExBtn
                  icon={Location01Icon}
                  label="Sync CWD"
                  onClick={async () => {
                    if (!remoteHost) return;
                    try {
                      const pwd = await sshPwd(remoteHost);
                      if (pwd) {
                        setRemoteHome(pwd);
                        setRefreshKey((k) => k + 1);
                        toast({ title: `CWD: ${pwd}`, variant: "info" });
                      }
                    } catch (err) {
                      toast({ title: String(err), variant: "error" });
                    }
                  }}
                />
                <ExBtn
                  icon={Cancel01Icon}
                  label="Disconnect"
                  onClick={() => {
                    setActiveSshHost(null);
                    setRemoteHome(null);
                  }}
                />
              </>
            )}
            <ExBtn icon={FileAddIcon} label="New file" onClick={() => setRootCreate("file")} />
            <ExBtn icon={FolderAddIcon} label="New folder" onClick={() => setRootCreate("dir")} />
            <ExBtn icon={Refresh01Icon} label="Refresh" onClick={() => setRefreshKey((k) => k + 1)} />
          </>
        }
      />
      {filterOpen ? (
        <div className="px-2 pb-1">
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                setFilterOpen(false);
              }
            }}
            placeholder="Filter files…"
            className="h-6 w-full rounded border border-[var(--border)] bg-[var(--bg-input)] px-2 text-[11px] text-[var(--text)] outline-none focus:border-[var(--accent)] box-border"
          />
        </div>
      ) : null}
      {rootCreate ? (
        <EditRow
          depth={0}
          placeholder={rootCreate === "dir" ? "New folder name" : "New file name"}
          onSubmit={doRootCreate}
          onCancel={() => setRootCreate(null)}
        />
      ) : null}
      <Node
        key={`${root}:${refreshKey}:${remoteHost ?? "local"}`}
        path={root}
        name={name}
        depth={0}
        isDir
        headerless
        filter={filter}
        onOpenFile={onOpenFile}
        activeFile={activeFile}
        initiallyOpen
        remoteHost={remoteHost}
        gitMap={gitMap}
        onRequestTransfer={(source, operation) => setTransferRequest({ source, operation })}
        onDragStartItem={beginDrag}
        onDropInto={dropInto}
        onPathMoved={(from, to) => {
          window.dispatchEvent(new CustomEvent("husk:explorer-path-moved", {
            detail: { from, to, remoteHost: remoteHost ?? null },
          }));
        }}
        onPathDeleted={(path) => {
          window.dispatchEvent(new CustomEvent("husk:explorer-path-deleted", {
            detail: { path, remoteHost: remoteHost ?? null },
          }));
        }}
      />
      {transferRequest ? (
        <TransferDestinationPicker
          request={transferRequest}
          root={root}
          remoteHost={remoteHost}
          busy={transferBusy}
          onClose={() => {
            if (!transferBusy) setTransferRequest(null);
          }}
          onConfirm={(destination) => void performTransfer(transferRequest, destination)}
        />
      ) : null}
    </div>
  );
}

function TransferDestinationPicker({
  request,
  root,
  remoteHost,
  busy,
  onClose,
  onConfirm,
}: {
  request: ExplorerTransferRequest;
  root: string;
  remoteHost?: string | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (destinationDirectory: string) => void;
}) {
  const showHidden = usePrefs().showHidden;
  const normalizedRoot = normalizeExplorerPath(root);
  const sourceParent = parentExplorerPath(request.source.path);
  const [current, setCurrent] = useState(
    isExplorerPathWithin(sourceParent, normalizedRoot) ? sourceParent : normalizedRoot,
  );
  const [pathInput, setPathInput] = useState(current);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    const load = remoteHost ? sshReadDir(remoteHost, current) : readDir(current);
    void load
      .then((entries) => {
        if (cancelled) return;
        setEntries(entries);
      })
      .catch((error) => {
        if (cancelled) return;
        setEntries([]);
        setLoadError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [current, remoteHost]);

  const navigate = (path: string) => {
    const normalized = normalizeExplorerPath(path);
    if (!isExplorerPathWithin(normalized, normalizedRoot)) {
      toast({ title: "Choose a folder inside this Files workspace", variant: "info" });
      return;
    }
    setCurrent(normalized);
    setPathInput(normalized);
  };

  const directories = entries.filter((entry) => entry.is_dir);
  const validationError = explorerTransferError(request.source, current, normalizedRoot);
  const conflict = entries.some((entry) => entry.name === request.source.name);
  const actionLabel = request.operation === "copy" ? "Copy here" : "Move here";
  const canGoUp = current !== normalizedRoot && isExplorerPathWithin(parentExplorerPath(current), normalizedRoot);

  return (
    <Modal
      title={`${request.operation === "copy" ? "Copy" : "Move"} ${request.source.isDir ? "folder" : "file"}`}
      context={request.source.name}
      icon={request.operation === "copy" ? Copy01Icon : Move01Icon}
      onClose={onClose}
    >
      <div className="flex min-h-full flex-col gap-3 font-mono">
        <div>
          <div className="mb-1 text-[8px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">Destination</div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Go to parent folder"
              title="Parent folder"
              disabled={!canGoUp || busy}
              onClick={() => navigate(parentExplorerPath(current))}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded border border-border text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/[0.07] hover:text-primary disabled:pointer-events-none disabled:opacity-30"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={1.7} />
            </button>
            <input
              value={pathInput}
              disabled={busy}
              aria-label="Destination path"
              onChange={(event) => setPathInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  navigate(pathInput);
                }
              }}
              className="h-7 min-w-0 flex-1 rounded border border-border bg-background px-2 text-[10px] text-foreground outline-none transition-colors focus:border-primary/55"
            />
          </div>
          <div className="mt-1 truncate text-[8.5px] text-muted-foreground/60" title={normalizedRoot}>
            Files root · {normalizedRoot}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/75 bg-background/45">
          <div className="flex h-7 items-center border-b border-border/60 px-2 text-[8px] font-semibold uppercase tracking-[0.11em] text-muted-foreground/65">
            Folders
            <span className="ml-auto">{directories.length}</span>
          </div>
          <div className="max-h-[320px] overflow-y-auto p-1 [scrollbar-width:thin]">
            {loading ? (
              <div className="px-2 py-5 text-center text-[10px] text-muted-foreground">Loading folders…</div>
            ) : loadError ? (
              <div className="px-2 py-5 text-center text-[10px] text-red-400">Could not open this folder.</div>
            ) : directories.filter((entry) => showHidden || !entry.name.startsWith(".")).length === 0 ? (
              <div className="px-2 py-5 text-center text-[10px] text-muted-foreground">No folders here. You can use this destination.</div>
            ) : (
              directories
                .filter((entry) => showHidden || !entry.name.startsWith("."))
                .map((entry) => {
                  const invalid = request.source.isDir && isExplorerPathWithin(entry.path, request.source.path);
                  return (
                    <button
                      key={entry.path}
                      type="button"
                      disabled={invalid || busy}
                      onClick={() => navigate(entry.path)}
                      className="flex h-7 w-full min-w-0 items-center gap-2 rounded px-2 text-left text-[10.5px] text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35"
                      title={invalid ? "A folder cannot be placed inside itself" : entry.path}
                    >
                      <img src={folderIconUrl(entry.name, false)} className="size-3.5 shrink-0" alt="" />
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      <span className="text-muted-foreground/45">›</span>
                    </button>
                  );
                })
            )}
          </div>
        </div>

        <div className="border-t border-border/60 pt-2">
          <div className="mb-2 min-h-7 text-[9px] leading-relaxed text-muted-foreground">
            {conflict
              ? `“${request.source.name}” already exists here. Husk will not overwrite it.`
              : validationError ?? `${actionLabel} · ${joinExplorerPath(current, request.source.name)}`}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || loading || !!loadError || !!validationError || conflict}
              onClick={() => onConfirm(current)}
              className="h-7 flex-1 rounded border border-primary/45 bg-primary/12 text-[10px] text-primary transition-colors hover:bg-primary/20 disabled:pointer-events-none disabled:opacity-35"
            >
              {busy ? `${request.operation === "copy" ? "Copying" : "Moving"}…` : actionLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="h-7 rounded border border-border px-3 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-35"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Node({
  path,
  name,
  depth,
  isDir,
  onOpenFile,
  onMutated,
  initiallyOpen = false,
  headerless = false,
  filter,
  activeFile,
  remoteHost,
  gitMap = {},
  onRequestTransfer,
  onDragStartItem,
  onDropInto,
  onPathMoved,
  onPathDeleted,
}: {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  onOpenFile: (path: string, name: string) => void;
  /** Reload the parent dir after this node is renamed/deleted. Absent at root. */
  onMutated?: () => void;
  initiallyOpen?: boolean;
  /** Root mode: render children flat (no own folder row), so the workspace name
   *  lives in the explorer header instead of a repeated root node. */
  headerless?: boolean;
  /** Name filter applied to root children (explorer header search). */
  filter?: string;
  activeFile?: string | null;
  remoteHost?: string | null;
  gitMap?: Record<string, string>;
  onRequestTransfer: (source: ExplorerPathItem, operation: ExplorerTransferOperation) => void;
  onDragStartItem: (event: DragEvent, source: ExplorerPathItem) => void;
  onDropInto: (event: DragEvent, destinationDirectory: string) => void;
  onPathMoved: (from: string, to: string) => void;
  onPathDeleted: (path: string) => void;
}) {
  const showHidden = usePrefs().showHidden;
  const [open, setOpen] = useState(initiallyOpen);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState<null | "file" | "dir">(null);
  const [renaming, setRenaming] = useState(false);
  const [dropTarget, setDropTarget] = useState(false);

  // Subscribe to dirty-state changes so file indicators re-render
  const [, setDirtyTick] = useState(0);
  useEffect(() => {
    if (isDir) return;
    return subscribeDirty(() => setDirtyTick((t) => t + 1));
  }, [isDir]);

  const loadChildren = useCallback(() => {
    if (remoteHost) {
      void sshReadDir(remoteHost, path)
        .then(setChildren)
        .catch((err) => {
          toast({ title: String(err), variant: "error" });
          setChildren([]);
        });
    } else {
      void readDir(path)
        .then(setChildren)
        .catch(() => setChildren([]));
    }
  }, [path, remoteHost]);

  useEffect(() => {
    if (isDir && open && children === null) loadChildren();
  }, [isDir, open, children, loadChildren]);

  const reload = useCallback(() => {
    if (isDir) loadChildren();
  }, [isDir, loadChildren]);

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    // Clamp menu position to viewport so it never renders off-screen
    const MENU_W = 168;
    const MENU_H = 292; // enough room for copy/move and existing actions
    const x = Math.min(e.clientX, window.innerWidth - MENU_W - 8);
    const y = Math.min(e.clientY, window.innerHeight - MENU_H - 8);
    setMenu({ x: Math.max(8, x), y: Math.max(8, y) });
  };

  const startCreate = (kind: "file" | "dir") => {
    setMenu(null);
    setOpen(true);
    if (children === null) loadChildren();
    setCreating(kind);
  };

  const doCreate = async (raw: string) => {
    const kind = creating;
    setCreating(null);
    const value = raw.trim();
    if (!value || !kind) return;
    const target = joinPath(path, value);
    try {
      if (remoteHost) {
        if (kind === "dir") {
          await sshCreateDir(remoteHost, target);
        } else {
          await sshCreateFile(remoteHost, target);
          onOpenFile(target, value);
        }
      } else {
        if (kind === "dir") {
          await createDir(target);
        } else {
          await createFile(target);
          onOpenFile(target, value);
        }
      }
      loadChildren();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    }
  };

  const doRename = async (raw: string) => {
    setRenaming(false);
    const value = raw.trim();
    if (!value || value === name) return;
    try {
      const destination = joinPath(parentOf(path), value);
      const unsaved = getUnsavedPathWithin(path);
      if (unsaved) {
        toast({ title: "Save your changes first", message: `${unsaved.split("/").pop() || unsaved} has unsaved changes.`, variant: "info" });
        return;
      }
      if (remoteHost) {
        await sshRenamePath(remoteHost, path, destination);
      } else {
        await renamePath(path, destination);
      }
      onPathMoved(path, destination);
      onMutated?.();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    }
  };

  const doDelete = async () => {
    setMenu(null);
    const ok = await ask(
      `Delete "${name}"?${isDir ? " This removes the folder and all of its contents." : ""}`,
      { title: "Delete", kind: "warning" },
    );
    if (!ok) return;
    try {
      const unsaved = getUnsavedPathWithin(path);
      if (unsaved) {
        toast({ title: "Save your changes first", message: `${unsaved.split("/").pop() || unsaved} has unsaved changes.`, variant: "info" });
        return;
      }
      if (remoteHost) {
        await sshDeletePath(remoteHost, path);
      } else {
        await deletePath(path);
      }
      onPathDeleted(path);
      onMutated?.();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    }
  };

  const copyPath = async () => {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: "Path copied", variant: "success" });
    } catch {
      /* ignore */
    }
  };
  const revealInFinder = () => {
    setMenu(null);
    void revealItemInDir(path).catch(() => {});
  };
  const openInTerminal = () => {
    setMenu(null);
    runInActiveTerminal(`cd ${shq(path)}`);
  };

  const indent = { paddingLeft: 6 + depth * 12 };

  const transferItems = onMutated
    ? [
        { label: "Copy to…", onClick: () => { setMenu(null); onRequestTransfer({ path, name, isDir }, "copy"); } },
        { label: "Move to…", onClick: () => { setMenu(null); onRequestTransfer({ path, name, isDir }, "move"); } },
      ]
    : [];

  const mutateItems = onMutated
    ? [
        { label: "Rename", onClick: () => { setMenu(null); setRenaming(true); } },
        { label: "Delete", onClick: doDelete },
      ]
    : [];

  const isActive = activeFile === path;
  const dirtyState = !isDir ? getFileState(path) : "clean";
  const dirtyClass = dirtyState !== "clean" ? ` efile-${dirtyState}` : "";
  const gitBadge = !isDir && gitMap[path];

  if (!isDir) {
    return (
      <>
        {renaming ? (
          <EditRow depth={depth} initial={name} icon={fileIconUrl(name)} onSubmit={doRename} onCancel={() => setRenaming(false)} />
        ) : (
          <button
            type="button"
            draggable
            className={`enode efile${isActive ? " active" : ""}${dirtyClass}`}
            style={indent}
            onClick={() => onOpenFile(path, name)}
            onContextMenu={openMenu}
            onDragStart={(event) => onDragStartItem(event, { path, name, isDir: false })}
            title="Open in editor"
          >
            <span className="enode-caret" />
            <img src={fileIconUrl(name)} className="enode-img" alt="" />
            <span className="truncate">{name}</span>
            {gitBadge ? <span className="enode-git" title={`Git: ${gitBadge}`}>{gitBadge}</span> : null}
            {dirtyState === "modified" && <span className="enode-dot" title="Modified" />}
            {dirtyState === "new" && <span className="enode-dot enode-dot-new" title="New" />}
            {dirtyState === "deleted" && <span className="enode-dot enode-dot-del" title="Deleted" />}
          </button>
        )}
        {menu ? (
          <ContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            items={[
              { label: "Open", onClick: () => { setMenu(null); onOpenFile(path, name); } },
              ...transferItems,
              ...mutateItems.slice(0, 1),
              { label: "Copy path", onClick: copyPath },
              ...(!remoteHost ? [{ label: REVEAL_LABEL, onClick: revealInFinder }] : []),
              ...mutateItems.slice(1),
            ]}
          />
        ) : null}
      </>
    );
  }

  if (headerless) {
    return (
      <>
        {children
          ? children
              .filter(
                (c) =>
                  (showHidden || !c.name.startsWith(".")) &&
                  (!filter || c.name.toLowerCase().includes(filter.toLowerCase())),
              )
              .map((c) => (
                <Node
                    key={c.path}
                    path={c.path}
                    name={c.name}
                    depth={0}
                    isDir={c.is_dir}
                    onOpenFile={onOpenFile}
                    onMutated={reload}
                    activeFile={activeFile}
                    remoteHost={remoteHost}
                    gitMap={gitMap}
                    onRequestTransfer={onRequestTransfer}
                    onDragStartItem={onDragStartItem}
                    onDropInto={onDropInto}
                    onPathMoved={onPathMoved}
                    onPathDeleted={onPathDeleted}
                  />
              ))
          : null}
      </>
    );
  }

  return (
    <div>
      {renaming ? (
        <EditRow depth={depth} initial={name} icon={folderIconUrl(name, open)} onSubmit={doRename} onCancel={() => setRenaming(false)} />
      ) : (
        <button
          type="button"
          draggable
          className={`enode edir${dropTarget ? " is-drop-target" : ""}`}
          style={indent}
          onClick={() => setOpen((o) => !o)}
          onContextMenu={openMenu}
          onDragStart={(event) => onDragStartItem(event, { path, name, isDir: true })}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("application/x-husk-files-item")) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            setDropTarget(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as globalThis.Node | null)) setDropTarget(false);
          }}
          onDrop={(event) => {
            setDropTarget(false);
            onDropInto(event, path);
          }}
          onDragEnd={() => setDropTarget(false)}
        >
          <span className="enode-caret">{open ? "▾" : "▸"}</span>
          <img src={folderIconUrl(name, open)} className="enode-img" alt="" />
          {name}
        </button>
      )}
      {open ? (
        <>
          {creating ? (
            <EditRow depth={depth + 1} placeholder={creating === "dir" ? "New folder name" : "New file name"} onSubmit={doCreate} onCancel={() => setCreating(null)} />
          ) : null}
          {children
            ? children
                .filter((c) => showHidden || !c.name.startsWith("."))
                .map((c) => (
                  <Node
                    key={c.path}
                    path={c.path}
                    name={c.name}
                    depth={depth + 1}
                    isDir={c.is_dir}
                    onOpenFile={onOpenFile}
                    onMutated={reload}
                    activeFile={activeFile}
                    remoteHost={remoteHost}
                    gitMap={gitMap}
                    onRequestTransfer={onRequestTransfer}
                    onDragStartItem={onDragStartItem}
                    onDropInto={onDropInto}
                    onPathMoved={onPathMoved}
                    onPathDeleted={onPathDeleted}
                  />
                ))
            : null}
        </>
      ) : null}
      {menu ? (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: "New File", onClick: () => startCreate("file") },
            { label: "New Folder", onClick: () => startCreate("dir") },
            { label: "Open in terminal", onClick: openInTerminal },
            ...transferItems,
            ...mutateItems.slice(0, 1),
            { label: "Copy path", onClick: copyPath },
            ...(!remoteHost ? [{ label: REVEAL_LABEL, onClick: revealInFinder }] : []),
            ...mutateItems.slice(1),
          ]}
        />
      ) : null}
    </div>
  );
}

/** Inline input row used for both "new file/folder" and "rename". */
function EditRow({
  depth,
  initial = "",
  placeholder,
  icon,
  onSubmit,
  onCancel,
}: {
  depth: number;
  initial?: string;
  placeholder?: string;
  icon?: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div className="enode enode-edit" style={{ paddingLeft: 6 + depth * 12 }}>
      <span className="enode-caret" />
      {icon ? <img src={icon} className="enode-img" alt="" /> : null}
      <input
        autoFocus
        className="enode-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
    </div>
  );
}

function ContextMenu({
  menu,
  onClose,
  items,
}: {
  menu: { x: number; y: number };
  onClose: () => void;
  items: { label: string; onClick: () => void }[];
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div
        className="ectx-backdrop"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div className="ectx-menu" style={{ top: menu.y, left: menu.x }} role="menu">
        {items.map((it) => (
          <button key={it.label} type="button" className="ectx-item" role="menuitem" onClick={it.onClick}>
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
