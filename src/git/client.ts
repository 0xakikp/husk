import { invoke } from "@tauri-apps/api/core";
import { getWorkspaceRoot } from "../workspace/store";
import { recordTimelineEvent } from "../timeline/store";

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null; timed_out?: boolean; truncated?: boolean };

class GitCommandError extends Error {
  constructor(message: string, readonly output: ShellOutput) { super(message); }
}

function workspace(cwd?: string | null): string {
  const root = cwd ?? getWorkspaceRoot();
  if (!root) throw new Error("Open a workspace folder before using Git.");
  return root;
}

async function gitOutput(
  args: string[], cwd?: string | null,
  options: { acceptedExitCodes?: number[]; allowTruncated?: boolean; mutation?: boolean; timeout?: number } = {},
): Promise<ShellOutput> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    program: "git",
    // Native argv, not a shell. Literal pathspecs also prevent a file named
    // :(glob)* (or containing brackets) from selecting unrelated files.
    args: ["--no-pager", "--literal-pathspecs", ...args],
    cwd: workspace(cwd), timeout_secs: options.timeout ?? 15,
  });
  if (out.timed_out || out.exit_code == null) {
    throw new GitCommandError(options.mutation
      ? "Git timed out or was interrupted. The operation may have completed; refresh and check the repository before retrying."
      : "Git timed out or was interrupted. Refresh to try again.", out);
  }
  if (out.exit_code !== 0 && !options.acceptedExitCodes?.includes(out.exit_code)) {
    throw new GitCommandError(out.stderr.trim() || out.stdout.trim() || `Git failed (exit ${out.exit_code}).`, out);
  }
  if (out.truncated && !options.allowTruncated) {
    throw new GitCommandError("Git returned more data than Husk can safely display. The result is incomplete; narrow the request or use the terminal.", out);
  }
  return out;
}

async function git(args: string[], cwd?: string | null, options?: Parameters<typeof gitOutput>[2]): Promise<string> {
  const out = await gitOutput(args, cwd, options);
  return out.stdout + (out.truncated ? "\n… Git output truncated by Husk.\n" : "");
}

/** Shared native-argv transport for the Git workflow modules. Callers supply
 * the reviewed repository explicitly; these helpers never invoke a shell. */
export const runGit = git;
export const runGitOutput = gitOutput;

function notRepository(error: unknown): boolean {
  return error instanceof GitCommandError && error.output.exit_code === 128 && /not a git repository/i.test(error.output.stderr);
}

/** False only for a missing workspace/non-worktree, not a permission/timeout error. */
export async function isRepo(cwd?: string | null): Promise<boolean> {
  if (!(cwd ?? getWorkspaceRoot())) return false;
  try { return (await git(["rev-parse", "--is-inside-work-tree"], cwd)).trim() === "true"; }
  catch (error) { if (notRepository(error)) return false; throw error; }
}

type Head = { branch: string; detached: boolean; unborn: boolean };

async function head(cwd: string): Promise<Head> {
  const [symbolic, resolved] = await Promise.all([
    gitOutput(["symbolic-ref", "--quiet", "--short", "HEAD"], cwd, { acceptedExitCodes: [1] }),
    gitOutput(["rev-parse", "--verify", "--quiet", "HEAD"], cwd, { acceptedExitCodes: [1] }),
  ]);
  const branch = symbolic.stdout.trim();
  if (resolved.exit_code === 1) {
    if (!branch) throw new Error("Git HEAD is unavailable. Check the repository in a terminal.");
    return { branch, detached: false, unborn: true };
  }
  return { branch: branch || resolved.stdout.trim().slice(0, 8), detached: !branch, unborn: false };
}

export async function currentBranch(cwd?: string | null): Promise<string> { return (await head(workspace(cwd))).branch; }

type Tracking = { upstream: string | null; upstreamGone: boolean; ahead: number; behind: number; upstreamRemote?: string; upstreamRef?: string };

async function tracking(cwd: string, current: Head): Promise<Tracking> {
  const empty = { upstream: null, upstreamGone: false, ahead: 0, behind: 0 };
  if (current.detached || current.unborn) return empty;
  const out = await git(["for-each-ref", "--format=%(upstream)%00%(upstream:short)%00%(upstream:remotename)%00%(upstream:remoteref)", `refs/heads/${current.branch}`], cwd);
  const [ref = "", name = "", upstreamRemote = "", upstreamRef = ""] = out.trim().split("\0");
  if (!ref) return empty;
  const exists = await gitOutput(["rev-parse", "--verify", "--quiet", ref], cwd, { acceptedExitCodes: [1] });
  if (exists.exit_code === 1) return { ...empty, upstream: name, upstreamGone: true };
  const counts = (await git(["rev-list", "--left-right", "--count", `HEAD...${ref}`], cwd)).trim();
  const match = /^(\d+)\s+(\d+)$/.exec(counts);
  if (!match) throw new Error("Git returned invalid ahead/behind counts.");
  return { upstream: name, upstreamGone: false, ahead: Number(match[1]), behind: Number(match[2]), upstreamRemote, upstreamRef };
}

export async function branchAheadBehind(cwd?: string | null): Promise<{ ahead: number; behind: number }> {
  const root = workspace(cwd);
  const { ahead, behind } = await tracking(root, await head(root));
  return { ahead, behind };
}

export type GitFile = { path: string; originalPath?: string; index: string; work: string; staged: boolean; unstaged: boolean; conflicted: boolean };

/** -z disables Git's display quoting and separates rename source/destination. */
export function parseStatus(out: string): GitFile[] {
  if (!out) return [];
  if (!out.endsWith("\0")) throw new Error("Git returned incomplete file status.");
  const fields = out.slice(0, -1).split("\0");
  const files: GitFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const line = fields[i]!;
    if (line.length < 4 || line[2] !== " " || !/^[ MADRCUT?!]{2}$/.test(line.slice(0, 2))) throw new Error("Git returned invalid file status.");
    const index = line[0]!;
    const work = line[1]!;
    const conflicted = index === "U" || work === "U" || line.startsWith("AA ") || line.startsWith("DD ");
    const renamed = index === "R" || index === "C" || work === "R" || work === "C";
    const originalPath = renamed ? fields[++i] : undefined;
    if (renamed && !originalPath) throw new Error("Git returned incomplete rename status.");
    files.push({ path: line.slice(3), ...(originalPath ? { originalPath } : {}), index, work,
      staged: !conflicted && index !== " " && index !== "?" && index !== "!",
      unstaged: conflicted || (work !== " " && work !== "!"), conflicted });
  }
  return files;
}

export async function status(cwd?: string | null): Promise<GitFile[]> {
  return parseStatus(await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], cwd));
}

export type RepositorySnapshot = Head & Tracking & { repoRoot: string; hasRemote: boolean; files: GitFile[] };

export async function repositorySnapshot(cwd?: string | null): Promise<RepositorySnapshot | null> {
  const requested = cwd ?? getWorkspaceRoot();
  if (!requested || !(await isRepo(requested))) return null;
  const repoRoot = (await git(["rev-parse", "--show-toplevel"], requested)).replace(/\r?\n$/, "");
  if (!repoRoot) throw new Error("Git did not return a repository folder.");
  const [current, files, remotes] = await Promise.all([head(repoRoot), status(repoRoot), git(["remote"], repoRoot)]);
  return { repoRoot, ...current, ...await tracking(repoRoot, current), hasRemote: !!remotes.trim(), files };
}

/** Include a rename's source so index operations don't leave half a rename. */
export function filePaths(file: GitFile): string[] {
  return file.originalPath && (file.index === "R" || file.work === "R") ? [file.path, file.originalPath] : [file.path];
}

/** An already staged rename's old path is no longer in the index/worktree;
 * adding it again would fail. Unstaging still needs both sides via filePaths. */
export function stagePaths(file: GitFile): string[] {
  return file.originalPath && file.work === "R" ? [file.path, file.originalPath] : [file.path];
}

function literalPaths(paths: string[]): string[] {
  for (const path of paths) {
    if (!path || path.includes("\0") || /^[\\/]/.test(path) || path.split("/").some((part) => part === "..") || path === ".") {
      throw new Error("Git paths must identify files inside this repository.");
    }
  }
  return [...new Set(paths)];
}
export const literalGitPaths = literalPaths;

export async function stageFiles(paths: string[], cwd?: string | null): Promise<string> {
  const selected = literalPaths(paths);
  return selected.length ? git(["add", "--all", "--", ...selected], cwd, { mutation: true, allowTruncated: true }) : "";
}

export async function unstageFiles(paths: string[], cwd?: string | null): Promise<string> {
  const selected = literalPaths(paths);
  if (!selected.length) return "";
  const root = workspace(cwd);
  const current = await head(root);
  return current.unborn
    // With no HEAD there is nothing to restore from. --cached never deletes the
    // working files; -f permits removing an index version edited since staging.
    ? git(["rm", "--cached", "-f", "--ignore-unmatch", "--", ...selected], root, { mutation: true, allowTruncated: true })
    : git(["restore", "--staged", "--", ...selected], root, { mutation: true, allowTruncated: true });
}

export const stageFile = (path: string, cwd?: string | null) => stageFiles([path], cwd);
export const unstageFile = (path: string, cwd?: string | null) => unstageFiles([path], cwd);

export async function commit(message: string, cwd?: string | null): Promise<string> {
  if (!message.trim() || message.includes("\0")) throw new Error("Enter a commit message first.");
  const root = workspace(cwd);
  const out = await git(["commit", "-m", message], root, { mutation: true, timeout: 120, allowTruncated: true });
  // Subject only; avoid attributing a slow commit to a newly selected workspace.
  void recordTimelineEvent("git", `Committed ${message.split("\n")[0].slice(0, 80)}`, undefined, { workspaceRoot: root });
  return out;
}

async function upstreamTarget(cwd: string): Promise<{ remote: string; ref: string }> {
  const current = await head(cwd);
  const target = await tracking(cwd, current);
  if (!target.upstream || target.upstreamGone || !target.upstreamRemote || !target.upstreamRef?.startsWith("refs/heads/")) throw new Error("A valid upstream branch is required. Configure or repair branch tracking first.");
  return { remote: target.upstreamRemote, ref: target.upstreamRef };
}

export async function push(cwd?: string | null): Promise<string> {
  const root = workspace(cwd);
  const { remote, ref } = await upstreamTarget(root);
  // Explicitly push just this branch to the displayed upstream. push.default,
  // pushRemote, followTags, and matching refspecs must not widen the action.
  return git(["push", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--", remote, `HEAD:${ref}`], root, { mutation: true, timeout: 120, allowTruncated: true });
}
export async function pull(cwd?: string | null): Promise<string> {
  const root = workspace(cwd);
  const { remote, ref } = await upstreamTarget(root);
  return git(["pull", "--ff-only", "--no-rebase", "--no-autostash", "--", remote, ref], root, { mutation: true, timeout: 120, allowTruncated: true });
}
export const fetch = (cwd?: string | null) => git(["fetch"], cwd, { mutation: true, timeout: 120, allowTruncated: true });

const DIFF_SAFETY_FLAGS = ["--no-ext-diff", "--no-textconv", "--no-color"];
const DIFF_FLAGS = [...DIFF_SAFETY_FLAGS, "--src-prefix=a/", "--dst-prefix=b/", "--unified=3", "--no-relative"];

/** Read-only preview: never invoke repository-configured external diff helpers. */
export async function diffForCommit(cwd?: string | null, maxChars = 8000): Promise<string> {
  const root = workspace(cwd);
  const files = await status(root);
  const body = await git(["diff", ...DIFF_FLAGS, ...(files.some((file) => file.staged) ? ["--staged"] : [])], root, { allowTruncated: true });
  const limit = Number.isFinite(maxChars) ? Math.max(0, Math.floor(maxChars)) : 8000;
  const text = body.trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}\n… diff truncated at ${limit} characters`;
}

export function diffFile(path: string, staged: boolean, cwd?: string | null, originalPath?: string): Promise<string> {
  const paths = literalPaths(originalPath ? [path, originalPath] : [path]);
  return git(["diff", ...DIFF_FLAGS, ...(staged ? ["--cached"] : []), "--", ...paths], cwd, { allowTruncated: true });
}

export async function diffUntrackedFile(path: string, cwd?: string | null): Promise<string> {
  literalPaths([path]);
  const out = await gitOutput(["diff", "--no-index", ...DIFF_FLAGS, "--", "/dev/null", path], cwd, { acceptedExitCodes: [1], allowTruncated: true });
  // --no-index uses 1 for differences, but also for inaccessible files. Do not
  // present a vanished/unreadable untracked file as an empty successful diff.
  if (out.exit_code === 1 && !out.stdout) throw new GitCommandError(out.stderr.trim() || "Git could not preview this untracked file. Refresh its status and try again.", out);
  return out.stdout + (out.truncated ? "\n… Git output truncated by Husk.\n" : "");
}

export type BlameLine = { hash: string; author: string; date: string; line: string };

export async function blameFile(path: string, cwd?: string | null): Promise<BlameLine[]> {
  literalPaths([path]);
  const out = await git(["blame", "--line-porcelain", "--no-textconv", "--", path], cwd);
  const lines: BlameLine[] = [];
  let current: Partial<BlameLine> = {};
  for (const line of out.split("\n")) {
    if (line.startsWith("\t")) {
      current.line = line.slice(1);
      if (current.hash && current.author && current.date) lines.push(current as BlameLine);
      current = {};
    } else if (line.startsWith("author ")) current.author = line.slice(7);
    else if (line.startsWith("author-time ")) {
      const ts = Number(line.slice(12));
      if (Number.isFinite(ts)) current.date = new Date(ts * 1000).toLocaleDateString();
    } else if (/^[0-9a-f]{40,64} \d+ \d+/.test(line)) current.hash = line.slice(0, 8);
  }
  return lines;
}

function boundedCount(value: number, fallback: number): number { return Number.isFinite(value) ? Math.min(500, Math.max(1, Math.floor(value))) : fallback; }

export async function log(n = 80, cwd?: string | null): Promise<string> {
  const root = workspace(cwd);
  if ((await head(root)).unborn) return "";
  return git(["log", "--oneline", "--graph", "--decorate", "--no-color", "-n", String(boundedCount(n, 80))], root);
}

export type CommitEntry = { hash: string; shortHash: string; subject: string; authorName: string; authorEmail: string; date: string; filesChanged: number; insertions: number; deletions: number };

export function parseStructuredLog(out: string): CommitEntry[] {
  if (!out) return [];
  if (!out.endsWith("\0")) throw new Error("Git returned incomplete commit history.");
  const fields = out.slice(0, -1).split("\0");
  const entries: CommitEntry[] = [];
  let current: CommitEntry | undefined;
  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]!;
    if (!field || field === "\n") continue;
    if (field === "HUSK_COMMIT") {
      const [hash, shortHash, subject, authorName, authorEmail, date] = fields.slice(i + 1, i + 7);
      if (!hash || !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(hash) || !shortHash || !date || authorEmail === undefined || authorName === undefined || subject === undefined) throw new Error("Git returned invalid commit history.");
      current = { hash, shortHash, subject, authorName, authorEmail, date, filesChanged: 0, insertions: 0, deletions: 0 };
      entries.push(current); i += 6; continue;
    }
    const stat = /^\n?(-|\d+)\t(-|\d+)\t([\s\S]*)$/.exec(field);
    if (!current || !stat) throw new Error("Git returned invalid commit statistics.");
    current.filesChanged++;
    current.insertions += stat[1] === "-" ? 0 : Number(stat[1]);
    current.deletions += stat[2] === "-" ? 0 : Number(stat[2]);
    if (!stat[3]) {
      // -z numstat renames/copies contain two additional NUL-delimited paths.
      if (!fields[i + 1] || !fields[i + 2]) throw new Error("Git returned incomplete rename statistics.");
      i += 2;
    }
  }
  return entries;
}

export async function structuredLog(n = 80, cwd?: string | null): Promise<CommitEntry[]> {
  const root = workspace(cwd);
  if ((await head(root)).unborn) return [];
  return parseStructuredLog(await git(["log", "--format=%x00HUSK_COMMIT%x00%H%x00%h%x00%s%x00%an%x00%ae%x00%ad%x00", "--date=short", "--numstat", "-z", ...DIFF_SAFETY_FLAGS, "-n", String(boundedCount(n, 80))], root));
}

export type GhIssue = { number: number; title: string; url: string; author: { login: string } | null; state: string; createdAt: string; labels: { name: string; color: string }[] };

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms);
    })]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}

export async function hasGhCli(cwd?: string | null): Promise<boolean> {
  try {
    const out = await withTimeout(invoke<ShellOutput>("shell_run_command", { program: "gh", args: ["--version"], cwd: workspace(cwd), timeout_secs: 5 }), 6000, "GitHub CLI check");
    return out.exit_code === 0 && !out.timed_out;
  } catch { return false; }
}

function validIssue(value: unknown): value is GhIssue {
  if (!value || typeof value !== "object") return false;
  const issue = value as Partial<GhIssue>;
  if (!Number.isSafeInteger(issue.number) || issue.number! <= 0 || typeof issue.title !== "string" || typeof issue.url !== "string" || typeof issue.state !== "string" || typeof issue.createdAt !== "string" ||
      (issue.author !== null && (!issue.author || typeof issue.author.login !== "string")) || !Array.isArray(issue.labels) ||
      !issue.labels.every((label) => label && typeof label.name === "string" && typeof label.color === "string" && /^[0-9a-fA-F]{6}$/.test(label.color))) return false;
  try { const url = new URL(issue.url); return url.protocol === "https:" && !url.username && !url.password; }
  catch { return false; }
}

export async function listIssues(cwd?: string | null, n = 30): Promise<{ kind: "ok"; issues: GhIssue[] } | { kind: "error"; message: string }> {
  try {
    const out = await withTimeout(invoke<ShellOutput>("shell_run_command", {
      program: "gh", args: ["issue", "list", "--json", "number,title,url,author,state,createdAt,labels", "--limit", String(boundedCount(n, 30))], cwd: workspace(cwd), timeout_secs: 30,
    }), 31000, "GitHub issue list");
    if (out.timed_out || out.exit_code == null) return { kind: "error", message: "GitHub issue list timed out or was interrupted. Try refreshing." };
    if (out.exit_code !== 0) return { kind: "error", message: out.stderr.trim() || out.stdout.trim() || "Failed to list issues." };
    if (out.truncated) return { kind: "error", message: "GitHub returned an incomplete issue list. Request fewer issues." };
    try {
      const issues: unknown = JSON.parse(out.stdout);
      return Array.isArray(issues) && issues.every(validIssue) ? { kind: "ok", issues } : { kind: "error", message: "Invalid response from GitHub CLI." };
    } catch { return { kind: "error", message: "Invalid response from GitHub CLI." }; }
  } catch (error) { return { kind: "error", message: error instanceof Error ? error.message : String(error) }; }
}
