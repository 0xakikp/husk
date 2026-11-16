import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  readDir,
  homeDir,
  createFile,
  createDir,
  copyPath as copyLocalPath,
  renamePath,
  trashPath,
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
} from "../remote/remoteFs";
import { fileIconUrl, folderIconUrl } from "./iconResolver";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, Copy01Icon, FileAddIcon, FolderAddIcon, Refresh01Icon, Search01Icon, MoreHorizontalIcon, GlobalIcon, FolderTreeIcon, Move01Icon } from "@hugeicons/core-free-icons";
import { PanelHeader } from "../shell/PanelHeader";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuItem, DropdownMenuCheckboxItem, DropdownMenuRadioGroup, DropdownMenuRadioItem } from "../components/ui/dropdown-menu";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspaceRoot } from "../workspace/store";
import { useActiveTerminalCwd, useActiveRemoteTerminal, getActiveRemoteTerminal, runInActiveTerminalResult } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";
import { usePrefs, setPrefs } from "../settings/preferences";
import { toast } from "../toast";
import { getFileState, getUnsavedPathWithin, subscribeDirty } from "../editor/dirtyStore";
import { setActiveSshHost } from "../remote/store";
import { repositorySnapshot } from "../git/client";
import { watchFileChanges, watchRepositoryChanges } from "../editor/fileChanges";
import { FilesSearch } from "./FilesSearch";
import { displayEntryName, entryNameError } from "./entryNames";
import "./FileExplorer.css";
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
  scope: string;
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
  onOpenFileAtLine,
  activeFile,
  remoteHost,
  active = true,
}: {
  onOpenFile: (path: string, name: string) => void;
  onOpenFileAtLine?: (path: string, name: string, line: number) => void;
  activeFile?: string | null;
  remoteHost?: string | null;
  active?: boolean;
}) {
  const wsRoot = useWorkspaceRoot();
  const termCwd = useActiveTerminalCwd();
  const [home, setHome] = useState<string | null>(null);
  const activeRemote = useActiveRemoteTerminal();
  const showHidden = usePrefs().showHidden;
  const localTerminalCwd = activeRemote.isRemote ? "" : termCwd;
  const [followTerminal, setFollowTerminal] = useState(false);
  const [remoteLocation, setRemoteLocation] = useState<{ host: string; path: string | null; error: string | null } | null>(null);
  const [homeError, setHomeError] = useState<string | null>(null);
  const [rootRetry, setRootRetry] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [collapseKey, setCollapseKey] = useState(0);
  const [revealKey, setRevealKey] = useState(0);
  const [rootCreate, setRootCreate] = useState<null | "file" | "dir">(null);
  const [filterOpen, setFilterOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const revealingFromOptions = useRef(false);
  const [gitMap, setGitMap] = useState<Record<string, string>>({});
  const [transferRequest, setTransferRequest] = useState<ExplorerTransferRequest | null>(null);
  const [transferBusy, setTransferBusy] = useState(false);
  const transferLock = useRef(false);
  const rootCreateLock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const root = remoteHost ? (remoteLocation?.host === remoteHost ? remoteLocation.path : null)
    : followTerminal ? (localTerminalCwd || wsRoot || home) : (wsRoot || localTerminalCwd || home);
  const scope = JSON.stringify([remoteHost ?? null, root]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const isCurrentScope = useCallback(() => alive.current && currentScope.current === scope, [scope]);
  const rootError = remoteHost ? (remoteLocation?.host === remoteHost ? remoteLocation.error : null) : homeError;

  useEffect(() => { setRootCreate(null); setTransferRequest(null); setFilterOpen(false); setOptionsOpen(false); setRevealKey(0); }, [scope]);
  useEffect(() => { if (!active) setOptionsOpen(false); }, [active]);
  const onRevealed = useCallback(() => setRevealKey(0), []);

  // Fetch git status for workspace
  useEffect(() => {
    if (remoteHost || !root || !active) { setGitMap({}); return; }
    let cancelled = false;
    let reading = false;
    const load = async () => {
      if (reading || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const snapshot = await repositorySnapshot(root);
        const map: Record<string, string> = {};
        for (const f of snapshot?.files ?? []) {
          const abs = joinPath(snapshot!.repoRoot, f.path);
          // work tree status takes priority over index status
          map[abs] = f.work !== " " ? f.work : f.index;
        }
        if (!cancelled) setGitMap(map);
      } catch {
        if (!cancelled) setGitMap({});
      } finally { reading = false; }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [root, remoteHost, active, refreshKey]);

  useEffect(() => {
    if (localTerminalCwd || wsRoot || home || remoteHost) return;
    let cancelled = false;
    setHomeError(null);
    void homeDir().then((path) => { if (!cancelled) setHome(path); }).catch((cause) => { if (!cancelled) setHomeError(String(cause)); });
    return () => { cancelled = true; };
  }, [localTerminalCwd, wsRoot, home, remoteHost, rootRetry]);

  useEffect(() => {
    if (!remoteHost) { setRemoteLocation(null); return; }
    let cancelled = false;
    setRemoteLocation({ host: remoteHost, path: null, error: null });
    void sshHomeDir(remoteHost).then((path) => {
      if (!path.startsWith("/")) throw new Error("The remote host did not return an absolute home folder.");
      if (!cancelled) setRemoteLocation({ host: remoteHost, path, error: null });
    }).catch((cause) => { if (!cancelled) setRemoteLocation({ host: remoteHost, path: null, error: String(cause) }); });
    return () => { cancelled = true; };
  }, [remoteHost, rootRetry]);

  useEffect(() => {
    if (!root || !active) return;
    let timer: number | undefined;
    const refresh = () => { window.clearTimeout(timer); timer = window.setTimeout(() => setRefreshKey((key) => key + 1), 100); };
    const relevant = (path: string) => {
      if (!remoteHost && (isExplorerPathWithin(path, root) || isExplorerPathWithin(root, path))) refresh();
    };
    const stopFiles = watchFileChanges(relevant);
    const stopRepositories = watchRepositoryChanges(relevant);
    window.addEventListener("focus", refresh);
    return () => { window.clearTimeout(timer); stopFiles(); stopRepositories(); window.removeEventListener("focus", refresh); };
  }, [root, remoteHost, active]);

  const performTransfer = useCallback(async (
    request: ExplorerTransferRequest,
    destinationDirectory: string,
  ): Promise<boolean> => {
    if (!root || transferLock.current || request.scope !== scope) return false;
    const source = request.source;
    if (!source || typeof source.path !== "string" || typeof source.name !== "string" || typeof source.isDir !== "boolean"
      || entryNameError(source.name) || source.path.split("/").includes("..") || destinationDirectory.split("/").includes("..")
      || source.path.split("/").pop() !== source.name) {
      toast({ title: "Invalid Files transfer", message: "Choose a file or folder directly from this tree.", variant: "error" });
      return false;
    }
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
    transferLock.current = true; setTransferBusy(true);
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
      if (isCurrentScope()) { setTransferRequest(null); setRefreshKey((key) => key + 1); }
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
      transferLock.current = false; setTransferBusy(false);
    }
  }, [remoteHost, root, scope, isCurrentScope]);

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
      void performTransfer({ source: payload.source, operation: "move", scope }, destinationDirectory);
    } catch {
      toast({ title: "Could not read the dragged file", variant: "error" });
    }
  }, [performTransfer, remoteHost, scope]);

  if (!root) return <div className="files-tree-message" role={rootError ? "alert" : "status"}>
    {rootError ? <><span>Could not open Files: {rootError}</span><button type="button" onClick={() => setRootRetry((value) => value + 1)}>Retry</button></> : "Loading Files…"}
  </div>;

  const folderName = root.split("/").filter(Boolean).pop() ?? root;
  const name = remoteHost ?? folderName;
  const locationLabel = remoteHost ? "SSH" : followTerminal ? "Terminal" : wsRoot && root === wsRoot ? "Workspace" : "Local";
  const locationName = remoteHost
    ? folderName === "/" || remoteHost === folderName ? remoteHost : `${remoteHost} / ${folderName}`
    : folderName;
  const fullLocation = remoteHost ? `${remoteHost}:${root}` : root;
  const locationHint = remoteHost ? "SSH folder" : followTerminal ? "Following local terminal" : "Local folder";

  const doRootCreate = async (raw: string) => {
    if (rootCreateLock.current || !isCurrentScope()) return;
    const kind = rootCreate;
    setRootCreate(null);
    const value = raw;
    if (!value || !kind) return;
    const invalid = entryNameError(value);
    if (invalid) { toast({ title: invalid, variant: "error" }); return; }
    const target = joinPath(root, value);
    rootCreateLock.current = true;
    try {
      if (remoteHost) {
        if (kind === "dir") {
          await sshCreateDir(remoteHost, target);
        } else {
          await sshCreateFile(remoteHost, target);
          if (isCurrentScope()) onOpenFile(target, value);
        }
      } else {
        if (kind === "dir") {
          await createDir(target);
        } else {
          await createFile(target);
          if (isCurrentScope()) onOpenFile(target, value);
        }
      }
      if (isCurrentScope()) setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    } finally { rootCreateLock.current = false; }
  };

  return (
    <div className="explorer">
      {/* Banded-chip header (PanelHeader): rail glyph + actions. Location is below. */}
      <PanelHeader
        icon={remoteHost ? GlobalIcon : FolderTreeIcon}
        title="Files"
        actions={
          <>
            {!remoteHost && (
              <ExBtn icon={Search01Icon} label={filterOpen ? "Close search and clear query" : "Search files and contents"} onClick={() => setFilterOpen((v) => !v)} />
            )}
            <ExBtn icon={FileAddIcon} label="New file" onClick={() => setRootCreate("file")} />
            <ExBtn icon={FolderAddIcon} label="New folder" onClick={() => setRootCreate("dir")} />
            <ExBtn icon={Refresh01Icon} label="Refresh" onClick={() => setRefreshKey((k) => k + 1)} />
          </>
        }
      />
      <div className="files-scope">
        <span className="files-scope-kind">{locationLabel}</span>
        <span className="files-scope-name" title={displayEntryName(`${locationHint}: ${fullLocation}`)}>{displayEntryName(locationName)}</span>
        <DropdownMenu open={optionsOpen && active} onOpenChange={setOptionsOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <button type="button" className="files-options-trigger" aria-label="Files options" title="Files options">
              <HugeiconsIcon icon={MoreHorizontalIcon} size={14} strokeWidth={1.5} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="husk-context-menu files-options-menu" onCloseAutoFocus={(event) => {
            if (revealingFromOptions.current) { event.preventDefault(); revealingFromOptions.current = false; }
          }}>
            <DropdownMenuLabel className="files-options-location">
              <span>Current folder</span>
              <code>{displayEntryName(fullLocation)}</code>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="husk-context-menu-separator" />
            {!remoteHost && <>
              <DropdownMenuLabel className="husk-context-menu-label">Browse from</DropdownMenuLabel>
              <DropdownMenuRadioGroup aria-label="Files root mode" value={followTerminal ? "terminal" : "workspace"} onValueChange={(value) => setFollowTerminal(value === "terminal")}>
                <DropdownMenuRadioItem className="husk-context-menu-item" value="workspace">{wsRoot ? "Workspace folder" : "Current local folder"}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem className="husk-context-menu-item" value="terminal">Follow local terminal</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator className="husk-context-menu-separator" />
            </>}
            <DropdownMenuCheckboxItem className="husk-context-menu-item" checked={showHidden} onCheckedChange={(checked) => setPrefs({ showHidden: checked })}>Show hidden files</DropdownMenuCheckboxItem>
            <DropdownMenuSeparator className="husk-context-menu-separator" />
            <DropdownMenuItem className="husk-context-menu-item" onSelect={() => setCollapseKey((value) => value + 1)}>Collapse all</DropdownMenuItem>
            <DropdownMenuItem className="husk-context-menu-item" disabled={!activeFile || !isExplorerPathWithin(activeFile, root)} onSelect={() => {
              revealingFromOptions.current = true;
              setFilterOpen(false);
              if (activeFile?.split("/").some((part) => part.startsWith("."))) setPrefs({ showHidden: true });
              setRevealKey((value) => value + 1);
            }}>Reveal active file</DropdownMenuItem>
            {remoteHost && <>
              <DropdownMenuSeparator className="husk-context-menu-separator" />
              <DropdownMenuItem className="husk-context-menu-item" onSelect={() => setRootRetry((value) => value + 1)}>Reload remote home folder</DropdownMenuItem>
              <DropdownMenuItem className="husk-context-menu-item" onSelect={() => setActiveSshHost(null)}>Disconnect</DropdownMenuItem>
              <p className="files-options-note">Remote browsing · recursive search is local only</p>
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filterOpen && !remoteHost && <FilesSearch key={scope} root={root} includeHidden={showHidden} refreshKey={refreshKey} active={active}
        onClose={() => setFilterOpen(false)} onOpenFile={onOpenFile} onOpenFileAtLine={onOpenFileAtLine} />}
      {rootCreate ? (
        <EditRow
          depth={0}
          placeholder={rootCreate === "dir" ? "New folder name" : "New file name"}
          onSubmit={doRootCreate}
          onCancel={() => setRootCreate(null)}
        />
      ) : null}
      <div className="files-tree" role="tree" aria-label={`Files in ${root}`} style={filterOpen ? { display: "none" } : undefined}
        onFocusCapture={(event) => {
          const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-explorer-node]") : null;
          if (target) for (const button of event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-explorer-node]")) button.tabIndex = button === target ? 0 : -1;
        }}
        onKeyDown={(event) => {
          const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("[data-explorer-node]") : null;
          if (!target || !["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return;
          const rows = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-explorer-node]")];
          const index = rows.indexOf(target);
          const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
          event.preventDefault(); rows[next]?.focus({ preventScroll: true }); rows[next]?.scrollIntoView?.({ block: "nearest" });
        }}>
      <Node
        key={scope}
        path={root}
        name={name}
        depth={0}
        isDir
        headerless
        refreshKey={refreshKey}
        collapseKey={collapseKey}
        revealKey={revealKey}
        onRevealed={onRevealed}
        isCurrentScope={isCurrentScope}
        onOpenFile={onOpenFile}
        activeFile={activeFile}
        initiallyOpen
        remoteHost={remoteHost}
        gitMap={gitMap}
        onRequestTransfer={(source, operation) => setTransferRequest({ source, operation, scope })}
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
      </div>
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
  refreshKey,
  collapseKey,
  revealKey,
  onRevealed,
  isCurrentScope,
  isSymlink = false,
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
  refreshKey: number;
  collapseKey: number;
  revealKey: number;
  onRevealed: () => void;
  isCurrentScope: () => boolean;
  isSymlink?: boolean;
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
  const mutationLock = useRef(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const alive = useRef(true);
  const row = useRef<HTMLButtonElement>(null);
  const childGroup = useRef<HTMLDivElement>(null);
  const lastCollapse = useRef(collapseKey);
  useEffect(() => { alive.current = true; return () => { alive.current = false; requestVersion.current++; }; }, []);

  // Subscribe to dirty-state changes so file indicators re-render
  const [, setDirtyTick] = useState(0);
  useEffect(() => {
    if (isDir) return;
    return subscribeDirty(() => setDirtyTick((t) => t + 1));
  }, [isDir]);

  const loadChildren = useCallback(() => {
    const version = ++requestVersion.current;
    setLoading(true); setLoadError(null);
    const current = () => alive.current && requestVersion.current === version && isCurrentScope();
    void (remoteHost ? sshReadDir(remoteHost, path) : readDir(path))
      .then((entries) => { if (current()) setChildren(entries); })
      .catch((cause: unknown) => { if (current()) setLoadError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current()) setLoading(false); });
  }, [path, remoteHost, isCurrentScope]);

  useEffect(() => {
    if (isDir && open) loadChildren();
  }, [isDir, open, refreshKey, loadChildren]);

  useEffect(() => {
    if (lastCollapse.current !== collapseKey) {
      lastCollapse.current = collapseKey;
      if (!headerless) setOpen(false);
    }
  }, [collapseKey, headerless]);
  useEffect(() => {
    // Newly loaded descendants also participate in an in-progress reveal.
    if (!revealKey || !activeFile || !isExplorerPathWithin(activeFile, path)) return;
    if (isDir) setOpen(true);
    else if (row.current) {
      row.current?.focus({ preventScroll: true }); row.current?.scrollIntoView?.({ block: "nearest" });
      onRevealed();
    }
  }, [revealKey, activeFile, path, isDir, onRevealed]);

  const reload = useCallback(() => {
    if (isDir) loadChildren();
  }, [isDir, loadChildren]);

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    row.current?.focus({ preventScroll: true });
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
    if (mutationLock.current) return;
    const kind = creating;
    setCreating(null);
    const value = raw;
    if (!value || !kind) return;
    const invalid = entryNameError(value);
    if (invalid) { toast({ title: invalid, variant: "error" }); return; }
    if (!isCurrentScope()) return;
    const target = joinPath(path, value);
    mutationLock.current = true;
    try {
      if (remoteHost) {
        if (kind === "dir") {
          await sshCreateDir(remoteHost, target);
        } else {
          await sshCreateFile(remoteHost, target);
          if (alive.current && isCurrentScope()) onOpenFile(target, value);
        }
      } else {
        if (kind === "dir") {
          await createDir(target);
        } else {
          await createFile(target);
          if (alive.current && isCurrentScope()) onOpenFile(target, value);
        }
      }
      if (alive.current && isCurrentScope()) loadChildren();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    } finally { mutationLock.current = false; }
  };

  const doRename = async (raw: string) => {
    if (mutationLock.current) return;
    setRenaming(false);
    const value = raw;
    if (!value || value === name) return;
    const invalid = entryNameError(value);
    if (invalid) { toast({ title: invalid, variant: "error" }); return; }
    if (!isCurrentScope()) return;
    mutationLock.current = true;
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
      if (alive.current && isCurrentScope()) onMutated?.();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    } finally { mutationLock.current = false; }
  };

  const doDelete = async () => {
    if (mutationLock.current) return;
    mutationLock.current = true;
    setMenu(null);
    try {
      const ok = await ask(
        remoteHost
          ? `Permanently delete "${displayEntryName(name)}" on ${remoteHost}?\n${displayEntryName(path)}\n${isDir ? "The folder and all its contents will be removed. " : ""}This does not use Trash and cannot be undone in Husk.`
          : `Move "${displayEntryName(name)}" to Trash?\n${displayEntryName(path)}\nYou can restore it using your system Trash.`,
        { title: remoteHost ? "Delete permanently" : "Move to Trash", kind: "warning" },
      );
      if (!ok || !isCurrentScope()) return;
      const unsaved = getUnsavedPathWithin(path);
      if (unsaved) {
        toast({ title: "Save your changes first", message: `${unsaved.split("/").pop() || unsaved} has unsaved changes.`, variant: "info" });
        return;
      }
      if (remoteHost) {
        await sshDeletePath(remoteHost, path);
      } else {
        await trashPath(path);
      }
      onPathDeleted(path);
      if (alive.current && isCurrentScope()) onMutated?.();
      toast({ title: remoteHost ? "Permanently deleted" : "Moved to Trash", message: path, variant: "success" });
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    } finally { mutationLock.current = false; }
  };

  const copyPath = async () => {
    setMenu(null);
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: "Path copied", variant: "success" });
    } catch (cause) {
      toast({ title: "Could not copy path", message: String(cause), variant: "error" });
    }
  };
  const revealInFinder = () => {
    setMenu(null);
    void revealItemInDir(path).catch((cause) => toast({ title: "Could not reveal this item", message: String(cause), variant: "error" }));
  };
  const openInTerminal = () => {
    setMenu(null);
    if (!isCurrentScope()) return;
    if (/[\u0000-\u001f\u007f]/.test(path)) {
      toast({ title: "This path contains terminal control characters", message: "Open this folder in the file manager instead.", variant: "info" });
      return;
    }
    const terminal = getActiveRemoteTerminal();
    if (remoteHost ? (!terminal.isRemote || terminal.host !== remoteHost) : terminal.isRemote) {
      toast({ title: "Select a matching terminal first", message: remoteHost ? `This folder belongs to ${remoteHost}.` : "This is a local folder; the active terminal is remote.", variant: "info" });
      return;
    }
    const result = runInActiveTerminalResult(`cd ${shq(path)}`);
    if (!result.ok) toast({ title: "Could not change terminal folder", message: result.message || "Select an idle matching terminal with an empty prompt, then try again.", variant: "info" });
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
        { label: remoteHost ? "Delete permanently…" : "Move to Trash…", onClick: doDelete },
      ]
    : [];

  const isActive = activeFile === path;
  const dirtyState = !isDir ? getFileState(path) : "clean";
  const dirtyClass = dirtyState !== "clean" ? ` efile-${dirtyState}` : "";
  const gitBadge = !isDir && gitMap[path];
  const keyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "F2" && onMutated) { event.preventDefault(); setRenaming(true); }
    else if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      setMenu({ x: Math.max(8, Math.min(bounds.left + 20, window.innerWidth - 180)), y: Math.max(8, Math.min(bounds.bottom, window.innerHeight - 310)) });
    } else if (event.key === "ArrowRight" && isDir) {
      event.preventDefault();
      if (!open) setOpen(true);
      else childGroup.current?.querySelector<HTMLButtonElement>("[data-explorer-node]")?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (isDir && open) setOpen(false);
      else [...(event.currentTarget.closest(".files-tree")?.querySelectorAll<HTMLButtonElement>("[data-explorer-node]") ?? [])]
        .find((button) => button.dataset.explorerNode === parentOf(path))?.focus();
    }
  };

  const visibleChildren = children?.filter((child) => showHidden || !child.name.startsWith("."));
  const childContent = <>
    {loadError ? <div className="files-tree-message" role="alert"><span>Could not {children ? "refresh" : "open"} {name}: {loadError}</span><button type="button" onClick={loadChildren}>Retry folder</button></div>
      : loading || children === null ? <div className="files-tree-message" role="status">{children ? "Refreshing…" : "Loading folder…"}</div>
      : visibleChildren?.length === 0 ? <div className="files-tree-message">{children.length > 0 ? "Only hidden files here. Enable Hidden files to show them." : "This folder is empty."}</div> : null}
    {visibleChildren?.map((child) => <Node key={child.path} path={child.path} name={child.name}
      depth={headerless ? 0 : depth + 1} isDir={child.is_dir} isSymlink={child.is_symlink}
      refreshKey={refreshKey} collapseKey={collapseKey} revealKey={revealKey} onRevealed={onRevealed} isCurrentScope={isCurrentScope}
      onOpenFile={onOpenFile} onMutated={reload} activeFile={activeFile} remoteHost={remoteHost} gitMap={gitMap}
      onRequestTransfer={onRequestTransfer} onDragStartItem={onDragStartItem} onDropInto={onDropInto}
      onPathMoved={onPathMoved} onPathDeleted={onPathDeleted} />)}
  </>;

  if (!isDir) {
    return (
      <>
        {renaming ? (
          <EditRow depth={depth} initial={name} icon={fileIconUrl(name)} onSubmit={doRename} onCancel={() => setRenaming(false)} />
        ) : (
          <button
            ref={row}
            type="button"
            data-explorer-node={path}
            role="treeitem"
            aria-level={depth + 1}
            aria-selected={isActive}
            tabIndex={depth === 0 ? 0 : -1}
            onKeyDown={keyboard}
            draggable
            className={`enode efile${isActive ? " active" : ""}${dirtyClass}`}
            style={indent}
            onClick={() => onOpenFile(path, name)}
            onContextMenu={openMenu}
            onDragStart={(event) => onDragStartItem(event, { path, name, isDir: false })}
            title={`${displayEntryName(path)}${isSymlink ? " · Symbolic link" : ""}`}
          >
            <span className="enode-caret" />
            <img src={fileIconUrl(name)} className="enode-img" alt="" />
            <span className="files-entry-name">{displayEntryName(name)}</span>
            {isSymlink && <span title="Symbolic link" aria-label="Symbolic link">↗</span>}
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
    return childContent;
  }

  return (
    <div>
      {renaming ? (
        <EditRow depth={depth} initial={name} icon={folderIconUrl(name, open)} onSubmit={doRename} onCancel={() => setRenaming(false)} />
      ) : (
        <button
          ref={row}
          type="button"
          data-explorer-node={path}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={open}
          tabIndex={depth === 0 ? 0 : -1}
          onKeyDown={keyboard}
          title={`${displayEntryName(path)}${isSymlink ? " · Symbolic link" : ""}`}
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
          <span className="files-entry-name">{displayEntryName(name)}</span>
          {isSymlink && <span title="Symbolic link" aria-label="Symbolic link">↗</span>}
        </button>
      )}
      {open ? (
        <div ref={childGroup} role="group">
          {creating ? (
            <EditRow depth={depth + 1} placeholder={creating === "dir" ? "New folder name" : "New file name"} onSubmit={doCreate} onCancel={() => setCreating(null)} />
          ) : null}
          {childContent}
        </div>
      ) : null}
      {menu ? (
        <ContextMenu
          menu={menu}
          onClose={() => setMenu(null)}
          items={[
            { label: "New File", onClick: () => startCreate("file") },
            { label: "New Folder", onClick: () => startCreate("dir") },
            { label: "Use folder in active terminal", onClick: openInTerminal },
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
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="enode enode-edit" style={{ paddingLeft: 6 + depth * 12 }}>
      <span className="enode-caret" />
      {icon ? <img src={icon} className="enode-img" alt="" /> : null}
      <input
        autoFocus
        className="enode-input"
        placeholder={placeholder}
        aria-label={placeholder || "Rename item"}
        value={value}
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onFocus={(e) => e.currentTarget.select()}
        onBlur={onCancel}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || e.repeat) return;
          if (e.key === "Enter") {
            e.preventDefault();
            const invalid = entryNameError(value);
            if (invalid) setError(invalid);
            else onSubmit(value);
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
      />
      {error && <span className="files-name-error" role="alert">{error}</span>}
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
  const element = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const typeahead = useRef("");
  const typeaheadTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const menuElement = element.current;
    menuElement?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const onFocus = (event: FocusEvent) => { if (event.target instanceof globalThis.Node && !menuElement?.contains(event.target)) close.current(); };
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("focusin", onFocus); window.clearTimeout(typeaheadTimer.current);
      if (menuElement?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, []);

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
      <div className="ectx-menu files-context-menu" ref={element} style={{ top: menu.y, left: menu.x }} role="menu"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
          const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")];
          const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === "Escape" || event.key === "Tab") {
            if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); }
            close.current(); return;
          }
          let next: HTMLButtonElement | undefined;
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            const target = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
              : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
            next = buttons[target];
          } else if (event.key.length === 1 && event.key !== " ") {
            window.clearTimeout(typeaheadTimer.current);
            typeahead.current += event.key.toLocaleLowerCase();
            next = [...buttons.slice(index + 1), ...buttons.slice(0, index + 1)].find((button) => button.textContent?.toLocaleLowerCase().startsWith(typeahead.current));
            typeaheadTimer.current = window.setTimeout(() => { typeahead.current = ""; }, 500);
          }
          next?.focus({ preventScroll: true }); next?.scrollIntoView?.({ block: "nearest" });
        }}>
        {items.map((it) => (
          <button key={it.label} type="button" className="ectx-item" role="menuitem" onClick={it.onClick}
            onPointerMove={(event) => { if (event.pointerType !== "touch") event.currentTarget.focus({ preventScroll: true }); }}>
            {it.label}
          </button>
        ))}
      </div>
    </>,
    document.body
  );
}
