import { useCallback, useEffect, useState } from "react";
import {
  isRepo,
  currentBranch,
  status,
  stageFile,
  unstageFile,
  commit,
  diffFile,
  type GitFile,
} from "./client";
import { toast } from "../toast";

export function SourceControlPanel({ onClose }: { onClose: () => void }) {
  const [repo, setRepo] = useState<boolean | null>(null);
  const [branch, setBranch] = useState("");
  const [files, setFiles] = useState<GitFile[]>([]);
  const [msg, setMsg] = useState("");
  const [diff, setDiff] = useState<{ path: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    const r = await isRepo();
    setRepo(r);
    if (r) {
      setBranch(await currentBranch());
      setFiles(await status());
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await refresh();
    } catch (e) {
      toast({ title: "git error", message: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  const doCommit = async () => {
    if (!msg.trim()) return;
    try {
      await commit(msg.trim());
      toast({ title: "Committed", variant: "success" });
      setMsg("");
      await refresh();
    } catch (e) {
      toast({ title: "Commit failed", message: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  const showDiff = async (f: GitFile) => {
    setDiff({ path: f.path, text: await diffFile(f.path, f.staged) });
  };

  const staged = files.filter((f) => f.staged);
  const unstaged = files.filter((f) => !f.staged);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal docker-modal" role="dialog" aria-label="Source control" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Source Control{branch ? ` · ${branch}` : ""}</span>
          <span className="modal-head-actions">
            <button type="button" className="ai-icon" title="Refresh" onClick={() => void refresh()}>
              ⟳
            </button>
            <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </span>
        </div>
        <div className="modal-body">
          {repo === false ? (
            <p className="rb-empty">Not a git repository — open a folder that's under git.</p>
          ) : (
            <>
              <div className="sc-commit">
                <input
                  value={msg}
                  onChange={(e) => setMsg(e.target.value)}
                  placeholder="Commit message"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void doCommit();
                  }}
                />
                <button
                  type="button"
                  className="primary"
                  disabled={!msg.trim() || staged.length === 0}
                  onClick={() => void doCommit()}
                >
                  Commit
                </button>
              </div>

              <div className="dv-section">Staged ({staged.length})</div>
              {staged.map((f) => (
                <div key={f.path} className="rb-item">
                  <button type="button" className="sc-file" onClick={() => void showDiff(f)}>
                    {f.path}
                  </button>
                  <button type="button" className="ai-icon" title="Unstage" onClick={() => void act(() => unstageFile(f.path))}>
                    −
                  </button>
                </div>
              ))}

              <div className="dv-section">Changes ({unstaged.length})</div>
              {unstaged.map((f) => (
                <div key={f.path} className="rb-item">
                  <span className={`sc-badge ${f.work === "?" ? "sc-new" : "sc-mod"}`}>
                    {f.work === "?" ? "U" : (f.work.trim() || "M")}
                  </span>
                  <button type="button" className="sc-file" onClick={() => void showDiff(f)}>
                    {f.path}
                  </button>
                  <button type="button" className="ai-icon" title="Stage" onClick={() => void act(() => stageFile(f.path))}>
                    +
                  </button>
                </div>
              ))}

              {files.length === 0 ? <p className="rb-empty">Working tree clean.</p> : null}

              {diff ? (
                <div>
                  <div className="dv-section">{diff.path}</div>
                  <pre className="sc-diff-pre">{diff.text || "(no diff)"}</pre>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
