import { describe, expect, it } from "vitest";
import {
  appendAiTaskEvent,
  createAiTask,
  deriveAiTaskStages,
  isVerificationCommand,
  restoreAiTask,
  taskModeSystemContext,
  taskCommandFingerprint,
  taskProgress,
} from "./taskMode";

describe("AI Task Mode", () => {
  it("creates a scoped running task with grounded context", () => {
    const task = createAiTask("Fix login", "/work/app", { projectReady: true, now: 10 });
    expect(task.status).toBe("running");
    expect(task.workspacePath).toBe("/work/app");
    expect(deriveAiTaskStages(task)[0]).toMatchObject({ state: "complete" });
    expect(taskModeSystemContext(task)).toContain("Fix login");
  });

  it("deduplicates persistent evidence and derives review/check states", () => {
    let task = createAiTask("Repair tests", "/work/app", { projectReady: true, now: 10 });
    task = appendAiTaskEvent(task, { id: "edit-1", type: "edit-proposed", label: "a.ts", state: "review", at: 11 });
    task = appendAiTaskEvent(task, { id: "edit-1", type: "edit-proposed", label: "a.ts", state: "review", at: 12 });
    task = appendAiTaskEvent(task, { id: "check-1", type: "check", label: "pnpm test", state: "failed", at: 13, exitCode: 1 });
    expect(task.events.filter((event) => event.id === "edit-1")).toHaveLength(1);
    expect(deriveAiTaskStages(task).map((stage) => stage.state)).toEqual(["complete", "pending", "review", "failed"]);
    expect(taskProgress(task)).toBeGreaterThan(40);
  });

  it("pauses unfinished work when restored after restart", () => {
    const running = createAiTask("Upgrade dependencies", "/work/app", { now: 10 });
    expect(restoreAiTask(running, 20)?.status).toBe("paused");
    expect(restoreAiTask({ nope: true }, 20)).toBeUndefined();
  });

  it("recognizes common verification commands without treating every command as a check", () => {
    expect(isVerificationCommand("pnpm test")).toBe(true);
    expect(isVerificationCommand("cargo clippy")).toBe(true);
    expect(isVerificationCommand("python -m pytest tests/unit")).toBe(true);
    expect(isVerificationCommand("brew install ripgrep")).toBe(false);
    expect(isVerificationCommand("ls -la")).toBe(false);
    expect(taskCommandFingerprint(" pnpm   test ")).toBe(taskCommandFingerprint("pnpm test"));
  });

  it("keeps the changes stage in review while any proposal is still waiting", () => {
    let task = createAiTask("Update files", "/work/app", { now: 10 });
    task = appendAiTaskEvent(task, { id: "edit-applied", type: "edit-applied", label: "a.ts", state: "complete", at: 11 });
    task = appendAiTaskEvent(task, { id: "edit-waiting", type: "edit-proposed", label: "b.ts", state: "review", at: 12 });
    expect(deriveAiTaskStages(task)[2]).toMatchObject({ state: "review", detail: "1 to review" });
  });
});
