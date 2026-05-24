import { useState } from "react";
import { useWorkspaceRoot, setWorkspaceRoot, pickWorkspaceFolder } from "../workspace/store";

const BM_KEY = "huskv2.bookmarks";

function loadBookmarks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(BM_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}
function persist(b: string[]) {
  try {
    localStorage.setItem(BM_KEY, JSON.stringify(b));
  } catch {
    // ignore
  }
}

const base = (p: string) => p.split("/").filter(Boolean).pop() || p;

export function WorkspacePath() {
  const root = useWorkspaceRoot();
  const [open, setOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<string[]>(loadBookmarks);

  const setBm = (b: string[]) => {
    setBookmarks(b);
    persist(b);
  };

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
              if (root && !bookmarks.includes(root)) setBm([...bookmarks, root]);
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
                    setWorkspaceRoot(p);
                    setOpen(false);
                  }}
                >
                  {base(p)}
                </button>
                <button
                  type="button"
                  className="ws-bm-del"
                  aria-label="Remove bookmark"
                  onClick={() => setBm(bookmarks.filter((x) => x !== p))}
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
