import { useEffect, useState } from "react";
import { readDir, homeDir, type DirEntry } from "../fs";

export function FileExplorer({
  onOpenFile,
}: {
  onOpenFile: (path: string, name: string) => void;
}) {
  const [root, setRoot] = useState<string | null>(null);

  useEffect(() => {
    void homeDir().then(setRoot);
  }, []);

  if (!root) return <div className="explorer-loading">Loading…</div>;

  const name = root.split("/").filter(Boolean).pop() ?? root;
  return (
    <div className="explorer">
      <Node path={root} name={name} depth={0} isDir onOpenFile={onOpenFile} initiallyOpen />
    </div>
  );
}

function Node({
  path,
  name,
  depth,
  isDir,
  onOpenFile,
  initiallyOpen = false,
}: {
  path: string;
  name: string;
  depth: number;
  isDir: boolean;
  onOpenFile: (path: string, name: string) => void;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [children, setChildren] = useState<DirEntry[] | null>(null);

  useEffect(() => {
    if (isDir && open && children === null) {
      void readDir(path)
        .then(setChildren)
        .catch(() => setChildren([]));
    }
  }, [isDir, open, children, path]);

  const indent = { paddingLeft: 6 + depth * 12 };

  if (!isDir) {
    return (
      <button
        type="button"
        className="enode efile"
        style={indent}
        onClick={() => onOpenFile(path, name)}
      >
        <span className="enode-caret" />
        {name}
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="enode edir"
        style={indent}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="enode-caret">{open ? "▾" : "▸"}</span>
        {name}
      </button>
      {open && children
        ? children.map((c) => (
            <Node
              key={c.path}
              path={c.path}
              name={c.name}
              depth={depth + 1}
              isDir={c.is_dir}
              onOpenFile={onOpenFile}
            />
          ))
        : null}
    </div>
  );
}
