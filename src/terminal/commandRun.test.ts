import { describe, expect, it } from "vitest";
import { getTerminalRunDecision } from "./commandRun";

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
