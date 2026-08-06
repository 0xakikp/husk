import { useState } from "react";
import { useWorkspaceRoot, gotoWorkspace, pickWorkspaceFolder } from "../workspace/store";
import { addBookmark, removeBookmark, useBookmarks } from "../workspace/bookmarks";

const base = (p: string) => p.split("/").filter(Boolean).pop() || p;

export function WorkspacePath() {
  const root = useWorkspaceRoot();
  const [open, setOpen] = useState(false);
  const bookmarks = useBookmarks();

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
              if (root) addBookmark(root);
              setOpen(false);
            }}
          >
            + Bookmark current
          </button>
          {bookmarks.length === 0 ? (
            <div className="ws-bm-empty">No bookmarks</div>
          ) : (
            bookmarks.map((p) => (
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
                  {base(p)}
                </button>
                <button
                  type="button"
                  className="ws-bm-del"
                  aria-label="Remove bookmark"
                  onClick={() => removeBookmark(p)}
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
