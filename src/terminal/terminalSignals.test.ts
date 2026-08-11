import { afterEach, describe, expect, it } from "vitest";

import { clearGitActivity, getGitActivity, gitActionFor, recordGitActivity } from "./gitActivityStore";
import { clearPorts, extractLocalDevUrls, getPorts, recordPorts } from "./portStore";
import { clearSensitiveOutput, getSensitiveOutput, recordSensitiveOutput } from "./sensitiveOutputStore";
import { clearTask, completeTask, getTask, MIN_TASK_VISIBLE_MS, startTask } from "./taskStore";

const leaf = 9_245;

afterEach(() => {
  clearTask(leaf);
  clearPorts(leaf);
  clearGitActivity(leaf);
  clearSensitiveOutput(leaf);
});

describe("terminal context signals", () => {
  it("keeps successful long tasks with their original terminal leaf", () => {
    startTask(leaf, { command: "pnpm build", cwd: "/work/husk", at: 100 });
    completeTask(leaf, {
      command: "pnpm build",
      cwd: "/work/husk",
      exitCode: 0,
      at: 100 + MIN_TASK_VISIBLE_MS + 1,
    });

    expect(getTask(leaf)).toMatchObject({
      command: "pnpm build",
      completedAt: 100 + MIN_TASK_VISIBLE_MS + 1,
      exitCode: 0,
    });
  });

  it("does not retain quick or failed tasks beside a failure strip", () => {
    startTask(leaf, { command: "pnpm test", cwd: "/work/husk", at: 100 });
    completeTask(leaf, { command: "pnpm test", cwd: "/work/husk", exitCode: 0, at: 101 });
    expect(getTask(leaf)).toBeNull();

    startTask(leaf, { command: "pnpm test", cwd: "/work/husk", at: 100 });
    completeTask(leaf, { command: "pnpm test", cwd: "/work/husk", exitCode: 1, at: 9_000 });
    expect(getTask(leaf)).toBeNull();
  });

  it("recognises only contextual local development URLs", () => {
    expect(extractLocalDevUrls("pnpm dev", "Local: http://localhost:5173/")).toEqual([
      "http://localhost:5173/",
    ]);
    expect(extractLocalDevUrls("curl http://localhost:3000", "ok")).toEqual([]);

    recordPorts(leaf, { command: "pnpm dev", urls: ["http://localhost:5173/"] });
    expect(getPorts(leaf)?.urls).toEqual(["http://localhost:5173/"]);
  });

  it("summarises meaningful Git mutations, not read-only Git commands", () => {
    expect(gitActionFor("git commit -m 'ship it'")).toBe("committed");
    expect(gitActionFor("git status --short")).toBeNull();

    recordGitActivity(leaf, { command: "git push", cwd: "/work/husk", exitCode: 0, at: 10 });
    expect(getGitActivity(leaf)).toMatchObject({ action: "pushed", cwd: "/work/husk" });
  });

  it("records only a local warning reason when output looks sensitive", () => {
    recordSensitiveOutput(leaf, {
      command: "printenv",
      output: "GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456",
      at: 10,
    });
    expect(getSensitiveOutput(leaf)).toMatchObject({
      command: "printenv",
      reasons: ["GitHub token"],
    });
  });
});
