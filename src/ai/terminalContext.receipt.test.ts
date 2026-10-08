import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interruptTerminalRun, publishTerminalCommandRun, runInActiveTerminalResult,
  setActiveTerminalPtyId, setActiveTerminalRunner, setTerminalRunInterrupter,
  subscribeTerminalCommandRuns, subscribeTerminalState,
} from "./terminalContext";

afterEach(() => {
  setActiveTerminalRunner(null);
  setTerminalRunInterrupter(null);
  setActiveTerminalPtyId(null);
});

describe("terminal receipt public API", () => {
  it("notifies terminal selection changes even without a cwd/host change, but not repeated ids", () => {
    const changed = vi.fn();
    const unsubscribe = subscribeTerminalState(changed);
    try {
      setActiveTerminalPtyId(7);
      setActiveTerminalPtyId(7);
      setActiveTerminalPtyId(8);
      setActiveTerminalPtyId(null);
      setActiveTerminalPtyId(null);
      expect(changed).toHaveBeenCalledTimes(3);
    } finally { unsubscribe(); }
  });

  it("preserves the registry receipt on accepted commands", () => {
    setActiveTerminalRunner(() => ({ ok: true, runId: "session:run:1" }));
    expect(runInActiveTerminalResult("git status")).toEqual({ ok: true, runId: "session:run:1" });
  });

  it("preserves receipt metadata in completion events without adding identity to manual commands", () => {
    const subscriber = vi.fn();
    const unsubscribe = subscribeTerminalCommandRuns(subscriber);
    const manual = { command: "git status", output: "clean", exitCode: 0, at: 200, terminalPtyId: 7, cwd: "/project" };
    const accepted = { ...manual, runId: "session:run:1", startedAt: 123 };
    try {
      publishTerminalCommandRun(accepted);
      publishTerminalCommandRun(manual);
      expect(subscriber.mock.calls).toEqual([[accepted], [manual]]);
      expect(subscriber.mock.calls[1][0]).not.toHaveProperty("runId");
    } finally { unsubscribe(); }
  });

  it("keeps the expected PTY when focus changes instead of redirecting an interrupt", () => {
    const interrupt = vi.fn(() => true);
    setTerminalRunInterrupter(interrupt);
    setActiveTerminalPtyId(99);
    expect(interruptTerminalRun("session:run:1", 7)).toBe(true);
    expect(interrupt).toHaveBeenCalledExactlyOnceWith("session:run:1", 7);
  });

  it.each([["", 7], ["receipt", -1], ["receipt", 1.5], ["receipt", NaN]] as const)(
    "rejects malformed receipt/PTY input without calling the registry: %s/%s", (runId, ptyId) => {
      const interrupt = vi.fn(() => true);
      setTerminalRunInterrupter(interrupt);
      expect(interruptTerminalRun(runId, ptyId)).toBe(false);
      expect(interrupt).not.toHaveBeenCalled();
    },
  );

  it("fails closed without a handler, on refusal, or on an ambiguous exception without retrying", () => {
    expect(interruptTerminalRun("receipt", 7)).toBe(false);
    const refuse = vi.fn(() => false);
    setTerminalRunInterrupter(refuse);
    expect(interruptTerminalRun("receipt", 7)).toBe(false);
    expect(refuse).toHaveBeenCalledTimes(1);
    const failed = vi.fn(() => { throw new Error("unavailable"); });
    setTerminalRunInterrupter(failed);
    expect(interruptTerminalRun("receipt", 7)).toBe(false);
    expect(failed).toHaveBeenCalledTimes(1);
  });
});
