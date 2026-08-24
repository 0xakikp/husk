import { describe, expect, it } from "vitest";
import { getTerminalRunDecision, getWorkspaceRunDecision } from "./commandRun";

describe("Composer terminal Run", () => {
  it("allows a short explicit shell command", () => {
    expect(getTerminalRunDecision("sh", "pnpm test")).toEqual({ runnable: true, command: "pnpm test" });
  });

  it("never treats source code as a terminal command", () => {
    expect(getTerminalRunDecision("javascript", "console.log('hello')")).toMatchObject({ runnable: false });
  });

  it("keeps multi-line shell scripts copy-only", () => {
    expect(getTerminalRunDecision("bash", "echo first\necho second")).toMatchObject({ runnable: false });
  });

  it("keeps unlabelled blocks copy-only", () => {
    expect(getTerminalRunDecision("", "git status")).toMatchObject({ runnable: false });
  });
});

describe("Composer workspace target", () => {
  it("allows the selected workspace and any directory inside it", () => {
    expect(getWorkspaceRunDecision("/work/husk", "/work/husk")).toMatchObject({ ready: true });
    expect(getWorkspaceRunDecision("/work/husk", "/work/husk/src/ai")).toMatchObject({ ready: true });
  });

  it("blocks sibling directories even when they share a prefix", () => {
    expect(getWorkspaceRunDecision("/work/husk", "/work/husk-old")).toMatchObject({
      ready: false,
      reason: "workspace-mismatch",
    });
  });

  it("reports when no terminal directory is available", () => {
    expect(getWorkspaceRunDecision("/work/husk", "")).toMatchObject({
      ready: false,
      reason: "no-terminal",
    });
  });

  it("allows a terminal when the chat has no selected workspace", () => {
    expect(getWorkspaceRunDecision(null, "/tmp")).toMatchObject({ ready: true });
  });
});
