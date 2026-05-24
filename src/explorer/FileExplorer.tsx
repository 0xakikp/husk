import { useCallback, useEffect, useState, type MouseEvent } from "react";
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
import { fileIconUrl, folderIconUrl } from "./iconResolver";
import { useWorkspaceRoot } from "../workspace/store";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";

const joinPath = (dir: string, name: string) => `${dir.replace(/\/+$/, "")}/${name}`;
const parentOf = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

export function FileExplorer({
  onOpenFile,
}: {
  onOpenFile: (path: string, name: string) => void;
}) {
  const wsRoot = useWorkspaceRoot();
  const [home, setHome] = useState<string | null>(null);

  useEffect(() => {
    if (!wsRoot && !home) void homeDir().then(setHome);
  }, [wsRoot, home]);

  const root = wsRoot || home;
  if (!root) return <div className="explorer-loading">Loading…</div>;

  const name = root.split("/").filter(Boolean).pop() ?? root;
  return (
    <div className="explorer">
      <Node key={root} path={root} name={name} depth={0} isDir onOpenFile={onOpenFile} initiallyOpen />
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
}: {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  onOpenFile: (path: string, name: string) => void;
  /** Reload the parent dir after this node is renamed/deleted. Absent at root. */
  onMutated?: () => void;
  initiallyOpen?: boolean;
}) {
  const showHidden = usePrefs().showHidden;
  const [open, setOpen] = useState(initiallyOpen);
  const [children, setChildren] = useState<DirEntry[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState<null | "file" | "dir">(null);
  const [renaming, setRenaming] = useState(false);

  const loadChildren = useCallback(() => {
    void readDir(path)
      .then(setChildren)
      .catch(() => setChildren([]));
  }, [path]);

  useEffect(() => {
    if (isDir && open && children === null) loadChildren();
  }, [isDir, open, children, loadChildren]);

  const reload = useCallback(() => {
    if (isDir) loadChildren();
  }, [isDir, loadChildren]);

  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY });
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
      if (kind === "dir") {
        await createDir(target);
      } else {
        await createFile(target);
        onOpenFile(target, value);
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
      await renamePath(path, joinPath(parentOf(path), value));
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
      await deletePath(path);
      onMutated?.();
    } catch (err) {
      toast({ title: String(err), variant: "error" });
    }
  };

  const indent = { paddingLeft: 6 + depth * 12 };

  const mutateItems = onMutated
    ? [
        { label: "Rename", onClick: () => { setMenu(null); setRenaming(true); } },
        { label: "Delete", onClick: doDelete },
      ]
    : [];

  if (!isDir) {
    return (
      <>
        {renaming ? (
          <EditRow depth={depth} initial={name} icon={fileIconUrl(name)} onSubmit={doRename} onCancel={() => setRenaming(false)} />
        ) : (
          <button type="button" className="enode efile" style={indent} onClick={() => onOpenFile(path, name)} onContextMenu={openMenu}>
            <span className="enode-caret" />
            <img src={fileIconUrl(name)} className="enode-img" alt="" />
            {name}
          </button>
        )}
        {menu ? (
          <ContextMenu
            menu={menu}
            onClose={() => setMenu(null)}
            items={[{ label: "Open", onClick: () => { setMenu(null); onOpenFile(path, name); } }, ...mutateItems]}
          />
        ) : null}
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
                  <Node key={c.path} path={c.path} name={c.name} depth={depth + 1} isDir={c.is_dir} onOpenFile={onOpenFile} onMutated={reload} />
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

  return (
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
    </>
  );
}
