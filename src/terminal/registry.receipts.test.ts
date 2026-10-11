// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ writes: [] as { ptyId: number; data: string }[], nextPtyId: 40, accept: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined), convertFileSrc: (path: string) => path }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => "", syncWorkspaceRootToCwd: vi.fn() }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: vi.fn(async () => undefined) }));
vi.mock("./sessionWake", () => ({ installTerminalWakeChecks: () => () => {}, mayRestoreTerminalFocus: () => false }));
vi.mock("./sessionLifecycle", async importOriginal => {
  const original = await importOriginal<typeof import("./sessionLifecycle")>();
  return {
    ...original,
    TerminalSessionConnection: class {
      id = ++fixture.nextPtyId;
      status = { state: "ready" };
      constructor(_transport: unknown, _onData: unknown, private onChange: () => void) {}
      async start() { this.onChange(); }
      async check() {}
      write(data: string) {
        if (!fixture.accept) return false;
        fixture.writes.push({ ptyId: this.id, data });
        return true;
      }
      async restart(beforeStart?: () => void) { beforeStart?.(); this.id = ++fixture.nextPtyId; this.onChange(); }
      dispose() {}
    },
  };
});

import { checkSessionHealth, createSession, disposeSession, getSessionHandle, restartSession, setSessionActive, setSessionVisible, submitTrackedTerminalCommand } from "./registry";
import { invoke } from "@tauri-apps/api/core";
import { captureScreenCommandTarget, stageScreenCommand } from "./stageScreenCommand";
import {
  interruptTerminalRun, runInActiveTerminalResult, setActiveTerminalPtyId, setActiveTerminalRunner,
  subscribeTerminalCommandRuns, type ObservedCommandRun,
} from "../ai/terminalContext";

const leaves: number[] = [];
const subscriptions: (() => void)[] = [];
let nextLeaf = 0;
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const leaf of leaves.splice(0)) disposeSession(leaf);
  setActiveTerminalRunner(null);
  setActiveTerminalPtyId(null);
  fixture.writes = [];
  fixture.accept = true;
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
});

const osc = (id: number, data: string) => `\x1b]${id};${data}\x07`;
const nativeWrites = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "pty_write");
async function setup() {
  const leaf = ++nextLeaf;
  leaves.push(leaf);
  const session = await createSession(leaf, "/project");
  const write = (text: string) => new Promise<void>(resolve => session.term.write(text, resolve));
  await write(osc(7, "file://local/project") + "❯ " + osc(133, "B"));
  setSessionActive(leaf, true);
  const completed: ObservedCommandRun[] = [];
  subscriptions.push(subscribeTerminalCommandRuns(run => completed.push(run)));
  const start = (command: string) => write(osc(778, `husk;cmd;${command}`) + osc(133, "C") + "\r\n");
  const finish = () => write("clean\r\n" + osc(133, "D;0") + "❯ " + osc(133, "B"));
  return { leaf, session, write, start, finish, completed };
}

describe("registry receipt integration without native shell processes", () => {
  it("preserves actual scrollback across tiny wake/layout measurements, then resumes ordinary resizing", async () => {
    const { leaf, session, write } = await setup();
    session.term.resize(120, 30);
    await write(Array.from({ length: 100 }, (_, i) => `LINE${String(i).padStart(3, "0")} ${"x".repeat(90)}\r\n`).join(""));
    session.term.scrollToTop();
    const history = getSessionHandle(leaf)!.getBuffer(1000);
    const beforeLength = session.term.buffer.normal.length;
    const host = document.createElement("div");
    document.body.append(host);
    Object.defineProperties(host, { clientWidth: { value: 1000 }, clientHeight: { value: 600 } });
    session.container = host;
    const measure = vi.spyOn(session.fitAddon, "proposeDimensions").mockReturnValue({ cols: 2, rows: 1 });
    const refit = vi.spyOn(session.fitAddon, "fit");
    const resize = vi.spyOn(session.term, "resize");
    try {
      setSessionVisible(leaf, true);
      await checkSessionHealth(leaf);
      getSessionHandle(leaf)!.resize();
      expect(resize).not.toHaveBeenCalled();
      expect(session.term.buffer.normal.length).toBe(beforeLength);
      expect(session.term.buffer.normal.viewportY).toBe(0);
      expect(getSessionHandle(leaf)!.getBuffer(1000)).toBe(history);
      expect(session.lastWidth).toBe(-1);

      measure.mockReturnValue({ cols: 100, rows: 25 });
      await checkSessionHealth(leaf);
      expect(resize).toHaveBeenCalledExactlyOnceWith(100, 25);
      expect(refit).not.toHaveBeenCalled();
      expect(getSessionHandle(leaf)!.getBuffer(1000)).toBe(history);
      expect(session.term.buffer.normal.baseY).toBeGreaterThan(0);
      expect(session.term.buffer.normal.viewportY).toBeLessThan(session.term.buffer.normal.baseY);
      expect(nativeWrites()).toEqual([]);
      expect(fixture.writes).toEqual([]);
      expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "pty_resize").slice(-1)[0])
        .toEqual(["pty_resize", { id: session.ptyId, cols: 100, rows: 25 }]);
    } finally { host.remove(); }
  });

  it("ignores hidden, detached and invalid geometry without invalidating the prompt", async () => {
    const { leaf, session } = await setup();
    const host = document.createElement("div");
    Object.defineProperties(host, { clientWidth: { value: 1000 }, clientHeight: { value: 600 } });
    session.container = host;
    const measure = vi.spyOn(session.fitAddon, "proposeDimensions").mockReturnValue({ cols: 100, rows: 25 });
    const resize = vi.spyOn(session.term, "resize");
    try {
      setSessionVisible(leaf, true);
      expect(measure).not.toHaveBeenCalled(); // Detached/parked host.
      document.body.append(host);
      setSessionVisible(leaf, false);
      getSessionHandle(leaf)!.resize();
      expect(measure).not.toHaveBeenCalled();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      setSessionVisible(leaf, true);
      await checkSessionHealth(leaf);
      expect(resize).not.toHaveBeenCalled();
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      for (const dims of [{ cols: NaN, rows: 24 }, { cols: 80, rows: Infinity }, { cols: 80.5, rows: 24 }, { cols: 19, rows: 24 }, { cols: 80, rows: 2 }]) {
        measure.mockReturnValue(dims);
        getSessionHandle(leaf)!.resize();
      }
      expect(resize).not.toHaveBeenCalled();
      expect(getSessionHandle(leaf)!.getPromptReadiness()).toEqual({ ready: true });
      measure.mockReturnValue({ cols: 100, rows: 25 });
      getSessionHandle(leaf)!.resize();
      expect(resize).toHaveBeenCalledExactlyOnceWith(100, 25);
      expect(session.term.buffer.active.viewportY).toBe(session.term.buffer.active.baseY);
      expect(getSessionHandle(leaf)!.getPromptReadiness()).toEqual({ ready: true });
    } finally { host.remove(); }
  });

  it("tracks awaited native workflow writes before output can arrive, without a duplicate write", async () => {
    const { leaf, session, start, finish, completed } = await setup();
    const target = captureScreenCommandTarget(leaf)!;
    let runId = "";
    const result = submitTrackedTerminalCommand(leaf, { ...target, ptyId: target.ptyId! }, "git status", receipt => {
      expect(nativeWrites()).toEqual([]);
      runId = receipt;
    });
    expect(runId).not.toBe("");
    expect(runInActiveTerminalResult("git log")).toMatchObject({ ok: false, reason: "terminal-busy" });
    await start("git status");
    await finish();
    expect(await result).toBe(runId);
    expect(completed[0]).toMatchObject({ runId, command: "git status" });
    expect(nativeWrites()).toEqual([["pty_write", { id: session.ptyId, data: "git status\r" }]]);
    expect(fixture.writes).toEqual([]);
  });

  it.each(["scope", "input", "control"])("refuses tracked writes after %s changes", async kind => {
    const { leaf, write } = await setup();
    const captured = captureScreenCommandTarget(leaf)!;
    const target = { ...captured, ptyId: captured.ptyId! };
    if (kind === "scope") target.scopeToken += ":stale";
    if (kind === "input") await write("draft");
    const onQueued = vi.fn();
    await expect(submitTrackedTerminalCommand(leaf, target, kind === "control" ? "git status\nwhoami" : "git status", onQueued)).rejects.toThrow();
    expect(onQueued).not.toHaveBeenCalled();
    expect(nativeWrites()).toEqual([]);
  });

  it("awaits native rejection and does not retain the rejected write's receipt", async () => {
    const { leaf, start, finish, completed } = await setup();
    const captured = captureScreenCommandTarget(leaf)!;
    vi.mocked(invoke).mockImplementation(async command => {
      if (command === "pty_write") throw new Error("write disconnected");
      return undefined;
    });
    await expect(submitTrackedTerminalCommand(leaf, { ...captured, ptyId: captured.ptyId! }, "git status", () => {})).rejects.toThrow("write disconnected");
    await start("git status"); await finish();
    expect(completed[0].runId).toBeUndefined();
  });

  it("does not let a late native rejection cancel a newer receipt", async () => {
    const { leaf, start, finish, completed } = await setup();
    const captured = captureScreenCommandTarget(leaf)!;
    let rejectWrite!: (reason: Error) => void;
    vi.mocked(invoke).mockImplementation(command => command === "pty_write"
      ? new Promise((_resolve, reject) => { rejectWrite = reject; }) : Promise.resolve(undefined));
    const first = submitTrackedTerminalCommand(leaf, { ...captured, ptyId: captured.ptyId! }, "git status", () => {});
    await start("git status"); await finish();
    const second = runInActiveTerminalResult("git log");
    expect(second.ok).toBe(true);
    rejectWrite(new Error("late rejection"));
    await expect(first).rejects.toThrow("late rejection");
    await start("git log"); await finish();
    expect(completed[1].runId).toBe(second.ok ? second.runId : "missing receipt");
  });

  it("stages a history command at the left prompt despite a second B marking right-prompt text", async () => {
    const { leaf, session, write } = await setup();
    const target = captureScreenCommandTarget(leaf);
    expect(target).not.toBeNull();
    await write("\x1b[50G" + osc(133, "P;k=r") + "12:34" + osc(133, "B") + "\x1b[3G");
    expect(getSessionHandle(leaf)!.getPromptReadiness()).toEqual({ ready: true });
    await stageScreenCommand(leaf, target, "git status");
    expect(nativeWrites()).toEqual([["pty_write", { id: session.ptyId, data: "git status" }]]);
    expect(fixture.writes).toEqual([]);
  });

  it("still refuses an unknown prompt and inserts only after a real fresh boundary", async () => {
    const { leaf, session, write } = await setup();
    const target = captureScreenCommandTarget(leaf);
    await write("\x1b[2K");
    await expect(stageScreenCommand(leaf, target, "git status")).rejects.toThrow("cannot verify an empty shell prompt");
    expect(nativeWrites()).toEqual([]);
    await write("\r❯ " + osc(133, "B"));
    await stageScreenCommand(leaf, target, "git status");
    expect(nativeWrites()).toEqual([["pty_write", { id: session.ptyId, data: "git status" }]]);
  });

  it("does not reuse right-prompt evidence after manual typing, even before echo arrives", async () => {
    const { leaf, write } = await setup();
    const target = captureScreenCommandTarget(leaf);
    await write("\x1b[50G" + osc(133, "P;k=r") + "12:34" + osc(133, "B") + "\x1b[3G");
    getSessionHandle(leaf)!.write("draft");
    await expect(stageScreenCommand(leaf, target, "git status")).rejects.toThrow();
    expect(nativeWrites()).toEqual([]);
  });

  it("returns a receipt before preexec, blocks duplicate queued runs, and emits it on exact completion", async () => {
    const { session, start, finish, completed } = await setup();
    const result = runInActiveTerminalResult("git status");
    expect(result).toMatchObject({ ok: true, runId: expect.any(String) });
    expect(runInActiveTerminalResult("git log")).toMatchObject({ ok: false, reason: "terminal-busy" });
    await start("git status");
    await finish();
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({ command: "git status", terminalPtyId: session.ptyId, ...(result.ok ? { runId: result.runId } : {}) });
    expect(fixture.writes).toEqual([{ ptyId: session.ptyId, data: "git status\r" }]);
  });

  it("never associates a mismatching or later identical manual command with the queued receipt", async () => {
    const { start, finish, completed } = await setup();
    runInActiveTerminalResult("git status");
    await start("git diff");
    await finish();
    await start("git status");
    await finish();
    expect(completed).toHaveLength(2);
    expect(completed.every(run => run.runId === undefined)).toBe(true);
  });

  it("interrupts the original running receipt after switching tabs, never the newly active PTY", async () => {
    const first = await setup();
    const result = runInActiveTerminalResult("git status");
    if (!result.ok || !result.runId || first.session.ptyId === null) throw new Error("Missing accepted receipt");
    expect(interruptTerminalRun(result.runId, first.session.ptyId)).toBe(false);
    await first.start("git status");
    setSessionActive(first.leaf, false);
    const second = await setup();
    expect(interruptTerminalRun(result.runId, second.session.ptyId!)).toBe(false);
    expect(interruptTerminalRun(result.runId, first.session.ptyId)).toBe(true);
    expect(interruptTerminalRun(result.runId, first.session.ptyId)).toBe(false);
    expect(fixture.writes).toEqual([
      { ptyId: first.session.ptyId, data: "git status\r" },
      { ptyId: first.session.ptyId, data: "\x03" },
    ]);
    await first.finish();
    expect(interruptTerminalRun(result.runId, first.session.ptyId)).toBe(false);
  });

  it.each(["pending", "running"])("retires the %s receipt after manual input", async state => {
    const { leaf, session, start, finish, completed } = await setup();
    const result = runInActiveTerminalResult("git status");
    if (!result.ok || !result.runId || session.ptyId === null) throw new Error("Missing accepted receipt");
    if (state === "running") await start("git status");
    getSessionHandle(leaf)!.write("x");
    if (state === "pending") await start("git status");
    expect(interruptTerminalRun(result.runId, session.ptyId)).toBe(false);
    await finish();
    expect(completed[0].runId).toBeUndefined();
  });

  it("does not keep a failed write or a restarted process's receipt", async () => {
    const { leaf, session, start, finish, completed } = await setup();
    fixture.accept = false;
    expect(runInActiveTerminalResult("git status")).toEqual({ ok: false, reason: "write-failed" });
    fixture.accept = true;
    await start("git status");
    await finish();
    expect(completed[0].runId).toBeUndefined();
    const result = runInActiveTerminalResult("git status");
    if (!result.ok || !result.runId || session.ptyId === null) throw new Error("Missing accepted receipt");
    await start("git status");
    const oldPty = session.ptyId;
    await restartSession(leaf);
    expect(session.ptyId).not.toBe(oldPty);
    expect(interruptTerminalRun(result.runId, oldPty)).toBe(false);
    expect(interruptTerminalRun(result.runId, session.ptyId!)).toBe(false);
  });

  it("refuses interruption and completion identity after target scope changes", async () => {
    const { session, start, write, finish, completed } = await setup();
    const result = runInActiveTerminalResult("git status");
    if (!result.ok || !result.runId || session.ptyId === null) throw new Error("Missing accepted receipt");
    await start("git status");
    await write(osc(7, "file://another-host/project"));
    expect(interruptTerminalRun(result.runId, session.ptyId)).toBe(false);
    await finish();
    expect(completed[0].runId).toBeUndefined();
    expect(fixture.writes).toHaveLength(1);
  });
});
