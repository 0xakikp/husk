import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";
import {
  readDir,
  homeDir,
  createFile,
  createDir,
  renamePath,
  deletePath,
  type DirEntry,
} from "../fs";
import {
  sshReadDir,
  sshCreateFile,
  sshCreateDir,
  sshRenamePath,
  sshDeletePath,
  sshHomeDir,
  sshPwd,
} from "../remote/remoteFs";
import { fileIconUrl, folderIconUrl } from "./iconResolver";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileAddIcon, FolderAddIcon, Refresh01Icon, Search01Icon, Cancel01Icon, GlobalIcon, Location01Icon } from "@hugeicons/core-free-icons";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useWorkspaceRoot } from "../workspace/store";
import { useActiveTerminalCwd, runInActiveTerminal } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { getFileState, subscribeDirty } from "../editor/dirtyStore";
import { setActiveSshHost } from "../remote/store";
import { status as gitStatus } from "../git/client";

import { IS_MAC, IS_WINDOWS } from "../lib/platform";

const REVEAL_LABEL = IS_MAC ? "Reveal in Finder" : IS_WINDOWS ? "Show in Explorer" : "Show in File Manager";

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

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
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.5} />
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
      {/* husk v1's explorer header: workspace name + new/refresh/collapse actions. */}
      <div className="flex h-8 items-center gap-1 px-2">
        <span className="flex flex-1 items-center gap-1.5 truncate text-xs font-medium text-primary" title={root}>
          {remoteHost ? (
            <HugeiconsIcon icon={GlobalIcon} size={14} strokeWidth={1.75} className="shrink-0 text-[var(--accent)]" />
          ) : (
            <img src={folderIconUrl(name, false)} alt="" width={15} height={15} className="shrink-0" />
          )}
          {name}
        </span>
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
      </div>
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
      />
    </div>
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
}) {
  const showHidden = usePrefs().showHidden;
  const [open, setOpen] = useState(initiallyOpen);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState<null | "file" | "dir">(null);
  const [renaming, setRenaming] = useState(false);

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
    const MENU_H = 220; // approximate max height
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
      if (remoteHost) {
        await sshRenamePath(remoteHost, path, joinPath(parentOf(path), value));
      } else {
        await renamePath(path, joinPath(parentOf(path), value));
      }
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
      if (remoteHost) {
        await sshDeletePath(remoteHost, path);
      } else {
        await deletePath(path);
      }
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
            className={`enode efile${isActive ? " active" : ""}${dirtyClass}`}
            style={indent}
            onClick={() => onOpenFile(path, name)}
            onContextMenu={openMenu}
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
              { label: "Copy path", onClick: copyPath },
              { label: REVEAL_LABEL, onClick: revealInFinder },
              ...mutateItems,
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
        <button type="button" className="enode edir" style={indent} onClick={() => setOpen((o) => !o)} onContextMenu={openMenu}>
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
                  <Node key={c.path} path={c.path} name={c.name} depth={depth + 1} isDir={c.is_dir} onOpenFile={onOpenFile} onMutated={reload} activeFile={activeFile} remoteHost={remoteHost} gitMap={gitMap} />
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
            { label: "Copy path", onClick: copyPath },
            { label: REVEAL_LABEL, onClick: revealInFinder },
            ...mutateItems,
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
