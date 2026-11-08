import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), cwd: "" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => mock.cwd }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: vi.fn(async () => true) }));
import { repositorySnapshot, status, stageFiles, unstageFiles, commit, structuredLog, diffFile, diffUntrackedFile, filePaths, stagePaths, push, pull } from "./client";

// Real Git, only in disposable repositories: no user's worktree, hooks,
// credentials, global configuration or network remotes are involved.
let fixture: string; let cwd: string;
function git(args: string[], directory = cwd) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", ...args], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exit_code: result.status, timed_out: Boolean(result.error), truncated: false };
}
function setup(args: string[], directory = cwd) { const result = git(args, directory); if (result.exit_code !== 0) throw new Error(result.stderr || "Fixture Git command failed"); return result.stdout; }
beforeEach(() => {
  fixture = realpathSync(mkdtempSync(join(tmpdir(), "husk-git-fixture-"))); cwd = join(fixture, "work"); mkdirSync(cwd); mock.cwd = cwd;
  setup(["init", "--template=", "--initial-branch=main"]);
  setup(["config", "user.name", "Test | Developer"]); setup(["config", "user.email", "test@example.invalid"]);
  mock.invoke.mockReset().mockImplementation(async (command, args) => {
    if (command !== "shell_run_command" || args.program !== "git" || !String(args.cwd).startsWith(fixture + "/")) throw new Error("Fixture forbids unrelated commands and directories");
    return git(args.args, args.cwd);
  });
});
afterEach(() => { if (!fixture.includes("husk-git-fixture-")) throw new Error("Invalid fixture cleanup target"); rmSync(fixture, { recursive: true, force: true }); });

it("works before the first commit and preserves working files when unstaging", async () => {
  writeFileSync(join(cwd, "new file"), "content\n");
  expect(await repositorySnapshot(cwd)).toMatchObject({ branch: "main", unborn: true, upstream: null });
  expect(await diffUntrackedFile("new file", cwd)).toContain("+content");
  await stageFiles(["new file"], cwd); expect((await status(cwd))[0]).toMatchObject({ index: "A", staged: true });
  writeFileSync(join(cwd, "new file"), "edited after staging\n"); await unstageFiles(["new file"], cwd);
  expect(readFileSync(join(cwd, "new file"), "utf8")).toBe("edited after staging\n"); expect((await status(cwd))[0]).toMatchObject({ index: "?", staged: false });
});
it("does not mistake a missing untracked file for a successful empty diff", async () => {
  await expect(diffUntrackedFile("no-longer-here.txt", cwd)).rejects.toThrow();
  writeFileSync(join(cwd, "empty.txt"), "");
  await expect(diffUntrackedFile("empty.txt", cwd)).resolves.toContain("new file mode");
});
it("keeps pathspec magic literal and round-trips unusual filenames", async () => {
  for (const name of [":(glob)*", "other", 'quote "name"', "ユニコード", "line\nbreak", "-leading"]) writeFileSync(join(cwd, name), "content\n");
  await stageFiles([":(glob)*"], cwd);
  expect((await status(cwd)).filter((file) => file.staged).map((file) => file.path)).toEqual([":(glob)*"]);
  await stageFiles(['quote "name"', "ユニコード", "line\nbreak", "-leading"], cwd);
  expect((await status(cwd)).filter((file) => file.staged)).toHaveLength(5);
  expect((await status(cwd)).find((file) => file.path === "other")?.staged).toBe(false);
});
it("previews partially staged files on the requested side and handles staged renames", async () => {
  writeFileSync(join(cwd, "old name"), "original\n"); await stageFiles(["old name"], cwd); await commit("Initial | subject", cwd);
  renameSync(join(cwd, "old name"), join(cwd, "new name")); await stageFiles(["old name", "new name"], cwd);
  writeFileSync(join(cwd, "new name"), "original\nworking-only\n");
  const renamed = (await status(cwd))[0]; expect(renamed).toMatchObject({ path: "new name", originalPath: "old name", index: "R", work: "M", staged: true, unstaged: true });
  expect(await diffFile(renamed.path, false, cwd)).toContain("+working-only");
  expect(await diffFile(renamed.path, true, cwd, renamed.originalPath)).toContain("rename from old name");
  await stageFiles(stagePaths(renamed), cwd); await unstageFiles(filePaths(renamed), cwd);
  expect((await status(cwd)).every((file) => !file.staged)).toBe(true); expect(readFileSync(join(cwd, "new name"), "utf8")).toContain("working-only");
});
it("parses real NUL-delimited commit statistics including pipes and renames", async () => {
  writeFileSync(join(cwd, "one"), "first\nsecond\n"); await stageFiles(["one"], cwd); await commit("Initial | subject", cwd);
  renameSync(join(cwd, "one"), join(cwd, "renamed")); await stageFiles(["one", "renamed"], cwd); await commit("Rename | safe", cwd);
  const entries = await structuredLog(30, cwd);
  expect(entries.map((entry) => entry.subject)).toEqual(["Rename | safe", "Initial | subject"]);
  expect(entries[0]).toMatchObject({ authorName: "Test | Developer", filesChanged: 1, insertions: 0, deletions: 0 });
  expect(entries[1]).toMatchObject({ filesChanged: 1, insertions: 2, deletions: 0 });
});
it("targets the configured upstream explicitly despite matching push defaults", async () => {
  const remote = join(fixture, "remote.git"); mkdirSync(remote); setup(["init", "--bare", "--template=", "--initial-branch=main"], remote);
  writeFileSync(join(cwd, "one"), "first\n"); await stageFiles(["one"], cwd); await commit("Initial", cwd);
  setup(["remote", "add", "origin", remote]); setup(["push", "--set-upstream", "origin", "HEAD:main"]);
  setup(["config", "push.default", "matching"]); setup(["config", "remote.pushDefault", "not-a-remote"]);
  writeFileSync(join(cwd, "one"), "next\n"); await stageFiles(["one"], cwd); await commit("Next", cwd);
  expect(await repositorySnapshot(cwd)).toMatchObject({ upstream: "origin/main", ahead: 1, behind: 0 });
  await push(cwd); expect(await repositorySnapshot(cwd)).toMatchObject({ ahead: 0, behind: 0 });
  await pull(cwd); expect(setup(["status", "--porcelain"])).toBe("");
});
