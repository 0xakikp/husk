import { describe, expect, it, vi } from "vitest";
import { TerminalRunReceipts, type TerminalRunTarget } from "./runReceipts";

const local: TerminalRunTarget = {
  ptyId: 7, sessionId: "session-1", generation: 3, cwd: "/project",
  isRemote: false, remoteTarget: null, observedHost: null,
};

function running(target = local) {
  const receipts = new TerminalRunReceipts();
  const runId = receipts.queue("git status", target);
  receipts.preexec("git status", target, 123);
  return { receipts, runId };
}

describe("exact terminal run receipts", () => {
  it("attaches one receipt to the first exact trimmed preexec and consumes it on completion", () => {
    const receipts = new TerminalRunReceipts();
    const runId = receipts.queue("  git status  ", local);
    expect(receipts.hasPending).toBe(true);
    receipts.preexec("git status\n", local, 123);
    expect(receipts.hasPending).toBe(false);
    expect(receipts.complete(" git status ", local)).toEqual({ runId, startedAt: 123 });
    expect(receipts.complete("git status", local)).toBeUndefined();
    receipts.preexec("git status", local, 456);
    expect(receipts.complete("git status", local)).toBeUndefined();
  });

  it("never matches a later identical manual command after the first preexec differs", () => {
    const receipts = new TerminalRunReceipts();
    receipts.queue("git status", local);
    receipts.preexec("git status --short", local, 123);
    expect(receipts.complete("git status --short", local)).toBeUndefined();
    receipts.preexec("git status", local, 456);
    expect(receipts.complete("git status", local)).toBeUndefined();
  });

  it("does not retain a running receipt across another preexec, even for identical text", () => {
    const { receipts, runId } = running();
    receipts.preexec("git status", local, 456);
    expect(receipts.interrupt(runId, local, vi.fn(() => true))).toBe(false);
    expect(receipts.complete("git status", local)).toBeUndefined();
  });

  it("assigns unique ids to repeated accepted commands and separate session trackers", () => {
    const first = new TerminalRunReceipts();
    const second = new TerminalRunReceipts();
    const ids = [first.queue("git status", local), first.queue("git status", local), second.queue("git status", local)];
    expect(new Set(ids).size).toBe(3);
  });

  it("retires queued input on intervening keystrokes instead of matching a later command", () => {
    const receipts = new TerminalRunReceipts();
    receipts.queue("git status", local);
    receipts.clear();
    receipts.preexec("git status", local, 123);
    expect(receipts.complete("git status", local)).toBeUndefined();
  });

  it("does not attach a receipt without preexec or after a fresh prompt/restart/failed write", () => {
    for (const clear of [false, true]) {
      const receipts = new TerminalRunReceipts();
      receipts.queue("git status", local);
      if (clear) receipts.clear();
      expect(receipts.complete("git status", local)).toBeUndefined();
      receipts.preexec("git status", local, 123);
      expect(receipts.complete("git status", local)).toBeUndefined();
    }
    const { receipts, runId } = running();
    receipts.clear();
    expect(receipts.interrupt(runId, local, vi.fn(() => true))).toBe(false);
    expect(receipts.complete("git status", local)).toBeUndefined();
  });

  it("copies the accepted scope so mutable session fields cannot rewrite receipt provenance", () => {
    const receipts = new TerminalRunReceipts();
    const target = { ...local };
    receipts.queue("git status", target);
    target.ptyId = 99;
    receipts.preexec("git status", target, 123);
    expect(receipts.complete("git status", target)).toBeUndefined();
  });

  it.each<Partial<TerminalRunTarget>>([
    { ptyId: 8 }, { sessionId: "session-2" }, { generation: 4 }, { cwd: "/other" },
    { isRemote: true }, { remoteTarget: "remote" }, { observedHost: "remote" }, { observedHost: undefined },
  ])("refuses changed target at preexec, interruption, and completion: %j", change => {
    const changed = { ...local, ...change };
    const pending = new TerminalRunReceipts();
    pending.queue("git status", local);
    pending.preexec("git status", changed, 123);
    expect(pending.complete("git status", changed)).toBeUndefined();
    const { receipts, runId } = running();
    const write = vi.fn(() => true);
    expect(receipts.interrupt(runId, changed, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(receipts.complete("git status", changed)).toBeUndefined();
  });
});

describe("receipt-bound Ctrl+C", () => {
  it("interrupts exactly the running command once, without clearing its completion receipt", () => {
    const { receipts, runId } = running();
    const write = vi.fn(() => true);
    expect(receipts.interrupt(runId, local, write)).toBe(true);
    expect(receipts.interrupt(runId, local, write)).toBe(false);
    expect(write).toHaveBeenCalledExactlyOnceWith("\x03");
    expect(receipts.complete("git status", local)).toEqual({ runId, startedAt: 123 });
    expect(receipts.interrupt(runId, local, write)).toBe(false);
  });

  it("refuses pending, missing, or another command's receipt without writing", () => {
    const receipts = new TerminalRunReceipts();
    const runId = receipts.queue("git status", local);
    const write = vi.fn(() => true);
    expect(receipts.interrupt(runId, local, write)).toBe(false);
    receipts.preexec("git status", local, 123);
    expect(receipts.interrupt("other-run", local, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([false, "throw"])("does not retry an ambiguous interrupt write failure: %s", failure => {
    const { receipts, runId } = running();
    const write = vi.fn(() => { if (failure === "throw") throw new Error("write failed"); return false; });
    expect(receipts.interrupt(runId, local, write)).toBe(false);
    expect(receipts.interrupt(runId, local, write)).toBe(false);
    expect(write).toHaveBeenCalledExactlyOnceWith("\x03");
  });

  it.each<Partial<TerminalRunTarget>>([
    { observedHost: undefined },
    { observedHost: "remote", isRemote: false },
    { observedHost: null, isRemote: true, remoteTarget: "remote" },
    { observedHost: "remote", isRemote: true, remoteTarget: null },
  ])("refuses initially unknown or inconsistent remote provenance: %j", change => {
    const target = { ...local, ...change };
    const { receipts, runId } = running(target);
    const write = vi.fn(() => true);
    expect(receipts.interrupt(runId, target, write)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });

  it("can interrupt an unchanged verified remote target but not a changed host", () => {
    const remote = { ...local, isRemote: true, remoteTarget: "server", observedHost: "server" };
    const { receipts, runId } = running(remote);
    const write = vi.fn(() => true);
    expect(receipts.interrupt(runId, { ...remote, remoteTarget: "other-server" }, write)).toBe(false);
    expect(receipts.interrupt(runId, remote, write)).toBe(true);
    expect(write).toHaveBeenCalledExactlyOnceWith("\x03");
  });
});
