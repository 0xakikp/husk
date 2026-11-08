import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), root: "/selected", record: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => mock.root }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: mock.record }));
import { parseStatus, parseStructuredLog, repositorySnapshot, status, stageFiles, unstageFiles, stagePaths, filePaths, commit, push, pull, diffFile, diffUntrackedFile, listIssues, isRepo } from "./client";

const output = (stdout = "", patch = {}) => ({ stdout, stderr: "", exit_code: 0, timed_out: false, truncated: false, ...patch });
const headOid = "a".repeat(40);
function respond(_name: string, request: { args: string[] }) {
  const args = request.args.slice(2);
  if (args[0] === "symbolic-ref") return output("feature\n");
  if (args[0] === "rev-parse") return output(args.includes("--is-inside-work-tree") ? "true\n" : args.includes("--show-toplevel") ? "/repo\n" : `${headOid}\n`);
  if (args[0] === "status") return output("MM file name\0?? :(glob)*\0");
  if (args[0] === "remote") return output("upstream\n");
  if (args[0] === "for-each-ref") return output("refs/remotes/upstream/review\0upstream/review\0upstream\0refs/heads/review\n");
  if (args[0] === "rev-list") return output("2\t0\n");
  return output();
}
beforeEach(() => { mock.invoke.mockReset().mockImplementation(respond); mock.record.mockReset().mockResolvedValue(true); mock.root = "/selected"; });

describe("Git status", () => {
  it("preserves NUL-separated quoted, Unicode, newline and renamed filenames", () => {
    const files = parseStatus('MM space "name"\0R  新 file\0old\nfile\0?? :(glob)*\0 D deleted\0UU conflicted\0AA added-both\0');
    expect(files[0]).toMatchObject({ path: 'space "name"', staged: true, unstaged: true, conflicted: false });
    expect(files[1]).toMatchObject({ path: "新 file", originalPath: "old\nfile", staged: true, unstaged: false });
    expect(files[2].path).toBe(":(glob)*"); expect(files[3]).toMatchObject({ path: "deleted", unstaged: true, staged: false });
    expect(files.slice(4).every((file) => file.conflicted && !file.staged)).toBe(true);
  });
  it("rejects incomplete status instead of displaying a falsely clean or partial tree", async () => {
    for (const text of [" M file", "invalid\0", "R  new\0", "XY file\0"]) expect(() => parseStatus(text)).toThrow();
    mock.invoke.mockResolvedValue(output(" M file\0", { truncated: true })); await expect(status("/repo")).rejects.toThrow("incomplete");
    mock.invoke.mockResolvedValue(output("", { stderr: "Permission denied", exit_code: 128 })); await expect(status("/repo")).rejects.toThrow("Permission denied");
  });
  it("distinguishes missing repositories from permission and timeout failures", async () => {
    mock.invoke.mockResolvedValueOnce(output("", { stderr: "fatal: not a git repository", exit_code: 128 })); expect(await isRepo("/tmp")).toBe(false);
    mock.invoke.mockResolvedValueOnce(output("", { stderr: "Permission denied", exit_code: 128 })); await expect(isRepo("/repo")).rejects.toThrow("Permission denied");
    mock.invoke.mockResolvedValueOnce(output("", { timed_out: true })); await expect(isRepo("/repo")).rejects.toThrow("timed out");
  });
  it("returns the canonical root, actual upstream and both file states", async () => {
    expect(await repositorySnapshot("/repo/nested")).toMatchObject({ repoRoot: "/repo", branch: "feature", upstream: "upstream/review", ahead: 2, behind: 0, detached: false, unborn: false, hasRemote: true });
    expect(mock.invoke.mock.calls.filter(([, request]) => request.args.includes("status"))[0][1].cwd).toBe("/repo");
  });
  it("does not invent tracking for a first commit or detached HEAD", async () => {
    mock.invoke.mockImplementation((name, request) => request.args.includes("--verify") ? output("", { exit_code: 1 }) : respond(name, request));
    expect(await repositorySnapshot("/repo")).toMatchObject({ unborn: true, branch: "feature", upstream: null });
    mock.invoke.mockImplementation((name, request) => request.args.includes("symbolic-ref") ? output("", { exit_code: 1 }) : respond(name, request));
    expect(await repositorySnapshot("/repo")).toMatchObject({ detached: true, branch: headOid.slice(0, 8), upstream: null });
  });
});
describe("Scoped Git actions", () => {
  it("uses literal argv paths and an explicit cwd for one atomic bulk action", async () => {
    await stageFiles([':(glob)*', 'file "quoted"', "-leading", "line\nfile", ":(glob)*"], "/reviewed");
    expect(mock.invoke).toHaveBeenCalledTimes(1);
    expect(mock.invoke).toHaveBeenCalledWith("shell_run_command", expect.objectContaining({ cwd: "/reviewed", args: ["--no-pager", "--literal-pathspecs", "add", "--all", "--", ":(glob)*", 'file "quoted"', "-leading", "line\nfile"] }));
  });
  it("rejects out-of-repository and whole-root pathspecs", async () => {
    for (const path of ["", "..", "a/../b", "/absolute", ".", "bad\0name"]) await expect(stageFiles([path], "/repo")).rejects.toThrow();
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("supports unstage before the first commit without deleting working files", async () => {
    mock.invoke.mockImplementation((name, request) => request.args.includes("--verify") ? output("", { exit_code: 1 }) : respond(name, request));
    await unstageFiles(["new file"], "/repo");
    expect(mock.invoke).toHaveBeenLastCalledWith("shell_run_command", expect.objectContaining({ args: ["--no-pager", "--literal-pathspecs", "rm", "--cached", "-f", "--ignore-unmatch", "--", "new file"], cwd: "/repo" }));
  });
  it("stages only the destination of an already staged rename but unstages both sides", () => {
    const file = parseStatus("RM new\0old\0")[0];
    expect(stagePaths(file)).toEqual(["new"]); expect(filePaths(file)).toEqual(["new", "old"]);
  });
  it("preserves commit message arguments and attributes Timeline to the committed repo", async () => {
    const message = "Fix 'quotes'\n\n$(do not execute)";
    await commit(message, "/reviewed");
    expect(mock.invoke).toHaveBeenCalledWith("shell_run_command", expect.objectContaining({ cwd: "/reviewed", args: ["--no-pager", "--literal-pathspecs", "commit", "-m", message] }));
    expect(mock.record).toHaveBeenCalledWith("git", "Committed Fix 'quotes'", undefined, { workspaceRoot: "/reviewed" });
  });
  it("pushes only HEAD to the displayed upstream, without force or implicit extra branches/tags", async () => {
    await push("/repo");
    expect(mock.invoke).toHaveBeenLastCalledWith("shell_run_command", expect.objectContaining({ args: ["--no-pager", "--literal-pathspecs", "push", "--no-force", "--no-follow-tags", "--recurse-submodules=no", "--", "upstream", "HEAD:refs/heads/review"], cwd: "/repo" }));
  });
  it("pulls fast-forward only, without implicit rebase or autostash", async () => {
    await pull("/repo");
    expect(mock.invoke).toHaveBeenLastCalledWith("shell_run_command", expect.objectContaining({ args: ["--no-pager", "--literal-pathspecs", "pull", "--ff-only", "--no-rebase", "--no-autostash", "--", "upstream", "refs/heads/review"] }));
  });
  it("reports an unknown mutation outcome after timeout, without retry", async () => {
    mock.invoke.mockResolvedValue(output("", { timed_out: true, exit_code: null }));
    await expect(stageFiles(["file"], "/repo")).rejects.toThrow("may have completed"); expect(mock.invoke).toHaveBeenCalledTimes(1);
  });
  it("disables external diff/textconv execution and handles untracked no-index exit 1", async () => {
    await diffFile("new", true, "/repo", "old");
    expect(mock.invoke).toHaveBeenLastCalledWith("shell_run_command", expect.objectContaining({ args: ["--no-pager", "--literal-pathspecs", "diff", "--no-ext-diff", "--no-textconv", "--no-color", "--src-prefix=a/", "--dst-prefix=b/", "--unified=3", "--no-relative", "--cached", "--", "new", "old"] }));
    mock.invoke.mockResolvedValue(output("+new content", { exit_code: 1 })); expect(await diffUntrackedFile("new", "/repo")).toBe("+new content");
  });
  it("reports inaccessible untracked files instead of presenting an empty diff", async () => {
    mock.invoke.mockResolvedValue(output("", { exit_code: 1, stderr: "error: Could not access 'missing.txt'" }));
    await expect(diffUntrackedFile("missing.txt", "/repo")).rejects.toThrow("Could not access");
    mock.invoke.mockResolvedValue(output(""));
    expect(await diffUntrackedFile("empty.txt", "/repo")).toBe("");
  });
});
describe("History and issues", () => {
  it("parses subjects/authors with pipes, binary changes, and renamed paths", () => {
    const text = ["", "HUSK_COMMIT", headOid, "aaaaaaa", "fix | pipes", "Dev | Name", "dev@example.com", "2026-11-06", "\n2\t1\tfile", "-\t-\timage.png", "0\t0\t", "old", "new", ""].join("\0");
    expect(parseStructuredLog(text)).toEqual([{ hash: headOid, shortHash: "aaaaaaa", subject: "fix | pipes", authorName: "Dev | Name", authorEmail: "dev@example.com", date: "2026-11-06", filesChanged: 3, insertions: 2, deletions: 1 }]);
  });
  it("validates issue payloads and requests actual URLs", async () => {
    const issue = { number: 1, title: "Issue", url: "https://git.example/team/repo/issues/1", author: null, state: "OPEN", createdAt: "2026-11-06", labels: [] };
    mock.invoke.mockResolvedValue(output(JSON.stringify([issue]))); expect(await listIssues("/repo")).toEqual({ kind: "ok", issues: [issue] });
    expect(mock.invoke).toHaveBeenLastCalledWith("shell_run_command", expect.objectContaining({ cwd: "/repo", args: expect.arrayContaining(["number,title,url,author,state,createdAt,labels"]) }));
    for (const bad of [{}, null, [{ ...issue, author: 2 }], [{ ...issue, url: "file:///etc/passwd" }], [{ ...issue, labels: [{ name: "bad", color: "nothex" }] }]]) {
      mock.invoke.mockResolvedValue(output(JSON.stringify(bad))); expect((await listIssues("/repo")).kind).toBe("error");
    }
  });
});
