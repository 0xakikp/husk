import { useCallback, useEffect, useRef, useState } from "react";
import type { RepositorySnapshot } from "./client";
import { GitDiffView } from "./GitDiffView";
import {
  applyStash, createBranch, displayRemoteUrl, inspectStash, listBranches, listRemotes, listStashes,
  publishBranch, saveStash, setBranchUpstream, switchBranch,
  type BranchEntry, type RemoteEntry, type StashEntry,
} from "./workspaceActions";
import "./RepositoryActions.css";

export type RepositoryActionRunner = (label: string, action: (fresh: RepositorySnapshot) => Promise<unknown>, after?: () => void) => Promise<void>;
export type RepositoryActionsProps = {
  snapshot: RepositorySnapshot;
  kind: "branches" | "publish" | "stash";
  onClose: () => void;
  onChanged: () => void;
  runAction: RepositoryActionRunner;
};
const readable = (error: unknown) => (error instanceof Error ? error.message : "Git could not complete this request.").slice(0, 2000);
const display = (text: string) => text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function RepositoryActions({ snapshot, kind, onClose, onChanged, runAction }: RepositoryActionsProps) {
  const [branches, setBranches] = useState<BranchEntry[]>([]);
  const [remotes, setRemotes] = useState<RemoteEntry[]>([]);
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [startRef, setStartRef] = useState("");
  const [remoteName, setRemoteName] = useState("");
  const [destination, setDestination] = useState(snapshot.branch);
  const [reviewed, setReviewed] = useState(false);
  const [upstreamRef, setUpstreamRef] = useState("");
  const [stashMessage, setStashMessage] = useState("");
  const [includeUntracked, setIncludeUntracked] = useState(false);
  const [selectedStash, setSelectedStash] = useState<StashEntry | null>(null);
  const [stashPreview, setStashPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const live = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const previewGeneration = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; generation.current++; previewGeneration.current++; }; }, []);
  useEffect(() => {
    setDestination(snapshot.branch); setReviewed(false); setUpstreamRef("");
    setSelectedStash(null); setStashPreview(null); setPreviewLoading(false); previewGeneration.current++;
  }, [snapshot.repoRoot, snapshot.branch, kind]);

  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true); setError(null);
    try {
      if (kind === "stash") {
        const rows = await listStashes(snapshot.repoRoot);
        if (live.current && request === generation.current) setStashes(rows);
      } else {
        const [refs, addresses] = await Promise.all([listBranches(snapshot.repoRoot), kind === "publish" ? listRemotes(snapshot.repoRoot) : Promise.resolve([])]);
        if (live.current && request === generation.current) {
          setBranches(refs); setRemotes(addresses);
          setRemoteName((current) => addresses.some((entry) => entry.name === current) ? current : addresses[0]?.name ?? "");
          setReviewed(false);
        }
      }
    } catch (cause) { if (live.current && request === generation.current) setError(readable(cause)); }
    finally { if (live.current && request === generation.current) setLoading(false); }
  }, [snapshot.repoRoot, kind]);
  useEffect(() => { void reload(); }, [reload]);

  const submit = async (label: string, action: (fresh: RepositorySnapshot) => Promise<unknown>, after?: () => void) => {
    if (locked.current || loading || error) return;
    locked.current = true; setBusy(true); setError(null);
    try {
      await runAction(label, action, () => {
        if (!live.current) return;
        after?.(); onChanged(); void reload();
      });
    } catch (cause) { if (live.current) setError(readable(cause)); }
    finally { locked.current = false; if (live.current) setBusy(false); }
  };
  const preview = async (stash: StashEntry) => {
    const request = ++previewGeneration.current;
    setSelectedStash(stash); setStashPreview(null); setPreviewLoading(true); setError(null);
    try {
      const text = await inspectStash(stash.oid, snapshot.repoRoot);
      if (live.current && request === previewGeneration.current) setStashPreview(text);
    } catch (cause) { if (live.current && request === previewGeneration.current) setError(readable(cause)); }
    finally { if (live.current && request === previewGeneration.current) setPreviewLoading(false); }
  };
  const disabled = loading || busy || Boolean(error);
  const dirty = snapshot.files.length > 0;
  const selectedRemote = remotes.find((remote) => remote.name === remoteName);
  const remoteBranches = branches.filter((branch) => branch.kind === "remote");
  const title = kind === "branches" ? "Branches" : kind === "publish" ? "Publish & tracking" : "Saved work · stashes";

  return <section className="git-repository-actions" aria-label={title}>
    <header><strong>{title}</strong><button type="button" aria-label="Close repository actions" disabled={busy} onClick={onClose}>×</button></header>
    <div className="git-repository-action-body">
    <p className="git-action-hint">Local · {display(snapshot.branch)}{snapshot.detached ? " · detached HEAD" : ""}</p>
    {error && <p role="alert" className="git-action-error">{error}</p>}
    {loading && <p role="status" className="git-action-hint">Loading local Git data…</p>}
    {kind === "branches" && <>
      {dirty && <p className="git-action-warning">Commit or stash all changes before switching or creating a branch. Unsaved editor files must be saved too.</p>}
      <label>Local branch<select aria-label="Switch local branch" disabled={disabled || dirty} value="" onChange={(event) => {
        const ref = event.target.value;
        if (ref) void submit("Switching branch", (fresh) => switchBranch(ref, fresh.repoRoot));
      }}><option value="">Choose a branch…</option>{branches.filter((branch) => branch.kind === "local").map((branch) => <option key={branch.ref} value={branch.ref} disabled={(!snapshot.detached && branch.name === snapshot.branch) || Boolean(branch.worktreePath && branch.worktreePath !== snapshot.repoRoot)}>{display(branch.name)}{branch.name === snapshot.branch && !snapshot.detached ? " · current" : branch.worktreePath ? " · other worktree" : ""}</option>)}</select></label>
      <form onSubmit={(event) => { event.preventDefault(); if (!name.trim() || disabled || dirty || snapshot.unborn) return; void submit("Creating branch", (fresh) => createBranch(name.trim(), fresh.repoRoot, startRef || undefined), () => setName("")); }}>
        <label>New branch name<input aria-label="New branch name" value={name} disabled={disabled} onChange={(event) => setName(event.target.value)} placeholder="feature/my-change" autoComplete="off" /></label>
        <label>Start from<select aria-label="New branch starting point" value={startRef} disabled={disabled} onChange={(event) => setStartRef(event.target.value)}><option value="">Current commit</option>{branches.map((branch) => <option key={branch.ref} value={branch.ref}>{display(branch.name)} · {branch.kind}</option>)}</select></label>
        <button type="submit" disabled={disabled || dirty || !name.trim() || snapshot.unborn}>Create & switch</button>
      </form>
      {snapshot.unborn && <p className="git-action-hint">Make the first commit before creating another branch.</p>}
      <p className="git-action-hint">Remote branches are the last fetched local records. No network requests run when this menu opens.</p>
    </>}
    {kind === "publish" && <>
      {snapshot.detached || snapshot.unborn ? <p className="git-action-warning">Create or switch to a branch with a commit before publishing.</p> : <>
        <form onSubmit={(event) => {
          event.preventDefault(); if (disabled || !reviewed || !selectedRemote || !destination.trim()) return;
          const options = { branch: snapshot.branch, remote: selectedRemote.name, destination: destination.trim(), expectedPushUrls: [...selectedRemote.pushUrls] };
          void submit("Publishing branch", (fresh) => publishBranch(options, fresh.repoRoot), () => setReviewed(false));
        }}>
          <label>Remote<select aria-label="Publish remote" value={remoteName} disabled={disabled} onChange={(event) => { setRemoteName(event.target.value); setReviewed(false); }}><option value="">Choose a remote…</option>{remotes.map((remote) => <option key={remote.name} value={remote.name}>{display(remote.name)}</option>)}</select></label>
          <label>Destination branch<input aria-label="Publish destination branch" value={destination} disabled={disabled} onChange={(event) => { setDestination(event.target.value); setReviewed(false); }} autoComplete="off" /></label>
          {selectedRemote && <div className="git-action-review"><strong>{display(snapshot.branch)} → {display(selectedRemote.name)}/{display(destination || "…")}</strong>{selectedRemote.pushUrls.map((url, i) => <p key={i}>{displayRemoteUrl(url)}</p>)}<p>Pushes this branch only and sets its upstream. No force-push. {selectedRemote.pushUrls.length > 1 ? "Every listed push address receives the branch." : ""}</p></div>}
          <label className="git-action-checkbox"><input type="checkbox" checked={reviewed} disabled={disabled || !selectedRemote} onChange={(event) => setReviewed(event.target.checked)} />I reviewed the remote and destination.</label>
          <button type="submit" disabled={disabled || !selectedRemote || !destination.trim() || !reviewed}>Publish branch</button>
        </form>
        {!loading && !remotes.length && <p className="git-action-hint">No remote configured. Add one in the terminal, then refresh. Husk never creates a hosted repository automatically.</p>}
        <div className="git-action-separator" />
        <label>Track an existing remote branch<select aria-label="Existing upstream branch" value={upstreamRef} disabled={disabled} onChange={(event) => setUpstreamRef(event.target.value)}><option value="">Choose a fetched remote branch…</option>{remoteBranches.map((branch) => <option key={branch.ref} value={branch.ref}>{display(branch.name)}</option>)}</select></label>
        <button type="button" disabled={disabled || !upstreamRef} onClick={() => void submit("Setting upstream", (fresh) => setBranchUpstream(snapshot.branch, upstreamRef, fresh.repoRoot))}>Set upstream · local only</button>
        <p className="git-action-hint">Changes branch tracking; does not push, pull, or modify files. Fetch explicitly if the branch is missing.</p>
      </>}
    </>}
    {kind === "stash" && <>
      <form onSubmit={(event) => { event.preventDefault(); if (disabled || !dirty || snapshot.unborn) return; void submit("Saving stash", (fresh) => saveStash({ message: stashMessage, includeUntracked }, fresh.repoRoot), () => { setStashMessage(""); setSelectedStash(null); setStashPreview(null); }); }}>
        <label>Stash message<input aria-label="Stash message" value={stashMessage} disabled={disabled} onChange={(event) => setStashMessage(event.target.value)} placeholder="Work to resume later" maxLength={1000} /></label>
        <label className="git-action-checkbox"><input type="checkbox" checked={includeUntracked} disabled={disabled} onChange={(event) => setIncludeUntracked(event.target.checked)} />Include untracked files</label>
        <p className="git-action-warning">Saving moves tracked changes into a local stash and removes them from the working tree. {includeUntracked ? "Untracked files will be moved too; they can include secrets." : "Untracked files stay where they are."} Ignored files and submodule work are not saved.</p>
        <button type="submit" disabled={disabled || !dirty || snapshot.unborn || snapshot.files.some((file) => file.conflicted)}>Save work to stash</button>
      </form>
      {snapshot.unborn && <p className="git-action-hint">Git needs its first commit before it can save stashes.</p>}
      <div className="git-action-separator" />
      <ul className="git-stash-list">{stashes.map((stash) => <li key={stash.oid}><button type="button" disabled={busy} aria-expanded={selectedStash?.oid === stash.oid} onClick={() => void preview(stash)}><strong>{display(stash.subject)}</strong><span>{stash.selector} · {stash.oid.slice(0, 8)} · {stash.date.slice(0, 10)}</span></button></li>)}</ul>
      {!loading && !stashes.length && <p className="git-action-hint">No saved stashes.</p>}
      {selectedStash && <div className="git-stash-preview"><strong>{display(selectedStash.selector)} · {selectedStash.oid.slice(0, 8)}</strong>{previewLoading ? <p role="status">Loading stash diff…</p> : stashPreview !== null ? <GitDiffView text={stashPreview} title={`Stash ${selectedStash.oid.slice(0, 8)}`} /> : null}<p className="git-action-warning">Apply restores saved changes and staging where possible. Conflicts may need manual resolution. The stash is kept even after applying.</p><button type="button" disabled={disabled || dirty || previewLoading || stashPreview === null} onClick={() => void submit("Applying stash", (fresh) => applyStash(selectedStash.oid, fresh.repoRoot), () => { setSelectedStash(null); setStashPreview(null); })}>Apply & keep stash</button>{dirty && <p className="git-action-hint">Commit or stash current changes before applying this stash.</p>}</div>}
    </>}
    </div>
    <footer><span>{busy ? "Working…" : "Local lists · network on request"}</span><button type="button" disabled={loading || busy} onClick={() => void reload()}>Refresh list</button></footer>
  </section>;
}
