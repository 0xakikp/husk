import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ git: vi.fn(), output: vi.fn(), snapshot: vi.fn(), unsaved: vi.fn() }));
vi.mock("./client", () => ({ runGit: mock.git, runGitOutput: mock.output, repositorySnapshot: mock.snapshot }));
vi.mock("../editor/dirtyStore", () => ({ getUnsavedPathWithin: mock.unsaved }));
import { listBranches, listRemotes, createBranch, switchBranch, publishBranch, setBranchUpstream, listStashes, inspectStash, saveStash, applyStash, displayRemoteUrl } from "./workspaceActions";
import type { RepositorySnapshot } from "./client";
const oid = "a".repeat(40);
const anotherOid = "b".repeat(40);
const repo = (patch: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({ repoRoot: "/repo", branch: "main", unborn: false, detached: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0, hasRemote: true, files: [], ...patch });
const branchRow = (ref: string, worktree = "", symbolic = "") => `${ref}\0${oid}\0${symbolic}\0${worktree}\0\0\n`;
const stashRow = (hash = oid, selector = "stash@{0}") => [hash, selector, "On main: saved | work", "2026-11-07 12:00:00 +0000", "\n"].join("\0");
function read(args: string[]) {
  if (args[0] === "for-each-ref") return branchRow("refs/heads/main", "/repo") + branchRow("refs/heads/feature") + branchRow("refs/heads/occupied", "/other") + branchRow("refs/remotes/team/review");
  if (args[0] === "remote" && args.length === 1) return "team\n";
  if (args[0] === "remote") return "https://git.example/team/project.git\n";
  if (args[0] === "stash" && args[1] === "list") return stashRow();
  return "";
}
beforeEach(() => {
  mock.git.mockReset().mockImplementation(read); mock.output.mockReset().mockResolvedValue({ stdout: "", stderr: "", exit_code: 0 });
  mock.snapshot.mockReset().mockResolvedValue(repo()); mock.unsaved.mockReset().mockReturnValue(null);
});

describe("local branch workflows", () => {
  it("reads local/remote refs and worktree ownership without network", async () => {
    const rows = await listBranches("/repo");
    expect(rows.find((row) => row.name === "occupied")).toMatchObject({ kind: "local", worktreePath: "/other" });
    expect(rows.find((row) => row.name === "team/review")).toMatchObject({ kind: "remote", ref: "refs/remotes/team/review" });
    expect(mock.git).toHaveBeenCalledTimes(1);
  });
  it("keeps newline worktree paths and drops symbolic remote HEAD aliases", async () => {
    mock.git.mockResolvedValue(branchRow("refs/heads/branch", "/a\npath") + branchRow("refs/remotes/team/HEAD", "", "refs/remotes/team/main"));
    expect(await listBranches("/repo")).toHaveLength(1);
    expect((await listBranches("/repo"))[0].worktreePath).toBe("/a\npath");
    mock.git.mockResolvedValue("incomplete"); await expect(listBranches("/repo")).rejects.toThrow("incomplete");
  });
  it("creates without force, ignoring neither ignored files nor other worktrees", async () => {
    await createBranch("feature/new", "/repo", "refs/remotes/team/review");
    expect(mock.git).toHaveBeenLastCalledWith(["switch", "--no-guess", "--no-overwrite-ignore", "--no-recurse-submodules", "-c", "feature/new", "refs/remotes/team/review"], "/repo", expect.objectContaining({ mutation: true }));
    await switchBranch("refs/heads/feature", "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["switch", "--no-guess", "--no-overwrite-ignore", "--no-recurse-submodules", "--", "feature"], "/repo", expect.anything());
    await expect(switchBranch("refs/heads/occupied", "/repo")).rejects.toThrow("another worktree");
    await expect(switchBranch("refs/remotes/team/review", "/repo")).rejects.toThrow("local branch");
  });
  it("blocks dirty or unsaved models, unborn starts, invalid names and duplicate branches", async () => {
    mock.snapshot.mockResolvedValue(repo({ files: [{ path: "dirty", index: "?", work: "?", staged: false, unstaged: true, conflicted: false }] }));
    await expect(createBranch("new", "/repo")).rejects.toThrow("Commit or stash");
    mock.snapshot.mockResolvedValue(repo()); mock.unsaved.mockReturnValue("/repo/open.txt");
    await expect(switchBranch("refs/heads/feature", "/repo")).rejects.toThrow("unsaved editor");
    mock.unsaved.mockReturnValue(null); mock.snapshot.mockResolvedValue(repo({ unborn: true }));
    await expect(createBranch("new", "/repo")).rejects.toThrow("first commit");
    mock.snapshot.mockResolvedValue(repo());
    for (const name of ["", "-force", "name\nline", "HEAD"]) await expect(createBranch(name, "/repo")).rejects.toThrow();
    await expect(createBranch("main", "/repo")).rejects.toThrow("already exists");
    mock.output.mockResolvedValue({ exit_code: 1 }); await expect(createBranch("bad..name", "/repo")).rejects.toThrow("not valid");
    expect(mock.git.mock.calls.some(([args]) => args[0] === "switch")).toBe(false);
  });
});

describe("reviewed publish/tracking", () => {
  const options = { branch: "main", remote: "team", destination: "review", expectedPushUrls: ["https://git.example/team/project.git"] };
  it("reads configured addresses locally and strips credentials in presentation", async () => {
    expect(await listRemotes("/repo")).toEqual([{ name: "team", fetchUrls: options.expectedPushUrls, pushUrls: options.expectedPushUrls }]);
    expect(displayRemoteUrl("https://user:password@git.example/project?token=secret#token")).toBe("https://redacted@git.example/project");
    expect(displayRemoteUrl("user:password@git.example:path")).not.toContain("password");
  });
  it("publishes only an explicitly reviewed branch/remote and sets upstream", async () => {
    await publishBranch(options, "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["push", "--set-upstream", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--", "team", "refs/heads/main:refs/heads/review"], "/repo", expect.objectContaining({ mutation: true }));
  });
  it("refuses a retargeted remote or branch instead of sending to a new destination", async () => {
    await expect(publishBranch({ ...options, expectedPushUrls: ["https://different.example/repo"] }, "/repo")).rejects.toThrow("destination changed");
    mock.snapshot.mockResolvedValue(repo({ branch: "other" })); await expect(publishBranch(options, "/repo")).rejects.toThrow("current branch changed");
    expect(mock.git.mock.calls.some(([args]) => args[0] === "push")).toBe(false);
  });
  it("changes tracking only to an existing remote ref, without network", async () => {
    await setBranchUpstream("main", "refs/remotes/team/review", "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["branch", "--set-upstream-to=refs/remotes/team/review", "--", "main"], "/repo", expect.anything());
    await expect(setBranchUpstream("main", "refs/heads/feature", "/repo")).rejects.toThrow("remote-tracking");
  });
});

describe("stash workflows", () => {
  const dirty = { path: "file", index: " ", work: "M", staged: false, unstaged: true, conflicted: false };
  it("parses stable object identities, previews safely and applies without popping", async () => {
    expect((await listStashes("/repo"))[0]).toMatchObject({ oid, selector: "stash@{0}", subject: "On main: saved | work" });
    await inspectStash(oid, "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["stash", "show", "--patch", "--include-untracked", "--no-ext-diff", "--no-textconv", "--no-color", oid], "/repo", { allowTruncated: true });
    mock.git.mockImplementation((args) => args[0] === "stash" && args[1] === "list" ? stashRow(anotherOid) + stashRow(oid, "stash@{1}") : read(args));
    await applyStash(oid, "/repo"); expect(mock.git).toHaveBeenLastCalledWith(["stash", "apply", "--index", oid], "/repo", expect.anything());
    expect(mock.git.mock.calls.some(([args]) => args.includes("pop") || args.includes("drop"))).toBe(false);
  });
  it("rejects missing OIDs and dirty application targets", async () => {
    await expect(applyStash(anotherOid, "/repo")).rejects.toThrow("no longer available");
    await expect(inspectStash("stash@{0}", "/repo")).rejects.toThrow("no longer available");
    mock.snapshot.mockResolvedValue(repo({ files: [dirty] })); await expect(applyStash(oid, "/repo")).rejects.toThrow("Commit or stash");
  });
  it("includes untracked files only by explicit choice and never includes ignored files", async () => {
    mock.snapshot.mockResolvedValue(repo({ files: [dirty] })); await saveStash({ message: "My work", includeUntracked: false }, "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["--no-literal-pathspecs", "stash", "push", "-m", "My work"], "/repo", expect.anything());
    await saveStash({ message: "", includeUntracked: true }, "/repo");
    expect(mock.git).toHaveBeenLastCalledWith(["--no-literal-pathspecs", "stash", "push", "--include-untracked", "-m", "Husk saved work"], "/repo", expect.anything());
    expect(mock.git.mock.calls.some(([args]) => args.includes("--all"))).toBe(false);
  });
  it("blocks unsaved models, conflicts, first commits and unselected untracked-only changes", async () => {
    mock.snapshot.mockResolvedValue(repo({ files: [dirty] })); mock.unsaved.mockReturnValue("/repo/file"); await expect(saveStash({ message: "", includeUntracked: false }, "/repo")).rejects.toThrow("unsaved editor");
    mock.unsaved.mockReturnValue(null); mock.snapshot.mockResolvedValue(repo({ files: [{ ...dirty, conflicted: true }] })); await expect(saveStash({ message: "", includeUntracked: false }, "/repo")).rejects.toThrow("Resolve conflicts");
    mock.snapshot.mockResolvedValue(repo({ unborn: true })); await expect(saveStash({ message: "", includeUntracked: false }, "/repo")).rejects.toThrow("initial commit");
    mock.snapshot.mockResolvedValue(repo({ files: [{ ...dirty, index: "?", work: "?" }] })); await expect(saveStash({ message: "", includeUntracked: false }, "/repo")).rejects.toThrow("no selected changes");
  });
});
