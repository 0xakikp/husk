import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FolderGitTwoIcon, GitForkIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Modal } from "../components/Modal";
import { PanelHeader } from "../shell/PanelHeader";
import { getWorkspaceRoot, useWorkspaceRoot } from "../workspace/store";
import { toast } from "../toast";
import { getUnsavedPathWithin } from "../editor/dirtyStore";
import { onRepositoryFilesChanged } from "../editor/fileChanges";
import { detectReviewProvider, type ReviewProvider } from "./review";
import { canStageDiffHunks, stageDiffHunk } from "./patches";
import { GitDiffView } from "./GitDiffView";
import { ConflictReview } from "./ConflictReview";
import { GitActionsMenu } from "./GitActionsMenu";
import {
  repositorySnapshot, stageFiles, unstageFiles, filePaths, stagePaths, commit, push, pull, fetch as gitFetch,
  diffFile, diffUntrackedFile, type GitFile, type RepositorySnapshot,
} from "./client";
import "./SourceControlPanel.css";

const HistoryPanel = lazy(() => import("./GitGraphPanel").then((module) => ({ default: module.GitGraphPanel })));
const IssuesPanel = lazy(() => import("./IssuesPanel").then((module) => ({ default: module.IssuesPanel })));
const RepositoryActions = lazy(() => import("./RepositoryActions").then((module) => ({ default: module.RepositoryActions })));
const GitReviewPanel = lazy(() => import("./GitReviewPanel").then((module) => ({ default: module.GitReviewPanel })));
type Props = { onClose?: () => void; inline?: boolean; active?: boolean; onOpenGitGraph?: () => void; onOpenIssues?: () => void; onOpenFile?: (path: string, name: string) => void };
type Workflow = "branches" | "publish" | "stash" | "incoming" | "outgoing" | "provider";
type Preview = { file: GitFile; staged: boolean; text: string; loading: boolean; error?: string };
const errorText = (error: unknown) => {
  const text = error instanceof Error ? error.message : "Git could not complete the request.";
  return text.length > 2_000 ? `${text.slice(0, 2_000)}\n… Error details shortened.` : text;
};
const visiblePath = (path: string) => path.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);

export function SourceControlPanel(props: Props) {
  const workspace = useWorkspaceRoot();
  const drafts = useRef(new Map<string, string>());
  const [localPanel, setLocalPanel] = useState<"history" | "issues" | null>(null);
  const onMessage = (value: string) => {
    if (value) drafts.current.set(workspace, value);
    else drafts.current.delete(workspace);
  };
  // Navigation fallbacks never inject commands into a busy or remote terminal.
  if (localPanel) return <Suspense fallback={<div className="git-panel-empty">Loading…</div>}>
    {localPanel === "history" ? <HistoryPanel onClose={() => setLocalPanel(null)} /> : <IssuesPanel onClose={() => setLocalPanel(null)} />}
  </Suspense>;
  return <RepositoryPanel key={workspace} {...props} workspace={workspace}
    initialMessage={drafts.current.get(workspace) ?? ""} onMessage={onMessage}
    onOpenGitGraph={props.onOpenGitGraph ?? (() => setLocalPanel("history"))}
    onOpenIssues={props.onOpenIssues ?? (() => setLocalPanel("issues"))} />;
}

function RepositoryPanel({ workspace, initialMessage, onMessage, onClose, inline, active = true, onOpenGitGraph, onOpenIssues, onOpenFile }: Props & {
  workspace: string; initialMessage: string; onMessage: (value: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<RepositorySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState(initialMessage);
  const [operation, setOperation] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [resolveFile, setResolveFile] = useState<GitFile | null>(null);
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [provider, setProvider] = useState<ReviewProvider | null>(null);
  const alive = useRef(true);
  const locked = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const previewVersion = useRef(0);
  const messageRef = useRef(message);
  messageRef.current = message;
  const updateMessage = (value: string) => { setMessage(value); onMessage(value); };

  useEffect(() => { alive.current = true; return () => { alive.current = false; previewVersion.current += 1; }; }, []);
  const refresh = useCallback((): Promise<void> => {
    if (pending.current) return pending.current;
    if (!workspace) { setLoading(false); return Promise.resolve(); }
    setRefreshing(true);
    const request = (async () => {
      try {
        const value = await repositorySnapshot(workspace);
        if (alive.current) { setSnapshot(value); setError(null); }
      } catch (cause) {
        if (alive.current) { setError(errorText(cause)); setSnapshot(null); }
      } finally {
        if (alive.current) { setLoading(false); setRefreshing(false); }
        pending.current = null;
      }
    })();
    pending.current = request;
    return request;
  }, [workspace]);

  useEffect(() => {
    if (!active) return;
    const update = () => { if (!locked.current && document.visibilityState !== "hidden") void refresh(); };
    update();
    const timer = window.setInterval(update, 10_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update); };
  }, [active, refresh]);

  useEffect(() => {
    let cancelled = false;
    setProvider(null);
    if (snapshot?.hasRemote) void detectReviewProvider(snapshot).then((value) => { if (!cancelled) setProvider(value); }).catch(() => {});
    return () => { cancelled = true; };
  }, [snapshot?.repoRoot, snapshot?.branch, snapshot?.upstream, snapshot?.hasRemote]);

  const files = snapshot?.files ?? [];
  const conflicts = files.filter((file) => file.conflicted);
  const staged = files.filter((file) => file.staged && !file.conflicted);
  const unstaged = files.filter((file) => file.unstaged && !file.conflicted);
  const disabled = !active || loading || Boolean(error) || !snapshot || operation !== null;
  const canCommit = !disabled && staged.length > 0 && conflicts.length === 0 && Boolean(message.trim());
  const canPush = !disabled && !snapshot?.detached && !snapshot?.upstreamGone && Boolean(snapshot?.upstream) && (snapshot?.ahead ?? 0) > 0 && snapshot?.behind === 0;
  const canPull = !disabled && !snapshot?.detached && !snapshot?.upstreamGone && Boolean(snapshot?.upstream) && files.length === 0;

  const runAction = async (label: string, action: (repo: RepositorySnapshot) => Promise<unknown>, after?: () => void) => {
    if (locked.current || disabled || !snapshot) return;
    const reviewed = snapshot;
    locked.current = true;
    setOperation(label);
    try {
      // Bind writes to the displayed repository and recheck branch identity.
      await pending.current;
      const fresh = await repositorySnapshot(workspace);
      if (!alive.current || getWorkspaceRoot() !== workspace) return;
      if (!fresh || fresh.repoRoot !== reviewed.repoRoot || fresh.branch !== reviewed.branch || fresh.detached !== reviewed.detached || fresh.unborn !== reviewed.unborn) {
        throw new Error("The repository or branch changed. Review the refreshed status and try again.");
      }
      if (["Pulling", "Switching branch", "Creating branch", "Saving stash", "Applying stash"].includes(label)
        && (getUnsavedPathWithin(fresh.repoRoot) || getUnsavedPathWithin(workspace))) throw new Error("Save or close unsaved editor files before changing the working tree.");
      await action(fresh);
      toast({ title: label === "Committing" ? "Committed" : `${label} completed`, message: visiblePath(reviewed.repoRoot), variant: "success" });
      if (alive.current) {
        after?.(); previewVersion.current += 1; setPreview(null); setResolveFile(null);
      }
    } catch (cause) {
      toast({ title: `${label} failed`, message: errorText(cause), variant: "error" });
    } finally {
      // A failed stash apply/pull or a commit hook may still change disk files.
      // Editor subscribers recheck unsaved state before and after each read.
      onRepositoryFilesChanged(reviewed.repoRoot);
      if (workspace !== reviewed.repoRoot) onRepositoryFilesChanged(workspace);
      if (alive.current) { await refresh(); setOperation(null); }
      locked.current = false;
    }
  };

  const doCommit = () => {
    if (!canCommit) return;
    const submitted = message.trim();
    const original = message;
    void runAction("Committing", async (repo) => {
      if (repo.files.some((file) => file.conflicted)) throw new Error("Resolve all conflicts before committing.");
      const before = staged.map((file) => file.path).sort().join("\0");
      const now = repo.files.filter((file) => file.staged).map((file) => file.path).sort().join("\0");
      if (!now || now !== before) throw new Error("The staged file list changed. Review it before committing.");
      await commit(submitted, repo.repoRoot);
    }, () => { if (messageRef.current === original) updateMessage(""); });
  };

  const stageReviewed = (rows: GitFile[], repo: RepositorySnapshot) => {
    const selected = new Set(rows.map((file) => file.path));
    if (repo.files.some((file) => selected.has(file.path) && file.conflicted)) throw new Error("A selected file now has conflicts. Review its resolution before staging.");
    return stageFiles(rows.flatMap(stagePaths), repo.repoRoot);
  };

  const showDiff = async (file: GitFile, stagedSide: boolean) => {
    if (!snapshot) return;
    setResolveFile(null);
    const version = ++previewVersion.current;
    const cwd = snapshot.repoRoot;
    setPreview({ file, staged: stagedSide, text: "", loading: true });
    try {
      const text = file.index === "?" ? await diffUntrackedFile(file.path, cwd) : await diffFile(file.path, stagedSide, cwd, file.originalPath);
      if (alive.current && version === previewVersion.current) setPreview({ file, staged: stagedSide, text, loading: false });
    } catch (cause) {
      if (alive.current && version === previewVersion.current) setPreview({ file, staged: stagedSide, text: "", loading: false, error: errorText(cause) });
    }
  };

  const openWorkingFile = (file: GitFile) => {
    if (!snapshot || !onOpenFile) return;
    onOpenFile(`${snapshot.repoRoot.replace(/\/$/, "")}/${file.path}`, file.path.split("/").pop() || file.path);
  };
  const openWorkflow = (value: Workflow) => setWorkflow(value);
  const openConflict = (file: GitFile) => { previewVersion.current++; setPreview(null); setResolveFile(file); };
  const doPull = () => void runAction("Pulling", (repo) => {
    if (repo.files.length || !repo.upstream || repo.upstream !== snapshot?.upstream || repo.upstreamGone) throw new Error("Working tree or upstream changed. Review it before pulling.");
    return pull(repo.repoRoot);
  });

  const branchLabel = snapshot?.detached ? `Detached HEAD · ${snapshot.branch}` : snapshot?.branch || "—";
  const upstreamLabel = snapshot?.upstreamGone ? `${snapshot.upstream} · unavailable`
    : snapshot?.upstream ? `${snapshot.upstream} · ↑${snapshot.ahead} ↓${snapshot.behind}`
    : snapshot?.hasRemote ? "No upstream configured" : "Local only · no remote";
  const pushHint = !snapshot?.upstream ? "Configure an upstream before pushing" : snapshot.upstreamGone ? "The upstream ref is unavailable; fetch or repair tracking first"
    : snapshot.detached ? "Check out a branch before pushing" : snapshot.behind > 0 ? "Remote-tracking branch is ahead; reconcile before pushing" : snapshot.ahead === 0 ? "No outgoing commits at the last fetch" : `Push ${snapshot.ahead} commit(s) to ${snapshot.upstream}`;
  const actions = <div className="git-panel-tools">
    <button type="button" className="git-text-button" aria-label="Commit history" title="Browse commits and their changes" onClick={onOpenGitGraph}>History</button>
    <button type="button" className="git-text-button" aria-label="Fetch" title="Fetch remote updates without changing files" disabled={disabled || !snapshot?.hasRemote} onClick={() => void runAction("Fetching", (repo) => gitFetch(repo.repoRoot))}>Fetch</button>
    <GitActionsMenu>
        <button type="button" disabled={refreshing || operation !== null} onClick={() => void refresh()} aria-label="Refresh Git">Refresh local status</button>
        <button type="button" disabled={disabled} onClick={() => openWorkflow("branches")}>Branches…</button>
        <button type="button" disabled={disabled || snapshot?.detached || snapshot?.unborn} onClick={() => openWorkflow("publish")}>Publish / tracking…</button>
        <button type="button" disabled={disabled} onClick={() => openWorkflow("stash")}>Stashes…</button>
        <button type="button" disabled={!canPull} title={files.length ? "Commit or stash changes before pulling" : "Fast-forward only"} aria-label="Pull" onClick={doPull}>Pull · fast-forward only</button>
        <button type="button" disabled={disabled || !snapshot?.hasRemote} onClick={() => openWorkflow("provider")}>Pull / merge request…</button>
        {provider?.supportsIssues && <button type="button" aria-label="GitHub issues" onClick={onOpenIssues}>GitHub issues…</button>}
    </GitActionsMenu>
  </div>;

  function fileGroup(label: string, rows: GitFile[], side: "staged" | "working" | "conflict") {
    if (!rows.length) return null;
    const filtered = rows.filter((file) => `${file.path}\n${file.originalPath ?? ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
    return <section className="git-file-group" aria-label={label}>
      <header><span>{label} <span className="git-count">{rows.length}</span></span>{side !== "conflict" && <button type="button" className="git-text-button" disabled={disabled} title="Applies to every file in this group, including filtered-out files" onClick={() => void runAction(side === "staged" ? "Unstaging" : "Staging", (repo) => side === "staged" ? unstageFiles(rows.flatMap(filePaths), repo.repoRoot) : stageReviewed(rows, repo))}>{side === "staged" ? "Unstage all" : "Stage all"}</button>}</header>
      {filtered.length === 0 ? <p className="git-filter-empty">No matching files</p> : filtered.map((file) => {
        const code = side === "conflict" ? "!" : side === "staged" ? file.index : file.work === "?" ? "U" : file.work;
        const labelPath = visiblePath(file.path);
        return <div className="git-file-row" key={file.path}>
          <span className={`git-file-status git-file-status-${side}`} title={side === "conflict" ? "Unresolved conflict" : `${side === "staged" ? "Index" : "Working tree"}: ${code}`}>{code}</span>
          <button type="button" className="git-file-name" title={file.originalPath ? `${visiblePath(file.originalPath)} → ${labelPath}` : labelPath} aria-label={`View ${side} diff for ${labelPath}`} onClick={() => void showDiff(file, side === "staged")}>{file.originalPath ? "↪ " : ""}{labelPath}</button>
          <button type="button" className="git-file-action" disabled={disabled} title={side === "conflict" ? "Review marking resolved" : side === "staged" ? "Unstage file" : "Stage file"} aria-label={`${side === "conflict" ? "Resolve" : side === "staged" ? "Unstage" : "Stage"} ${labelPath}`} onClick={() => {
            if (side === "conflict") openConflict(file);
            else void runAction(side === "staged" ? "Unstaging" : "Staging", (repo) => side === "staged" ? unstageFiles(filePaths(file), repo.repoRoot) : stageReviewed([file], repo));
          }}>{side === "staged" ? "−" : side === "conflict" ? "✓" : "+"}</button>
        </div>;
      })}
    </section>;
  }

  if (workflow && snapshot) {
    const content = <Suspense fallback={<div className="git-panel-empty" role="status">Loading Git tools…</div>}>
      {workflow === "branches" || workflow === "publish" || workflow === "stash"
        ? <RepositoryActions key={`${workflow}:${snapshot.repoRoot}:${snapshot.branch}`} snapshot={snapshot} kind={workflow} onClose={() => setWorkflow(null)} onChanged={refresh} runAction={runAction} />
        : <GitReviewPanel snapshot={snapshot} mode={workflow} onClose={() => setWorkflow(null)} />}
    </Suspense>;
    return inline ? content : <Modal title="Git tools" onClose={() => setWorkflow(null)} className="git-panel-dialog">{content}</Modal>;
  }

  const body = <div className="git-panel">
    {inline ? <PanelHeader icon={FolderGitTwoIcon} title="Git" actions={actions} /> : <div className="git-dialog-tools">{actions}</div>}
    {!workspace ? <div className="git-panel-empty">Open a local folder to use source control.</div> : loading ? <div className="git-panel-empty" role="status">Loading repository…</div>
      : error ? <div className="git-panel-empty" role="alert"><strong>Could not read repository</strong><p>{error}</p><button type="button" className="git-button" onClick={() => void refresh()}>Retry</button></div>
      : !snapshot ? <div className="git-panel-empty"><strong>Not a Git working tree</strong><p>Open a folder inside a local repository to review changes.</p></div>
      : <>
        <div className="git-summary">
          <div className="git-branch"><HugeiconsIcon icon={GitForkIcon} size={13} /><button type="button" className="git-branch-picker" disabled={disabled} title="Create or switch branches" aria-label={`Branches: ${branchLabel}`} onClick={() => openWorkflow("branches")}>{branchLabel} <span aria-hidden="true">⌄</span></button>{snapshot.unborn && <span>first commit</span>}</div>
          <div className="git-repo-path" title={snapshot.repoRoot}>Local · {visiblePath(snapshot.repoRoot)}</div>
          <div className="git-upstream" title="Ahead/behind counts use the last fetched remote-tracking ref; Husk does not automatically contact remotes.">{upstreamLabel}</div>
          {snapshot.upstream && !snapshot.upstreamGone && <div className="git-review-links">
            {snapshot.ahead > 0 && <button type="button" className="git-text-button" onClick={() => openWorkflow("outgoing")}>Review {snapshot.ahead} outgoing</button>}
            {snapshot.behind > 0 && <button type="button" className="git-text-button" onClick={() => openWorkflow("incoming")}>Review {snapshot.behind} incoming</button>}
          </div>}
          <textarea aria-label="Commit message" value={message} onChange={(event) => updateMessage(event.target.value)} placeholder="Describe the staged changes…" rows={2} maxLength={10_000}
            onKeyDown={(event) => { if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing && !event.repeat) { event.preventDefault(); doCommit(); } }} />
          <div className="git-commit-meta"><span title="Staged changes are selected for the next commit. Unstaging keeps your edits.">{staged.length} staged · {unstaged.length} unstaged{conflicts.length ? ` · ${conflicts.length} conflicts` : ""}</span><span title="Commit staged changes">{typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘↩" : "Ctrl+Enter"}</span></div>
          <div className="git-commit-actions"><button type="button" className="git-button git-button-primary" disabled={!canCommit} onClick={doCommit}>Commit staged</button>{!snapshot.upstream || snapshot.upstreamGone
            ? <button type="button" className="git-button" disabled={disabled || snapshot.detached || snapshot.unborn} title={snapshot.unborn ? "Create the first commit before publishing" : "Review a remote and destination branch before pushing"} onClick={() => openWorkflow("publish")}>{snapshot.upstreamGone ? "Repair tracking" : "Publish branch"}</button>
            : <button type="button" className="git-button" disabled={!canPush} title={pushHint} onClick={() => void runAction("Pushing", (repo) => {
            if (!repo.upstream || repo.upstream !== snapshot.upstream || repo.upstreamGone || repo.behind > 0) throw new Error("Upstream changed or has incoming commits. Fetch and review before pushing.");
            return push(repo.repoRoot);
          })}>Push{snapshot.ahead > 0 ? ` ↑${snapshot.ahead}` : ""}</button>}</div>
          {snapshot.behind > 0 && <button type="button" className="git-button" disabled={!canPull} title={files.length ? "Commit or stash your changes before pulling" : "Fast-forward only; no automatic merge or rebase"} onClick={doPull}>Pull ↓{snapshot.behind}</button>}
          {conflicts.length > 0 && <p className="git-warning">Resolve conflicts before committing. Stage all excludes conflicted files. <button type="button" className="git-text-button" onClick={() => openConflict(conflicts[0])}>Review {conflicts.length} conflicts</button></p>}
          {operation && <div role="status" className="git-operation">{operation}…</div>}
        </div>
        {files.length > 0 && <div className="git-file-search"><input type="search" aria-label="Filter changed files" placeholder={`Filter ${files.length} changed files…`} value={search} onChange={(event) => setSearch(event.target.value)} /></div>}
        <div className="git-files" aria-busy={refreshing}>
          {files.length === 0 ? <div className="git-panel-empty"><strong>Working tree clean</strong><p>{snapshot.unborn ? "No files to commit yet." : "No staged or unstaged changes."}</p></div> : <>{fileGroup("Conflicts", conflicts, "conflict")}{fileGroup("Staged", staged, "staged")}{fileGroup("Changes", unstaged, "working")}</>}
        </div>
        {resolveFile && <Suspense fallback={<div role="status">Loading conflict review…</div>}><ConflictReview file={resolveFile} cwd={snapshot.repoRoot} disabled={disabled} onClose={() => setResolveFile(null)} onOpenFile={onOpenFile ? () => openWorkingFile(resolveFile) : undefined} onResolved={() => runAction("Staging resolution", (repo) => stageFiles(filePaths(resolveFile), repo.repoRoot))} /></Suspense>}
        {preview && <section className="git-diff" aria-label="Diff preview">
          <header><div><strong>{preview.file.index === "?" ? "Untracked file" : preview.staged ? "Staged changes" : "Working-tree changes"}</strong><span title={preview.file.path}>{visiblePath(preview.file.path)}</span></div><button type="button" className="git-icon-button" aria-label="Refresh diff" onClick={() => void showDiff(preview.file, preview.staged)}><HugeiconsIcon icon={Refresh01Icon} size={12} /></button><button type="button" className="git-icon-button" aria-label="Close diff" onClick={() => { previewVersion.current += 1; setPreview(null); }}>×</button></header>
          {preview.file.originalPath && <div className="git-diff-rename">{visiblePath(preview.file.originalPath)} → {visiblePath(preview.file.path)}</div>}
          {preview.loading ? <div className="git-diff-note" role="status">Loading diff…</div> : preview.error ? <div className="git-diff-note" role="alert">{preview.error}</div> : <GitDiffView text={preview.text} stagingDisabled={disabled}
            onOpenFile={onOpenFile && preview.file.work !== "D" && preview.file.index !== "D" ? () => openWorkingFile(preview.file) : undefined}
            onStageHunk={!preview.staged && canStageDiffHunks(preview.file, preview.text) ? (index) => runAction("Staging selected change", (repo) => stageDiffHunk(preview.file, preview.text, index, repo.repoRoot)) : undefined} />}
          <footer><span>{preview.staged ? "Selected for the next commit" : "Only saved files are shown"}</span><button type="button" className="git-text-button" onClick={async () => { try { await writeText(preview.file.path); toast({ title: "Relative file path copied", variant: "success" }); } catch { toast({ title: "Could not copy path", variant: "error" }); } }}>Copy path</button></footer>
        </section>}
      </>}
  </div>;
  return inline ? body : <Modal title="Source control" icon={FolderGitTwoIcon} onClose={onClose} className="git-panel-dialog">{body}</Modal>;
}
