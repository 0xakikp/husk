import { invoke } from "@tauri-apps/api/core";
import { currentBranch, runGit, type RepositorySnapshot } from "./client";

export type ReviewProvider = {
  kind: "github" | "gitlab" | "unsupported" | "none";
  remote: string | null;
  host: string | null;
  repository: string | null;
  webUrl: string | null;
  supportsIssues: boolean;
  explanation: string;
};

const HASH = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const emptyProvider = (explanation: string, kind: ReviewProvider["kind"] = "none"): ReviewProvider => ({ kind, remote: null, host: null, repository: null, webUrl: null, supportsIssues: false, explanation });

/** Local configuration only. Credentials are never retained or displayed. A
 * custom hostname is not proof that the host runs GitHub or GitLab. */
export function providerFromRemote(raw: string, remote: string): ReviewProvider {
  let host: string;
  let path: string;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol) || url.search || url.hash) return { ...emptyProvider("This remote does not have a supported review URL.", "unsupported"), remote };
      if (url.port && !(url.protocol === "ssh:" && url.port === "22") && !(url.protocol === "git:" && url.port === "9418")) return { ...emptyProvider("Custom remote ports need a configured provider adapter.", "unsupported"), remote };
      host = url.hostname.toLowerCase();
      path = url.pathname.replace(/^\//, "");
    } else {
      const match = /^(?:[^\s@/:]+@)?([a-z\d.-]+):([^\s]+)$/i.exec(raw);
      if (!match) return { ...emptyProvider("Local paths and SSH aliases do not identify a review provider.", "unsupported"), remote };
      host = match[1]!.toLowerCase(); path = match[2]!;
    }
    path = path.replace(/\/$/, "").replace(/\.git$/, "");
    const parts = path.split("/");
    if (parts.length < 2 || parts.some((part) => !/^[a-z\d_.-]+$/i.test(part) || part === "." || part === "..")) throw new Error("Unsupported path");
    const kind = host === "github.com" && parts.length === 2 ? "github" : host === "gitlab.com" ? "gitlab" : "unsupported";
    return {
      kind, remote, host, repository: path,
      webUrl: kind === "unsupported" ? null : `https://${host}/${parts.map(encodeURIComponent).join("/")}`,
      supportsIssues: kind === "github",
      explanation: kind === "github" ? "GitHub review status is loaded only when requested, using your signed-in gh CLI."
        : kind === "gitlab" ? "Open or prepare merge requests on GitLab. In-app GitLab status and checks are not connected."
        : "This host has no configured review adapter. Local Git features remain available; use your provider's website for reviews.",
    };
  } catch { return { ...emptyProvider("The remote URL could not be safely identified.", "unsupported"), remote }; }
}

export async function detectReviewProvider(snapshot: RepositorySnapshot): Promise<ReviewProvider> {
  const remotes = (await runGit(["remote"], snapshot.repoRoot)).trim().split("\n").filter(Boolean);
  if (!remotes.length) return emptyProvider("Add a remote before opening a hosted code review.");
  const remote = snapshot.upstreamRemote && snapshot.upstreamRemote !== "." && remotes.includes(snapshot.upstreamRemote)
    ? snapshot.upstreamRemote : remotes.includes("origin") ? "origin" : remotes.length === 1 ? remotes[0]! : null;
  if (!remote) return emptyProvider("Several remotes are configured. Set this branch's upstream to select its review host.", "unsupported");
  const raw = (await runGit(["remote", "get-url", "--", remote], snapshot.repoRoot)).replace(/\r?\n$/, "");
  return providerFromRemote(raw, remote);
}

export function reviewBranch(snapshot: RepositorySnapshot, provider: ReviewProvider): string {
  return provider.remote === snapshot.upstreamRemote && snapshot.upstreamRef?.startsWith("refs/heads/")
    ? snapshot.upstreamRef.slice("refs/heads/".length) : snapshot.branch;
}

/** Browser handoff only; opening this URL never submits a PR/MR. */
export function createReviewUrl(provider: ReviewProvider, branch: string): string | null {
  if (!provider.webUrl || !branch || /[\x00-\x1f\x7f]/.test(branch)) return null;
  if (provider.kind === "github") return `${provider.webUrl}/compare/${encodeURIComponent(branch)}?expand=1`;
  if (provider.kind === "gitlab") {
    const url = new URL(`${provider.webUrl}/-/merge_requests/new`);
    url.searchParams.set("merge_request[source_branch]", branch);
    return url.toString();
  }
  return null;
}

export function reviewListUrl(provider: ReviewProvider): string | null {
  return provider.webUrl ? provider.kind === "github" ? `${provider.webUrl}/pulls` : provider.kind === "gitlab" ? `${provider.webUrl}/-/merge_requests` : null : null;
}

export function safePullRequestUrl(value: unknown, provider: ReviewProvider, number: number): string | null {
  if (typeof value !== "string" || !provider.webUrl || provider.kind !== "github") return null;
  try {
    const url = new URL(value);
    const repo = new URL(provider.webUrl);
    if (url.protocol !== "https:" || url.origin !== repo.origin || url.username || url.password || url.search || url.hash || url.pathname !== `${repo.pathname}/pull/${number}`) return null;
    return url.toString();
  } catch { return null; }
}

function notAborted(signal?: AbortSignal) { if (signal?.aborted) throw new Error("Review request cancelled."); }
async function assertBranch(snapshot: RepositorySnapshot, signal?: AbortSignal) {
  notAborted(signal);
  if (snapshot.unborn || snapshot.detached) throw new Error("Select a branch with a commit before reviewing it.");
  if (await currentBranch(snapshot.repoRoot) !== snapshot.branch) throw new Error("The branch changed. Return to Git and refresh before reviewing.");
  notAborted(signal);
}

export type ReviewCommit = { hash: string; author: string; date: string; subject: string };
export type DirectionalReview = { commits: ReviewCommit[]; limited: boolean; head: string; upstream: string; direction: "incoming" | "outgoing" };

export function parseReviewCommits(text: string): ReviewCommit[] {
  if (!text) return [];
  const parts = text.split("\0");
  if (parts.pop()?.trim()) throw new Error("Git returned incomplete review history.");
  if (parts.length % 4) throw new Error("Git returned invalid review history.");
  const commits: ReviewCommit[] = [];
  for (let index = 0; index < parts.length; index += 4) {
    const hash = parts[index]!.replace(/^\n/, "");
    const date = parts[index + 2]!;
    if (!HASH.test(hash) || !/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date))) throw new Error("Git returned invalid review history.");
    commits.push({ hash, author: parts[index + 1]!.slice(0, 300), date, subject: parts[index + 3]!.slice(0, 2000) });
  }
  return commits;
}

export async function loadDirectionalReview(snapshot: RepositorySnapshot, direction: "incoming" | "outgoing", signal?: AbortSignal): Promise<DirectionalReview> {
  await assertBranch(snapshot, signal);
  if (!snapshot.upstream || snapshot.upstreamGone) throw new Error("A valid upstream is required to compare incoming and outgoing commits.");
  const branchRef = `refs/heads/${snapshot.branch}`;
  const [trackingRef, trackingName] = (await runGit(["for-each-ref", "--format=%(upstream)%00%(upstream:short)", branchRef], snapshot.repoRoot)).trim().split("\0");
  notAborted(signal);
  if (!trackingRef?.startsWith("refs/") || trackingName !== snapshot.upstream) throw new Error("The upstream changed. Return to Git and refresh before comparing.");
  const [head, upstream] = await Promise.all([
    runGit(["rev-parse", "--verify", `${branchRef}^{commit}`], snapshot.repoRoot),
    runGit(["rev-parse", "--verify", `${trackingRef}^{commit}`], snapshot.repoRoot),
  ]);
  notAborted(signal);
  const headHash = head.trim(); const upstreamHash = upstream.trim();
  if (!HASH.test(headHash) || !HASH.test(upstreamHash)) throw new Error("Git returned invalid comparison targets.");
  // Pin both sides before reading. Fetches/commits made afterwards cannot change
  // the meaning of rows already on screen. This does not contact the remote.
  const range = direction === "outgoing" ? `${upstreamHash}..${headHash}` : `${headHash}..${upstreamHash}`;
  const rows = parseReviewCommits(await runGit(["log", "--no-color", "--format=%H%x00%an%x00%aI%x00%s%x00", "-n", "101", range, "--"], snapshot.repoRoot));
  notAborted(signal);
  return { commits: rows.slice(0, 100), limited: rows.length > 100, head: headHash, upstream: upstreamHash, direction };
}

export async function reviewCommitPatch(snapshot: RepositorySnapshot, hash: string): Promise<string> {
  if (!HASH.test(hash)) throw new Error("Choose a valid commit to inspect.");
  const text = await runGit(["show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color", "--root", hash, "--"], snapshot.repoRoot, { allowTruncated: true });
  return text.length > 200_000 ? `${text.slice(0, 200_000)}\n… Preview limited to 200,000 characters.` : text;
}

type CliOutput = { stdout: string; stderr: string; exit_code: number | null; timed_out?: boolean; truncated?: boolean };
export type ReviewCheck = { name: string; state: string; bucket: "pass" | "fail" | "pending" | "skipping" | "cancel" };
export type PullRequestReview = {
  number: number; title: string; url: string; state: string; draft: boolean;
  head: string; base: string; decision: string; body: string;
  checks: ReviewCheck[] | null; checksError: string | null;
};
export type HostedReview = { kind: "none" } | { kind: "pull-request"; pullRequest: PullRequestReview };

async function gh(args: string[], cwd: string): Promise<CliOutput> {
  let output: CliOutput;
  try { output = await invoke<CliOutput>("shell_run_command", { program: "gh", args, cwd, timeout_secs: 30 }); }
  catch { throw new Error("Could not run GitHub CLI. Install gh and sign in with gh auth login, then try again."); }
  if (output.timed_out || output.exit_code == null) throw new Error("GitHub did not respond in time. No review status was assumed; try again.");
  if (output.truncated) throw new Error("GitHub returned an incomplete response. Open the review in your browser instead.");
  return output;
}

function cliFailure(output: CliOutput): Error {
  if (output.exit_code === 4 || /auth login|authentication|not logged|HTTP 401|HTTP 403/i.test(output.stderr)) return new Error("GitHub authentication or access is required. Sign in with gh auth login and check repository access.");
  return new Error("GitHub review status could not be loaded. Check gh installation, network access, and repository permissions, then retry.");
}

function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function field(value: unknown, max = 2000): string { if (typeof value !== "string") throw new Error("GitHub returned an invalid review response."); return value.slice(0, max); }

/** Explicit user action only. Uses documented gh JSON fields; does not run
 * checkout, create, submit, merge, or any repository mutation. */
export async function loadHostedReview(snapshot: RepositorySnapshot, provider: ReviewProvider, signal?: AbortSignal): Promise<HostedReview> {
  if (provider.kind !== "github" || !provider.repository || !provider.host) throw new Error("In-app review status is not supported for this provider.");
  await assertBranch(snapshot, signal);
  const current = await detectReviewProvider(snapshot);
  notAborted(signal);
  if (current.webUrl !== provider.webUrl || current.remote !== provider.remote) throw new Error("The review remote changed. Return to Git and reopen review status.");
  const version = await gh(["--version"], snapshot.repoRoot);
  if (version.exit_code !== 0) throw cliFailure(version);
  notAborted(signal);
  const branch = reviewBranch(snapshot, provider);
  const repository = `${provider.host}/${provider.repository}`;
  // Official schema: https://cli.github.com/manual/gh_pr_view
  const output = await gh(["pr", "view", "--repo", repository, "--json", "number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,body", "--", branch], snapshot.repoRoot);
  notAborted(signal);
  if (output.exit_code !== 0) {
    if (output.exit_code === 1 && /^no pull requests found for branch\b/i.test(output.stderr.trim()) && !output.stdout.trim()) return { kind: "none" };
    throw cliFailure(output);
  }
  let raw: unknown;
  try { raw = JSON.parse(output.stdout); } catch { throw new Error("GitHub returned an invalid review response."); }
  if (!object(raw) || !Number.isSafeInteger(raw.number) || Number(raw.number) <= 0 || typeof raw.isDraft !== "boolean" || !["OPEN", "CLOSED", "MERGED"].includes(String(raw.state))) throw new Error("GitHub returned an invalid review response.");
  const url = safePullRequestUrl(raw.url, provider, Number(raw.number));
  if (!url || raw.headRefName !== branch) throw new Error("GitHub returned a review for a different repository or branch. Open your provider's website to inspect it.");
  const pullRequest: PullRequestReview = { number: Number(raw.number), title: field(raw.title), url, state: field(raw.state, 30), draft: raw.isDraft, head: field(raw.headRefName), base: field(raw.baseRefName), decision: field(raw.reviewDecision ?? "", 100), body: field(raw.body ?? "", 8000), checks: null, checksError: null };
  try {
    notAborted(signal);
    // Official fields/exit 8: https://cli.github.com/manual/gh_pr_checks
    const checks = await gh(["pr", "checks", String(pullRequest.number), "--repo", repository, "--json", "name,state,bucket"], snapshot.repoRoot);
    notAborted(signal);
    if (![0, 1, 8].includes(checks.exit_code!)) throw cliFailure(checks);
    const rows: unknown = JSON.parse(checks.stdout);
    if (!Array.isArray(rows) || rows.length > 500) throw new Error("GitHub returned an invalid or oversized checks response.");
    pullRequest.checks = rows.map((row: unknown) => {
      if (!object(row) || !["pass", "fail", "pending", "skipping", "cancel"].includes(String(row.bucket))) throw new Error("GitHub returned an invalid checks response.");
      return { name: field(row.name, 500), state: field(row.state, 100), bucket: row.bucket as ReviewCheck["bucket"] };
    });
  } catch { notAborted(signal); pullRequest.checksError = "Checks could not be loaded. This does not mean checks passed; refresh or view them on GitHub."; }
  return { kind: "pull-request", pullRequest };
}
