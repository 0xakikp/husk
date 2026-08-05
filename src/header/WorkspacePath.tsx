import { useState } from "react";
import { useWorkspaceRoot, gotoWorkspace, pickWorkspaceFolder } from "../workspace/store";
import { useProjectProfile } from "../project/profile";

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
  const profile = useProjectProfile();
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
      {profile?.exists && (
        <span
          className="ws-profile-badge"
          title={
            profile.enabled
              ? `Project profile active — ${profile.husk_dir}${profile.include_instructions ? " · instructions attached to AI" : ""}`
              : "Project profile disabled for this workspace"
          }
        >
          {profile.enabled ? "◈ profile" : "◇ profile off"}
        </span>
      )}
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
