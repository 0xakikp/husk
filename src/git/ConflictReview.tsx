import { useCallback, useState } from "react";
import type { GitFile } from "./client";
import { readConflictVersions } from "./patches";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";
import { getFileState } from "../editor/dirtyStore";

export function ConflictReview({ file, cwd, disabled, onClose, onOpenFile, onResolved }: {
  file: GitFile; cwd: string; disabled: boolean; onClose: () => void;
  onOpenFile?: () => void; onResolved: () => Promise<void>;
}) {
  const load = useCallback((root: string) => readConflictVersions(file.path, root), [file.path]);
  const { data, loading, error, refresh } = useGitWorkspaceQuery(cwd, load);
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const [side, setSide] = useState<"ours" | "theirs" | "base">("ours");
  const [notice, setNotice] = useState("");
  const identity = `${cwd}\0${file.path}`;
  return <section className="git-resolve-review" aria-label="Confirm conflict resolution">
    <header><strong>Resolve {file.path}</strong><button type="button" className="git-icon-button" aria-label="Close conflict review" onClick={onClose}>×</button></header>
    <p>Compare the index versions, then edit the working file, removing conflict markers. These previews never replace your file.</p>
    <div className="git-conflict-tabs" aria-label="Conflict version">
      {(["ours", "theirs", "base"] as const).map((value) => <button type="button" className="git-button" aria-pressed={side === value} key={value} onClick={() => setSide(value)}>{value === "ours" ? "Side 2 · ours" : value === "theirs" ? "Side 3 · theirs" : "Base"}</button>)}
    </div>
    {loading ? <p role="status">Loading conflict versions…</p> : error ? <p role="alert">{error}</p> : <pre tabIndex={0} aria-label={`${side} conflict content`}>{data?.[side] === null ? "This version does not contain the file." : data?.[side] || "(empty file)"}</pre>}
    <p>“Ours” and “theirs” are Git’s index roles. Review the actual content before resolving.</p>
    <div>{onOpenFile && <button type="button" className="git-button" onClick={onOpenFile}>Open working file</button>}<button type="button" className="git-text-button" disabled={loading} onClick={() => { setConfirmed(null); refresh(); }}>Refresh versions</button></div>
    <label className="git-resolution-check"><input type="checkbox" checked={confirmed === identity} onChange={(event) => setConfirmed(event.target.checked ? identity : null)} />I reviewed the saved file and resolved this conflict.</label>
    {notice && <p role="alert">{notice}</p>}
    <div><button type="button" className="git-button" onClick={onClose}>Cancel</button><button type="button" className="git-button" disabled={disabled || confirmed !== identity} onClick={async () => {
      if (getFileState(`${cwd.replace(/\/$/, "")}/${file.path}`) !== "clean") { setNotice("Save your editor changes before marking this file resolved."); return; }
      setConfirmed(null); await onResolved();
    }}>Mark resolved</button></div>
    <p>Mark resolved stages the saved file for the next commit; it does not merge content automatically.</p>
  </section>;
}
