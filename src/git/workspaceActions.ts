import { repositorySnapshot, runGit, runGitOutput, type RepositorySnapshot } from "./client";
import { getUnsavedPathWithin } from "../editor/dirtyStore";

export type BranchEntry = { ref: string; name: string; kind: "local" | "remote"; oid: string; worktreePath: string | null; upstream: string | null };
export type RemoteEntry = { name: string; fetchUrls: string[]; pushUrls: string[] };
export type StashEntry = { oid: string; selector: string; subject: string; date: string };
const mutation = { mutation: true, timeout: 120, allowTruncated: true };
const oidPattern = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

function records(text: string, fields: number): string[][] {
  if (!text) return [];
  if (!text.endsWith("\0\n")) throw new Error("Git returned an incomplete list. Refresh before continuing.");
  return text.slice(0, -2).split("\0\n").map((record) => {
    const parts = record.split("\0");
    if (parts.length !== fields) throw new Error("Git returned an invalid list.");
    return parts;
  });
}

export async function listBranches(cwd: string): Promise<BranchEntry[]> {
  const out = await runGit(["for-each-ref", "--sort=refname", "--format=%(refname)%00%(objectname)%00%(symref)%00%(worktreepath)%00%(upstream)%00", "refs/heads", "refs/remotes"], cwd);
  return records(out, 5).flatMap(([ref, oid, symbolic, worktreePath, upstream]) => {
    if (symbolic) return []; // remote HEAD is an alias, not a branch to switch to.
    if (!oidPattern.test(oid) || (!ref.startsWith("refs/heads/") && !ref.startsWith("refs/remotes/"))) throw new Error("Git returned an invalid branch.");
    const kind = ref.startsWith("refs/heads/") ? "local" : "remote";
    return [{ ref, oid, kind, name: ref.slice(kind === "local" ? 11 : 13), worktreePath: worktreePath || null, upstream: upstream || null }];
  });
}

export async function listRemotes(cwd: string): Promise<RemoteEntry[]> {
  const names = (await runGit(["remote"], cwd)).split("\n").filter(Boolean);
  return Promise.all(names.map(async (name) => {
    const [fetch, push] = await Promise.all([
      runGit(["remote", "get-url", "--all", "--", name], cwd),
      runGit(["remote", "get-url", "--all", "--push", "--", name], cwd),
    ]);
    return { name, fetchUrls: fetch.split("\n").filter(Boolean), pushUrls: push.split("\n").filter(Boolean) };
  }));
}

/** Render configured addresses without revealing embedded credentials/query tokens. */
export function displayRemoteUrl(value: string): string {
  const escaped = value.replace(/[\u0000-\u001f\u007f]/g, "�");
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(escaped)) return escaped.replace(/^[^/@:\s]+(?::[^@\s]+)?@/, "[user]@");
  try {
    const url = new URL(escaped);
    if (url.username || url.password) { url.username = "redacted"; url.password = ""; }
    url.search = ""; url.hash = "";
    return url.toString();
  } catch { return escaped.replace(/^[^/@:\s]+(?::[^@\s]+)?@/, "[user]@"); }
}

async function currentRepo(cwd: string, clean = false): Promise<RepositorySnapshot> {
  const repo = await repositorySnapshot(cwd);
  if (!repo) throw new Error("The repository is no longer available.");
  if (clean && repo.files.length) throw new Error("Commit or stash all changes, including untracked files, before switching branches or applying a stash.");
  return repo;
}

function savedEditors(repo: RepositorySnapshot): void {
  if (getUnsavedPathWithin(repo.repoRoot)) throw new Error("Save or close unsaved editor files in this repository before changing its working tree.");
}

async function branchName(name: string, cwd: string): Promise<void> {
  if (!name || name === "HEAD" || name.startsWith("-") || /[\u0000-\u0020\u007f]/.test(name)) throw new Error("Enter a valid branch name without spaces or control characters.");
  const out = await runGitOutput(["check-ref-format", `refs/heads/${name}`], cwd, { acceptedExitCodes: [1] });
  if (out.exit_code !== 0) throw new Error("This branch name is not valid in Git.");
}

export async function createBranch(name: string, cwd: string, startRef?: string): Promise<string> {
  await branchName(name, cwd);
  const repo = await currentRepo(cwd, true);
  savedEditors(repo);
  if (repo.unborn) throw new Error("Create the first commit before creating another branch.");
  const branches = await listBranches(cwd);
  if (branches.some((branch) => branch.ref === `refs/heads/${name}`)) throw new Error("A local branch with this name already exists.");
  if (startRef && !branches.some((branch) => branch.ref === startRef)) throw new Error("The selected starting branch changed. Refresh and select it again.");
  savedEditors(repo);
  return runGit(["switch", "--no-guess", "--no-overwrite-ignore", "--no-recurse-submodules", "-c", name, ...(startRef ? [startRef] : [])], cwd, mutation);
}

export async function switchBranch(ref: string, cwd: string): Promise<string> {
  const repo = await currentRepo(cwd, true);
  savedEditors(repo);
  const branch = (await listBranches(cwd)).find((entry) => entry.ref === ref && entry.kind === "local");
  if (!branch) throw new Error("This local branch no longer exists. Refresh the branch list.");
  if (branch.worktreePath && branch.worktreePath !== repo.repoRoot) throw new Error("This branch is checked out in another worktree. Open that worktree instead.");
  if (!repo.detached && repo.branch === branch.name) return "Already on this branch.";
  savedEditors(repo);
  return runGit(["switch", "--no-guess", "--no-overwrite-ignore", "--no-recurse-submodules", "--", branch.name], cwd, mutation);
}

export async function publishBranch(options: { branch: string; remote: string; destination: string; expectedPushUrls: string[] }, cwd: string): Promise<string> {
  await branchName(options.destination, cwd);
  const repo = await currentRepo(cwd);
  if (repo.unborn || repo.detached || repo.branch !== options.branch) throw new Error("The current branch changed or has no commit to publish. Review it again.");
  const selected = (await listRemotes(cwd)).find((remote) => remote.name === options.remote);
  if (!selected || !selected.pushUrls.length || JSON.stringify(selected.pushUrls) !== JSON.stringify(options.expectedPushUrls)) throw new Error("The remote destination changed. Review the publish addresses again.");
  return runGit(["push", "--set-upstream", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--", selected.name, `refs/heads/${options.branch}:refs/heads/${options.destination}`], cwd, mutation);
}

export async function setBranchUpstream(branch: string, remoteRef: string, cwd: string): Promise<string> {
  const repo = await currentRepo(cwd);
  if (repo.detached || repo.unborn || repo.branch !== branch) throw new Error("The current branch changed. Review its tracking configuration again.");
  const target = (await listBranches(cwd)).find((entry) => entry.ref === remoteRef && entry.kind === "remote");
  if (!target) throw new Error("This remote-tracking branch is unavailable. Fetch explicitly, then select it again.");
  return runGit(["branch", `--set-upstream-to=${target.ref}`, "--", branch], cwd, mutation);
}

export async function listStashes(cwd: string): Promise<StashEntry[]> {
  const out = await runGit(["stash", "list", "--format=%H%x00%gd%x00%gs%x00%ci%x00"], cwd);
  return records(out, 4).map(([oid, selector, subject, date]) => {
    if (!oidPattern.test(oid) || !/^stash@\{\d+\}$/.test(selector)) throw new Error("Git returned an invalid stash list.");
    return { oid, selector, subject, date };
  });
}

async function existingStash(oid: string, cwd: string): Promise<void> {
  if (!oidPattern.test(oid) || !(await listStashes(cwd)).some((entry) => entry.oid === oid)) throw new Error("The selected stash is no longer available. Refresh the list.");
}

export async function saveStash(options: { message: string; includeUntracked: boolean }, cwd: string): Promise<string> {
  const repo = await currentRepo(cwd);
  savedEditors(repo);
  if (repo.unborn) throw new Error("Git needs an initial commit before it can stash changes.");
  if (repo.files.some((file) => file.conflicted)) throw new Error("Resolve conflicts before saving a stash.");
  if (!repo.files.some((file) => options.includeUntracked || file.index !== "?")) throw new Error("There are no selected changes to stash. Include untracked files if needed.");
  if (options.message.includes("\0")) throw new Error("The stash message contains an invalid character.");
  // stash internally builds pathspecs to clean saved untracked files. A global
  // literal-pathspec setting breaks that cleanup on Apple Git. This operation
  // accepts no user-supplied paths; only the message is passed as literal argv.
  return runGit(["--no-literal-pathspecs", "stash", "push", ...(options.includeUntracked ? ["--include-untracked"] : []), "-m", options.message.trim() || "Husk saved work"], cwd, mutation);
}

export async function inspectStash(oid: string, cwd: string): Promise<string> {
  await existingStash(oid, cwd);
  return runGit(["stash", "show", "--patch", "--include-untracked", "--no-ext-diff", "--no-textconv", "--no-color", oid], cwd, { allowTruncated: true });
}

export async function applyStash(oid: string, cwd: string): Promise<string> {
  const repo = await currentRepo(cwd, true);
  savedEditors(repo);
  await existingStash(oid, cwd);
  savedEditors(repo);
  // Keep the saved copy even on success. Conflict recovery never depends on a
  // pop/drop having already destroyed the user's stash entry.
  return runGit(["stash", "apply", "--index", oid], cwd, mutation);
}
