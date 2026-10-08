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

import { createSession, disposeSession, getSessionHandle, restartSession, setSessionActive } from "./registry";
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
});

const osc = (id: number, data: string) => `\x1b]${id};${data}\x07`;
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
