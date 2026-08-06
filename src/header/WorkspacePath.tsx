import { useState } from "react";
import { useWorkspaceRoot, gotoWorkspace, pickWorkspaceFolder } from "../workspace/store";
import { addBookmark, removeBookmark, useBookmarks } from "../bookmarks/store";
import { addProjectRoot, removeProjectRoot, useProjectRoots } from "../workspace/projectRoots";

const base = (p: string) => p.split("/").filter(Boolean).pop() || p;

export function WorkspacePath() {
  const root = useWorkspaceRoot();
  const [open, setOpen] = useState(false);
  const bookmarks = useBookmarks().filter((bookmark) => bookmark.type === "directory" && bookmark.path);
  const projectRoots = useProjectRoots();

  return (
    <div className="ws-path">
      <button type="button" className="ws-name" title="Open folder" onClick={() => void pickWorkspaceFolder()}>
        📂 {root ? base(root) : "~"}
      </button>
      <button type="button" className="ws-star" title="Bookmarks" onClick={() => setOpen((o) => !o)}>
        ★
      </button>
      {open ? (
        <div className="ws-bm" onMouseLeave={() => setOpen(false)}>
          <button
            type="button"
            className="ws-bm-add"
            onClick={() => {
              if (root && !bookmarks.some((bookmark) => bookmark.path === root)) {
                addBookmark({ type: "directory", label: base(root), path: root });
              }
              setOpen(false);
            }}
          >
            + Bookmark current
          </button>
          <button
            type="button"
            className="ws-bm-add"
            title="Everything under this folder shares one workspace and one timeline — git or not"
            onClick={() => {
              if (root) addProjectRoot(root);
              setOpen(false);
            }}
          >
            ⚑ Pin as project root
          </button>
          <div className="ws-bm-help">
            Bookmarks jump to a folder. A ⚑ project root groups the folder and everything
            under it into one workspace and one timeline — no git needed. Inside git
            repos this grouping happens automatically.
          </div>
          {projectRoots.length > 0 ? (
            <>
              <div className="ws-bm-empty">Project roots</div>
              {projectRoots.map((p) => (
                <div key={p} className="ws-bm-row">
                  <button
                    type="button"
                    className="ws-bm-item"
                    title={p}
                    onClick={() => {
                      gotoWorkspace(p);
                      setOpen(false);
                    }}
                  >
                    ⚑ {base(p)}
                  </button>
                  <button
                    type="button"
                    className="ws-bm-del"
                    aria-label="Unpin project root"
                    onClick={() => removeProjectRoot(p)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </>
          ) : null}
          {bookmarks.length === 0 ? (
            <div className="ws-bm-empty">No bookmarks</div>
          ) : (
            bookmarks.map((bookmark) => (
              <div key={bookmark.id} className="ws-bm-row">
                <button
                  type="button"
                  className="ws-bm-item"
                  title={bookmark.path}
                  onClick={() => {
                    gotoWorkspace(bookmark.path!);
                    setOpen(false);
                  }}
                >
                  {bookmark.label}
                </button>
                <button
                  type="button"
                  className="ws-bm-del"
                  aria-label="Remove bookmark"
                  onClick={() => removeBookmark(bookmark.id)}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
