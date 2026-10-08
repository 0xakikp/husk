import { afterEach, expect, it, vi } from "vitest";
import {
  runInActiveTerminal,
  runInActiveTerminalResult,
  setActiveTerminalRunner,
  type TerminalRunFailureReason,
} from "./terminalContext";

afterEach(() => setActiveTerminalRunner(null));

it("reports a missing runner without attempting a write", () => {
  expect(runInActiveTerminalResult("git status")).toEqual({ ok: false, reason: "no-terminal" });
  expect(runInActiveTerminal("git status")).toBe(false);
});

it.each<TerminalRunFailureReason>([
  "no-terminal", "terminal-unavailable", "terminal-busy", "input-present", "prompt-unverified", "write-failed",
])("preserves the registry's %s refusal without retrying", (reason) => {
  const result = { ok: false as const, reason, message: "The live target refused this command." };
  const runner = vi.fn(() => result);
  setActiveTerminalRunner(runner);
  expect(runInActiveTerminalResult("git status")).toBe(result);
  expect(runner).toHaveBeenCalledExactlyOnceWith("git status");
  expect(runInActiveTerminal("git status")).toBe(false);
  expect(runner).toHaveBeenCalledTimes(2);
});

it("preserves successful delivery and the boolean compatibility API", () => {
  const runner = vi.fn(() => ({ ok: true as const }));
  setActiveTerminalRunner(runner);
  expect(runInActiveTerminalResult("git status")).toEqual({ ok: true });
  expect(runInActiveTerminal("pnpm test")).toBe(true);
  expect(runner.mock.calls).toEqual([["git status"], ["pnpm test"]]);
});

it("reports a synchronous write failure without retrying or leaking the thrown error", () => {
  const runner = vi.fn(() => { throw new Error("native details"); });
  setActiveTerminalRunner(runner);
  expect(runInActiveTerminalResult("git status")).toEqual({ ok: false, reason: "write-failed" });
  expect(runner).toHaveBeenCalledTimes(1);
});

it("uses the currently registered terminal and does not fall back to a stale one", () => {
  const first = vi.fn(() => ({ ok: true as const }));
  const second = vi.fn(() => ({ ok: false as const, reason: "prompt-unverified" as const }));
  setActiveTerminalRunner(first);
  setActiveTerminalRunner(second);
  expect(runInActiveTerminalResult("git status")).toEqual({ ok: false, reason: "prompt-unverified" });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
  setActiveTerminalRunner(null);
  expect(runInActiveTerminalResult("git status")).toEqual({ ok: false, reason: "no-terminal" });
  expect(second).toHaveBeenCalledTimes(1);
});
