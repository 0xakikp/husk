import { beforeEach, expect, it, vi } from "vitest";
import type { RepositorySnapshot } from "./client";
const mock = vi.hoisted(() => ({ runGit: vi.fn(), currentBranch: vi.fn(), invoke: vi.fn() }));
vi.mock("./client", () => ({ runGit: mock.runGit, currentBranch: mock.currentBranch }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
import { createReviewUrl, detectReviewProvider, loadDirectionalReview, loadHostedReview, parseReviewCommits, providerFromRemote, reviewBranch, reviewCommitPatch, reviewListUrl, safePullRequestUrl } from "./review";

const HEAD = "a".repeat(40), UPSTREAM = "b".repeat(40);
const snapshot: RepositorySnapshot = { repoRoot: "/project", branch: "feature/review", detached: false, unborn: false, upstream: "origin/feature/review", upstreamRemote: "origin", upstreamRef: "refs/heads/feature/review", upstreamGone: false, ahead: 1, behind: 0, hasRemote: true, files: [] };
const provider = providerFromRemote("git@github.com:team/project.git", "origin");
const output = (stdout = "", exit_code = 0, stderr = "") => ({ stdout, stderr, exit_code });
const rawPr = () => ({ number: 42, title: "Safe improvement", url: "https://github.com/team/project/pull/42", state: "OPEN", isDraft: false, headRefName: "feature/review", baseRefName: "main", reviewDecision: "REVIEW_REQUIRED", body: "<script>plain text</script>" });
const record = (hash = HEAD, subject = "A | useful change") => [hash, "Developer", "2026-11-07T12:00:00+05:30", subject, "\n"].join("\0");

beforeEach(() => {
  mock.currentBranch.mockReset().mockResolvedValue(snapshot.branch);
  mock.runGit.mockReset().mockImplementation(async (args: string[]) => {
    if (args[0] === "remote") return args[1] === "get-url" ? "git@github.com:team/project.git\n" : "origin\n";
    if (args[0] === "for-each-ref") return "refs/remotes/origin/feature/review\0origin/feature/review\n";
    if (args[0] === "rev-parse") return args[2]?.startsWith("refs/heads/") ? HEAD : UPSTREAM;
    if (args[0] === "log") return record();
    if (args[0] === "show") return "+changed\n";
    throw new Error(`Unexpected Git command: ${args[0]}`);
  });
  mock.invoke.mockReset().mockImplementation(async (_name: string, request: { args: string[] }) => {
    if (request.args[0] === "--version") return output("gh version 2\n");
    if (request.args[1] === "view") return output(JSON.stringify(rawPr()));
    if (request.args[1] === "checks") return output(JSON.stringify([{ name: "Build", state: "SUCCESS", bucket: "pass" }]));
    throw new Error("Unexpected CLI command");
  });
});

it("recognizes only known provider hosts and strips credentials", () => {
  const p = providerFromRemote("https://token:secret@github.com/team/project.git", "origin");
  expect(p).toMatchObject({ kind: "github", host: "github.com", repository: "team/project", webUrl: "https://github.com/team/project", supportsIssues: true });
  expect(JSON.stringify(p)).not.toMatch(/token|secret/);
  expect(providerFromRemote("ssh://git@gitlab.com/group/sub/project.git", "team").kind).toBe("gitlab");
  expect(providerFromRemote("git@github.company.example:team/project.git", "origin")).toMatchObject({ kind: "unsupported", supportsIssues: false, webUrl: null });
  expect(providerFromRemote("git@github.com.evil.example:team/project.git", "origin").kind).toBe("unsupported");
});

it.each(["/local/path", "file:///tmp/repo", "javascript:alert(1)", "https://github.com/team/project?token=secret", "https://github.com:9000/team/project", "git@github.com:team/../project", "git@github.com:team/%2fproject", "git@github-alias:team/project"])("does not invent a provider or browser action for %s", (url) => {
  const p = providerFromRemote(url, "origin"); expect(p.kind).toBe("unsupported"); expect(p.webUrl).toBeNull(); expect(createReviewUrl(p, "main")).toBeNull();
});

it("detects the tracked remote using only local reads and no CLI/network calls", async () => {
  mock.runGit.mockImplementation(async (args: string[]) => args[1] === "get-url" ? "https://gitlab.com/group/repo.git\n" : "origin\nteam\n");
  const result = await detectReviewProvider({ ...snapshot, upstreamRemote: "team" });
  expect(result).toMatchObject({ kind: "gitlab", remote: "team" });
  expect(mock.runGit).toHaveBeenLastCalledWith(["remote", "get-url", "--", "team"], "/project"); expect(mock.invoke).not.toHaveBeenCalled();
});

it("does not choose an arbitrary remote and handles no remote honestly", async () => {
  mock.runGit.mockResolvedValue("personal\ncompany\n");
  expect(await detectReviewProvider({ ...snapshot, upstreamRemote: undefined })).toMatchObject({ kind: "unsupported", remote: null });
  mock.runGit.mockResolvedValue(""); expect(await detectReviewProvider(snapshot)).toMatchObject({ kind: "none", supportsIssues: false });
});

it("encodes browser handoffs and uses the remote branch name when tracking differs", () => {
  expect(reviewBranch({ ...snapshot, upstreamRef: "refs/heads/remote-name" }, provider)).toBe("remote-name");
  expect(createReviewUrl(provider, "feature/a#b?x")).toBe("https://github.com/team/project/compare/feature%2Fa%23b%3Fx?expand=1");
  const gitlab = providerFromRemote("git@gitlab.com:group/project.git", "origin");
  const url = new URL(createReviewUrl(gitlab, "feature/new&thing")!);
  expect(url.origin).toBe("https://gitlab.com"); expect(url.pathname).toBe("/group/project/-/merge_requests/new"); expect(url.searchParams.get("merge_request[source_branch]")).toBe("feature/new&thing");
  expect(reviewListUrl(gitlab)).toBe("https://gitlab.com/group/project/-/merge_requests");
});

it.each(["http://github.com/team/project/pull/42", "https://evil.example/team/project/pull/42", "https://github.com/other/project/pull/42", "https://token@github.com/team/project/pull/42", "https://github.com/team/project/pull/43", "https://github.com/team/project/pull/42?token=abc"])("rejects an untrusted returned PR URL: %s", (url) => {
  expect(safePullRequestUrl(url, provider, 42)).toBeNull();
});

it("parses NUL commit records with pipes and rejects truncated history", () => {
  expect(parseReviewCommits(record())).toEqual([{ hash: HEAD, author: "Developer", date: "2026-11-07T12:00:00+05:30", subject: "A | useful change" }]);
  expect(parseReviewCommits(record() + record(UPSTREAM))).toHaveLength(2);
  expect(() => parseReviewCommits(record().slice(0, -2))).toThrow(/incomplete/);
  expect(() => parseReviewCommits(record("bad"))).toThrow(/invalid/);
});

it.each(["incoming", "outgoing"] as const)("pins %s comparison to local full hashes, not moving refs", async (direction) => {
  const result = await loadDirectionalReview(snapshot, direction);
  expect(result).toMatchObject({ head: HEAD, upstream: UPSTREAM, direction, limited: false });
  const expectedRange = direction === "outgoing" ? `${UPSTREAM}..${HEAD}` : `${HEAD}..${UPSTREAM}`;
  expect(mock.runGit).toHaveBeenLastCalledWith(["log", "--no-color", "--format=%H%x00%an%x00%aI%x00%s%x00", "-n", "101", expectedRange, "--"], "/project");
  expect(mock.invoke).not.toHaveBeenCalled();
});

it("limits commit lists and signals that remaining history exists", async () => {
  mock.runGit.mockImplementation(async (args: string[]) => args[0] === "for-each-ref" ? "refs/remotes/origin/feature/review\0origin/feature/review\n" : args[0] === "rev-parse" ? HEAD : Array.from({ length: 101 }, () => record()).join(""));
  const result = await loadDirectionalReview(snapshot, "incoming"); expect(result.commits).toHaveLength(100); expect(result.limited).toBe(true);
});

it("blocks stale branch and upstream comparisons", async () => {
  mock.currentBranch.mockResolvedValue("different"); await expect(loadDirectionalReview(snapshot, "outgoing")).rejects.toThrow(/branch changed/); expect(mock.runGit).not.toHaveBeenCalled();
  mock.currentBranch.mockResolvedValue(snapshot.branch); mock.runGit.mockResolvedValue("refs/remotes/other/main\0other/main\n");
  await expect(loadDirectionalReview(snapshot, "outgoing")).rejects.toThrow(/upstream changed/);
});

it("disables external diff helpers and bounds hash-only commit previews", async () => {
  await reviewCommitPatch(snapshot, HEAD);
  expect(mock.runGit).toHaveBeenCalledWith(["show", "--format=", "--no-ext-diff", "--no-textconv", "--no-color", "--root", HEAD, "--"], "/project", { allowTruncated: true });
  await expect(reviewCommitPatch(snapshot, "--output=/tmp/file")).rejects.toThrow(/valid commit/);
  mock.runGit.mockResolvedValue("a".repeat(210_000)); expect((await reviewCommitPatch(snapshot, HEAD)).length).toBeLessThan(200_100);
});

it("loads explicit read-only PR metadata and check results with native argv", async () => {
  const result = await loadHostedReview(snapshot, provider);
  expect(result).toMatchObject({ kind: "pull-request", pullRequest: { number: 42, body: "<script>plain text</script>", checks: [{ name: "Build", bucket: "pass" }], checksError: null } });
  expect(mock.invoke).toHaveBeenCalledWith("shell_run_command", expect.objectContaining({ program: "gh", cwd: "/project", args: ["pr", "view", "--repo", "github.com/team/project", "--json", "number,title,url,state,isDraft,headRefName,baseRefName,reviewDecision,body", "--", "feature/review"] }));
  expect(mock.invoke.mock.calls.some(([, call]) => /create|merge|checkout|push/.test(call.args.join(" ")))).toBe(false);
});

it("does not contact a changed remote or cancelled workspace", async () => {
  mock.runGit.mockImplementation(async (args: string[]) => args[1] === "get-url" ? "https://github.com/other/project.git" : "origin");
  await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/remote changed/); expect(mock.invoke).not.toHaveBeenCalled();
  const controller = new AbortController(); controller.abort(); await expect(loadHostedReview(snapshot, provider, controller.signal)).rejects.toThrow(/cancelled/);
});

it("distinguishes verified no-review from auth, timeout, truncation, and invalid payload failures", async () => {
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output("", 1, "no pull requests found for branch \"feature/review\""));
  expect(await loadHostedReview(snapshot, provider)).toEqual({ kind: "none" });
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output("", 4, "authentication required"));
  await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/authentication/);
  mock.invoke.mockResolvedValueOnce({ ...output(), timed_out: true }); await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/respond in time/);
  mock.invoke.mockResolvedValueOnce({ ...output(), truncated: true }); await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/incomplete/);
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output("not json")); await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/invalid/);
});

it("rejects returned review data for a different branch or repository", async () => {
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output(JSON.stringify({ ...rawPr(), headRefName: "other" })));
  await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/different repository or branch/);
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output(JSON.stringify({ ...rawPr(), url: "https://evil.example/team/project/pull/42" })));
  await expect(loadHostedReview(snapshot, provider)).rejects.toThrow(/different repository or branch/);
});

it.each([1, 8])("accepts structured failing/pending checks (exit %s), never assuming success", async (code) => {
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output(JSON.stringify(rawPr()))).mockResolvedValueOnce(output(JSON.stringify([{ name: "Build", state: code === 1 ? "FAILURE" : "IN_PROGRESS", bucket: code === 1 ? "fail" : "pending" }]), code));
  const result = await loadHostedReview(snapshot, provider);
  expect(result.kind === "pull-request" && result.pullRequest.checks?.[0]?.bucket).toBe(code === 1 ? "fail" : "pending");
});

it("preserves PR metadata but does not claim passing checks when checks fail to load", async () => {
  mock.invoke.mockResolvedValueOnce(output("gh version")).mockResolvedValueOnce(output(JSON.stringify(rawPr()))).mockResolvedValueOnce(output("", 1, "connection failed"));
  const result = await loadHostedReview(snapshot, provider);
  expect(result).toMatchObject({ kind: "pull-request", pullRequest: { number: 42, checks: null, checksError: expect.stringContaining("does not mean checks passed") } });
});
