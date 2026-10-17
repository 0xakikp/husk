// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ nextPtyId: 70, writes: [] as string[] }));
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
      write(data: string) { fixture.writes.push(data); return true; }
      async restart(beforeStart?: () => void) { beforeStart?.(); this.id = ++fixture.nextPtyId; this.onChange(); }
      dispose() {}
    },
  };
});

import { invoke } from "@tauri-apps/api/core";
import {
  createSession, detachSession, disposeSession, openTerminalLogs, registerTerminalLogsOpener,
  restartSession, setSessionActive, setSessionVisible,
} from "./registry";
import { getTerminalStatus, subscribeTerminalStatus } from "./statusBarState";

const leaves: number[] = [];
const subscriptions: (() => void)[] = [];
let nextLeaf = 400;
afterEach(() => {
  for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
  for (const leaf of leaves.splice(0)) disposeSession(leaf);
  fixture.writes = [];
  vi.mocked(invoke).mockClear();
});
const osc = (id: number, data: string) => `\x1b]${id};${data}\x07`;
async function setup(cwd = "/project") {
  const leaf = ++nextLeaf;
  leaves.push(leaf);
  const session = await createSession(leaf, "/launch-guess");
  const write = (text: string) => new Promise<void>(resolve => session.term.write(text, resolve));
  const prompt = (path = cwd, host = "local") => write(osc(7, `file://${host}${path}`) + "❯ " + osc(133, "B"));
  const start = (command: string) => write(osc(778, `husk;cmd;${command}`) + osc(133, "C") + "\r\n");
  const finish = (code = 0) => write("result\r\n" + osc(133, `D;${code}`) + "❯ " + osc(133, "B"));
  return { leaf, session, write, prompt, start, finish };
}

describe("registry status bar observations without native probes", () => {
  it("does not infer a local scope or cwd from launch options and does not emit for output", async () => {
    const { leaf, write, prompt } = await setup();
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "unknown", cwd: null, atPrompt: false });
    await prompt();
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "local", cwd: "/project", atPrompt: true });
    const updated = vi.fn();
    subscriptions.push(subscribeTerminalStatus(leaf, updated));
    const before = getTerminalStatus(leaf);
    await write("some ordinary output\r\nmore output\r\n");
    expect(getTerminalStatus(leaf)).toBe(before);
    expect(updated).not.toHaveBeenCalled();
    expect(fixture.writes).toEqual([]);
    expect(vi.mocked(invoke).mock.calls.every(([command]) => command === "pty_resize")).toBe(true);
  });

  it("keeps commands, durations and results with their originating terminal while tabs switch", async () => {
    const one = await setup("/one"); const two = await setup("/two");
    await one.prompt(); await two.prompt();
    setSessionActive(one.leaf, true);
    await one.start("npm test");
    const startedAt = getTerminalStatus(one.leaf)!.startedAt!;
    const other = getTerminalStatus(two.leaf);
    setSessionActive(one.leaf, false); setSessionVisible(one.leaf, false); detachSession(one.leaf);
    setSessionActive(two.leaf, true);
    await one.finish(2);
    expect(getTerminalStatus(two.leaf)).toBe(other);
    expect(getTerminalStatus(one.leaf)).toMatchObject({ command: "", startedAt: null, atPrompt: true, cwd: "/one" });
    expect(getTerminalStatus(one.leaf)?.lastRun).toMatchObject({ command: "npm test", exitCode: 2 });
    expect(getTerminalStatus(one.leaf)?.recentTools).toEqual([{ id: "cli:npm", seenAt: startedAt }]);
    expect(getTerminalStatus(two.leaf)?.recentTools).toEqual([]);
    const run = getTerminalStatus(one.leaf)!.lastRun!;
    expect(run.durationMs).toBe(run.at - startedAt);
    const complete = getTerminalStatus(one.leaf);
    expect(await createSession(one.leaf, "/new-guess")).toBe(one.session);
    setSessionVisible(one.leaf, true); setSessionActive(one.leaf, true);
    expect(getTerminalStatus(one.leaf)).toBe(complete);
  });

  it("does not retain local cwd on SSH and stays remote after remote commands reset the UI flag", async () => {
    const { leaf, session, start, prompt, finish, write } = await setup();
    await prompt(); await start("ssh deploy@server");
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "remote", host: "deploy@server", cwd: null, command: "ssh deploy@server" });
    await write(osc(7, "file://server/remote") + osc(133, "B"));
    await start("kubectl get pods"); await finish(0);
    expect(session.isRemoteShell).toBe(false);
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "remote", host: "server", cwd: "/remote", lastRun: { command: "kubectl get pods", exitCode: 0 } });
    await prompt("/restored-local");
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "local", host: null, cwd: "/restored-local", lastRun: null });
    expect(getTerminalStatus(leaf)?.recentTools).toEqual([]);
    expect(fixture.writes).toEqual([]);
  });

  it("clears a pending SSH attempt on return and only accepts a freshly observed local cwd", async () => {
    const { leaf, start, prompt, finish } = await setup();
    await prompt(); await start("ssh unreachable"); await finish(255);
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "local", cwd: null, lastRun: null });
    await prompt("/after-ssh");
    expect(getTerminalStatus(leaf)?.cwd).toBe("/after-ssh");
  });

  it("ends the connecting activity at a verified remote prompt even when SSH target equals hostname", async () => {
    const { leaf, start, prompt, write } = await setup();
    await prompt(); await start("ssh server");
    expect(getTerminalStatus(leaf)?.command).toBe("ssh server");
    await write(osc(7, "file://server/remote") + "❯ " + osc(133, "B"));
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "remote", host: "server", atPrompt: true, command: "", startedAt: null, lastRun: null });
  });

  it("uses bridge remote evidence even before any local host was observed", async () => {
    const { leaf, write, start, finish } = await setup();
    await write(osc(777, "husk;remote;1") + osc(7, "file://server/remote") + osc(133, "B"));
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "remote", cwd: "/remote" });
    await start("docker ps"); await finish();
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "remote", cwd: "/remote", lastRun: { command: "docker ps" } });
    await write(osc(777, "husk;remote;0"));
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "unknown", cwd: null, lastRun: null });
  });

  it("resets a restarted shell and removes disposed leaves", async () => {
    const { leaf, start, prompt, finish } = await setup();
    await prompt(); await start("git status"); await finish();
    const before = getTerminalStatus(leaf);
    await restartSession(leaf);
    expect(getTerminalStatus(leaf)).toMatchObject({ scope: "unknown", cwd: null, lastRun: null, command: "", startedAt: null });
    expect(getTerminalStatus(leaf)?.recentTools).toEqual([]);
    expect(getTerminalStatus(leaf)?.scopeKey).not.toBe(before?.scopeKey);
    disposeSession(leaf);
    expect(getTerminalStatus(leaf)).toBeNull();
  });

  it("opens only the requested leaf's logs, independent of the active terminal", async () => {
    const one = await setup(); const two = await setup();
    const first = vi.fn(); const second = vi.fn();
    subscriptions.push(registerTerminalLogsOpener(one.leaf, first), registerTerminalLogsOpener(two.leaf, second));
    setSessionActive(two.leaf, true);
    expect(openTerminalLogs(one.leaf)).toBe(true);
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    expect(openTerminalLogs(-1)).toBe(false);
  });
});
