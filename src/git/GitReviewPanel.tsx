import { useCallback, useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { getWorkspaceRoot, useWorkspaceRoot } from "../workspace/store";
import type { RepositorySnapshot } from "./client";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";
import { GitDiffView } from "./GitDiffView";
import {
  createReviewUrl, detectReviewProvider, loadDirectionalReview, loadHostedReview,
  reviewBranch, reviewCommitPatch, reviewListUrl,
  type DirectionalReview, type HostedReview, type ReviewCommit, type ReviewProvider,
} from "./review";
import "./GitReviewPanel.css";

export type GitReviewPanelProps = {
  snapshot: RepositorySnapshot;
  mode: "incoming" | "outgoing" | "provider";
  onClose: () => void;
};
type LocalReview = { provider: ReviewProvider } | { directional: DirectionalReview };

export function GitReviewPanel(props: GitReviewPanelProps) {
  const workspace = useWorkspaceRoot();
  const { snapshot, mode } = props;
  const scope = [workspace, snapshot.repoRoot, snapshot.branch, snapshot.upstream, snapshot.upstreamRemote, snapshot.upstreamRef, mode].join("\0");
  return <ReviewPanel key={scope} {...props} workspace={workspace} />;
}

function ReviewPanel({ snapshot, mode, onClose, workspace }: GitReviewPanelProps & { workspace: string }) {
  // Freeze the reviewed branch/repository until this keyed panel is replaced.
  // Parent status polling does not itself repeat authenticated provider reads.
  const initial = useRef(snapshot).current;
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const patchGeneration = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current?.abort(); patchGeneration.current++; }; }, []);
  const current = () => alive.current && getWorkspaceRoot() === workspace;
  const load = useCallback(async (_cwd: string, signal: AbortSignal): Promise<LocalReview> => {
    if (!workspace || (workspace !== initial.repoRoot && !workspace.startsWith(`${initial.repoRoot}/`))) throw new Error("The workspace changed. Return to Git and reopen this review.");
    return mode === "provider" ? { provider: await detectReviewProvider(initial) } : { directional: await loadDirectionalReview(initial, mode, signal) };
  }, [initial, mode, workspace]);
  const local = useGitWorkspaceQuery(initial.repoRoot, load);
  const provider = local.data && "provider" in local.data ? local.data.provider : null;
  const directional = local.data && "directional" in local.data ? local.data.directional : null;
  const [hosted, setHosted] = useState<HostedReview | null>(null);
  const [hostedBusy, setHostedBusy] = useState(false);
  const [hostedError, setHostedError] = useState<string | null>(null);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewCommit | null>(null);
  const [patch, setPatch] = useState<{ text: string; error: string | null; loading: boolean } | null>(null);
  const title = mode === "provider" ? "Code review" : mode === "incoming" ? "Incoming commits" : "Outgoing commits";

  async function loadProvider() {
    if (!provider || request.current || !current()) return;
    const controller = new AbortController(); request.current = controller;
    setHostedBusy(true); setHostedError(null); setHosted(null);
    try {
      const result = await loadHostedReview(initial, provider, controller.signal);
      if (current() && !controller.signal.aborted) setHosted(result);
    } catch (error) {
      if (current() && !controller.signal.aborted) setHostedError(error instanceof Error ? error.message : "Could not load review status.");
    } finally {
      if (request.current === controller) request.current = null;
      if (current()) setHostedBusy(false);
    }
  }

  async function browse(url: string | null) {
    if (!url || !current()) return;
    setBrowserError(null);
    try { await openUrl(url); }
    catch { if (current()) setBrowserError("Could not open your browser. Try again."); }
  }

  async function inspect(commit: ReviewCommit) {
    if (!current()) return;
    const generation = ++patchGeneration.current;
    setSelected(commit); setPatch({ text: "", error: null, loading: true });
    try {
      const text = await reviewCommitPatch(initial, commit.hash);
      if (current() && generation === patchGeneration.current) setPatch({ text, error: null, loading: false });
    } catch (error) {
      if (current() && generation === patchGeneration.current) setPatch({ text: "", error: error instanceof Error ? error.message : "Could not inspect this commit.", loading: false });
    }
  }

  const branch = provider ? reviewBranch(initial, provider) : initial.branch;
  const createUrl = provider && !initial.detached && !initial.unborn ? createReviewUrl(provider, branch) : null;
  const pr = hosted?.kind === "pull-request" ? hosted.pullRequest : null;

  return <section className="git-review-panel" aria-label={title}>
    <header className="git-review-header">
      <div><h2>{title}</h2><p title={initial.repoRoot}>{initial.branch}{mode !== "provider" && initial.upstream ? ` ↔ ${initial.upstream}` : ""}</p></div>
      <button type="button" onClick={onClose} aria-label="Back to Git" title="Back to Git">×</button>
    </header>
    <div className="git-review-content" aria-busy={local.loading}>
      {local.loading ? <p role="status">Reading local Git information…</p> : local.error ? <div className="git-review-empty"><p role="alert">{local.error}</p><button type="button" onClick={local.refresh}>Retry</button></div> : <>
        {provider && <div className="git-provider-review">
          <div className="git-review-provider-meta"><strong>{provider.kind === "github" ? "GitHub" : provider.kind === "gitlab" ? "GitLab" : "Hosted reviews"}</strong>{provider.remote && <span>{provider.remote}</span>}</div>
          {provider.host && <p className="git-review-location">{provider.host}{provider.repository ? ` / ${provider.repository}` : ""}</p>}
          <p>{provider.explanation}</p>
          {provider.kind === "github" && <>
            <p className="git-review-note">Uses the existing gh account. Only review metadata and checks are read; nothing is published or submitted.</p>
            <button type="button" className="git-review-primary" onClick={() => { void loadProvider(); }} disabled={hostedBusy || initial.unborn || initial.detached}>{hostedBusy ? "Loading review status…" : hosted ? "Refresh review status" : "Load review status"}</button>
            {(initial.unborn || initial.detached) && <p>Select a branch with a commit to load its review.</p>}
          </>}
          {hostedError && <p role="alert">{hostedError}</p>}
          {hosted?.kind === "none" && <p className="git-review-empty">No pull request was found for this branch in the selected repository.</p>}
          {pr && <article className="git-review-card">
            <div className="git-review-provider-meta"><strong>#{pr.number} {pr.title}</strong><span>{pr.draft ? "Draft · " : ""}{pr.state.toLowerCase()}</span></div>
            <p>{pr.head} → {pr.base}</p>
            <p>Review: {pr.decision ? pr.decision.toLowerCase().replace(/_/g, " ") : "No review decision reported"}</p>
            <button type="button" onClick={() => { void browse(pr.url); }}>Open pull request ↗</button>
            {pr.body && <details><summary>Description</summary><p className="git-review-description">{pr.body}{pr.body.length === 8000 ? "\n… Description preview limited." : ""}</p></details>}
            <h3>Checks</h3>
            {pr.checksError ? <p role="alert">{pr.checksError}</p> : pr.checks?.length ? <ul className="git-review-checks">{pr.checks.map((check, index) => <li key={`${index}:${check.name}`}><span className={`git-check-state git-check-${check.bucket}`}>{check.bucket}</span><span>{check.name}<small>{check.state.toLowerCase().replace(/_/g, " ")}</small></span></li>)}</ul> : <p>No checks reported. This is not a passing-checks guarantee.</p>}
          </article>}
          {provider.webUrl && <div className="git-review-browser-actions">
            <button type="button" onClick={() => { void browse(reviewListUrl(provider)); }}>Open {provider.kind === "gitlab" ? "merge" : "pull"} requests ↗</button>
            {createUrl && <button type="button" onClick={() => { void browse(createUrl); }}>Prepare {provider.kind === "gitlab" ? "merge" : "pull"} request ↗</button>}
            <p className="git-review-note">Opens a browser form for branch {branch}. Publish the branch first, then choose and verify the target there. Husk does not create the request.</p>
          </div>}
          {browserError && <p role="alert">{browserError}</p>}
        </div>}
        {directional && <>
          <p className="git-review-note">Local snapshot of the last fetch. {mode === "incoming" ? "Commits on the upstream but not this branch." : "Commits on this branch but not its upstream."} No network request was made.</p>
          <button type="button" onClick={() => { patchGeneration.current++; setSelected(null); setPatch(null); local.refresh(); }}>Refresh local comparison</button>
          <p>{directional.commits.length}{directional.limited ? "+" : ""} {mode} commits{directional.commits.length ? " · select one to inspect" : " in this snapshot"}</p>
          {directional.limited && <p className="git-review-note">Showing the newest 100 commits. Use the terminal to review the remaining history.</p>}
          <ul className="git-review-commits">{directional.commits.map((commit) => <li key={commit.hash}><button type="button" aria-pressed={selected?.hash === commit.hash} onClick={() => { void inspect(commit); }}><span>{commit.subject || "(no subject)"}</span><small>{commit.hash.slice(0, 8)} · {commit.author} · {commit.date.slice(0, 10)}</small></button></li>)}</ul>
        </>}
      </>}
    </div>
    {selected && patch && <section className="git-review-patch" aria-label="Selected commit changes">
      <header><span title={selected.hash}>{selected.hash.slice(0, 8)} · {selected.subject}</span><button type="button" aria-label="Close commit preview" onClick={() => { patchGeneration.current++; setSelected(null); setPatch(null); }}>×</button></header>
      {patch.loading ? <p role="status">Loading commit changes…</p> : patch.error ? <div><p role="alert">{patch.error}</p><button type="button" onClick={() => { void inspect(selected); }}>Retry commit preview</button></div> : patch.text ? <GitDiffView text={patch.text} title={`${selected.hash.slice(0, 8)} · Commit changes`} /> : <p>No text patch is available. This may be an empty or merge commit; inspect its parents in the terminal.</p>}
    </section>}
  </section>;
}
