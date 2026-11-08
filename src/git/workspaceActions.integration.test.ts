import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ invoke: vi.fn(), cwd: "" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => mock.cwd }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: vi.fn(async () => true) }));
import { repositorySnapshot } from "./client";
import { listBranches, listRemotes, createBranch, switchBranch, publishBranch, setBranchUpstream, listStashes, saveStash, inspectStash, applyStash } from "./workspaceActions";

// Every write is isolated beneath a newly-created temporary directory. Never
// load the developer's hooks, credentials, global Git config or network remotes.
let fixture: string; let cwd: string;
function git(args: string[], directory = cwd) {
  const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", "commit.gpgSign=false", ...args], {
    cwd: directory, encoding: "utf8", timeout: 10000,
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0" },
  });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exit_code: result.status, timed_out: Boolean(result.error), truncated: false };
}
function setup(args: string[], directory = cwd) { const result = git(args, directory); if (result.exit_code !== 0) throw new Error(result.stderr); return result.stdout; }
beforeEach(() => {
  fixture = realpathSync(mkdtempSync(join(tmpdir(), "husk-git-actions-"))); cwd = join(fixture, "work"); mkdirSync(cwd); mock.cwd = cwd;
  setup(["init", "--template=", "--initial-branch=main"]); setup(["config", "user.name", "Fixture"]); setup(["config", "user.email", "fixture@example.invalid"]);
  writeFileSync(join(cwd, "tracked.txt"), "initial\n"); setup(["add", "--", "tracked.txt"]); setup(["commit", "-m", "Initial"]);
  mock.invoke.mockReset().mockImplementation(async (command, request) => {
    if (command !== "shell_run_command" || request.program !== "git" || !String(request.cwd).startsWith(fixture + "/")) throw new Error("Fixture rejects unrelated commands/directories");
    return git(request.args, request.cwd);
  });
});
afterEach(() => { if (!fixture.includes("husk-git-actions-")) throw new Error("Invalid fixture cleanup target"); rmSync(fixture, { recursive: true, force: true }); });

it("creates and switches branches while protecting dirty files and other worktrees", async () => {
  await createBranch("feature", cwd); expect((await repositorySnapshot(cwd))?.branch).toBe("feature");
  await switchBranch("refs/heads/main", cwd); expect((await repositorySnapshot(cwd))?.branch).toBe("main");
  setup(["worktree", "add", "--", join(fixture, "second"), "feature"]);
  expect((await listBranches(cwd)).find((branch) => branch.name === "feature")?.worktreePath).toBe(join(fixture, "second"));
  await expect(switchBranch("refs/heads/feature", cwd)).rejects.toThrow("another worktree");
  writeFileSync(join(cwd, "tracked.txt"), "work\n"); await expect(createBranch("blocked", cwd)).rejects.toThrow("Commit or stash");
  expect(readFileSync(join(cwd, "tracked.txt"), "utf8")).toBe("work\n");
});
it("publishes only to a reviewed local bare remote and can configure existing upstream", async () => {
  const remotePath = join(fixture, "remote.git"); mkdirSync(remotePath); setup(["init", "--bare", "--template=", "--initial-branch=main"], remotePath);
  setup(["remote", "add", "team", remotePath]);
  const remotes = await listRemotes(cwd); expect(remotes[0].pushUrls).toEqual([remotePath]);
  await publishBranch({ branch: "main", remote: "team", destination: "published", expectedPushUrls: remotes[0].pushUrls }, cwd);
  expect((await repositorySnapshot(cwd))?.upstream).toBe("team/published");
  await createBranch("second", cwd); await setBranchUpstream("second", "refs/remotes/team/published", cwd);
  expect((await repositorySnapshot(cwd))?.upstream).toBe("team/published");
  expect(setup(["for-each-ref", "--format=%(refname)", "refs/heads"], remotePath)).toBe("refs/heads/published\n");
});
it("refuses to overwrite ignored local files when switching branches", async () => {
  writeFileSync(join(cwd, ".gitignore"), "ignored.txt\n"); setup(["add", "--", ".gitignore"]); setup(["commit", "-m", "Ignore local file"]);
  await createBranch("with-file", cwd); writeFileSync(join(cwd, "ignored.txt"), "tracked in other branch\n"); setup(["add", "-f", "--", "ignored.txt"]); setup(["commit", "-m", "Track file"]);
  await switchBranch("refs/heads/main", cwd); writeFileSync(join(cwd, "ignored.txt"), "private local contents\n");
  await expect(switchBranch("refs/heads/with-file", cwd)).rejects.toThrow();
  expect(readFileSync(join(cwd, "ignored.txt"), "utf8")).toBe("private local contents\n");
});
it("saves tracked/untracked changes explicitly and applies by OID while preserving the stash", async () => {
  writeFileSync(join(cwd, "tracked.txt"), "edited\n"); setup(["add", "--", "tracked.txt"]); writeFileSync(join(cwd, "new.txt"), "untracked\n"); writeFileSync(join(cwd, ":(glob)*"), "literal pathspec filename\n");
  await saveStash({ message: "Review | later", includeUntracked: true }, cwd);
  const stashes = await listStashes(cwd); expect(stashes).toHaveLength(1); expect(stashes[0].subject).toContain("Review | later");
  expect((await repositorySnapshot(cwd))?.files).toEqual([]);
  expect(await inspectStash(stashes[0].oid, cwd)).toContain("+untracked");
  await applyStash(stashes[0].oid, cwd);
  expect(readFileSync(join(cwd, "tracked.txt"), "utf8")).toBe("edited\n"); expect(readFileSync(join(cwd, "new.txt"), "utf8")).toBe("untracked\n");
  expect(readFileSync(join(cwd, ":(glob)*"), "utf8")).toBe("literal pathspec filename\n");
  expect((await repositorySnapshot(cwd))?.files.find((file) => file.path === "tracked.txt")?.staged).toBe(true);
  expect((await listStashes(cwd))[0].oid).toBe(stashes[0].oid);
});
