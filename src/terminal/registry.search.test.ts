// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(), writeText: vi.fn() }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => "", syncWorkspaceRootToCwd: vi.fn() }));
vi.mock("../timeline/store", () => ({ recordTimelineEvent: vi.fn(async () => undefined) }));
vi.mock("./sessionWake", () => ({ installTerminalWakeChecks: () => () => {}, mayRestoreTerminalFocus: () => false }));
vi.mock("./sessionLifecycle", async importOriginal => {
  const original = await importOriginal<typeof import("./sessionLifecycle")>();
  return { ...original, TerminalSessionConnection: class {
    id = 77;
    status = { state: "ready" as const };
    constructor(_transport: unknown, _onData: unknown, private onChange: () => void) {}
    async start() { this.onChange(); }
    async check() {}
    write() { return true; }
    dispose() {}
  } };
});

import { invoke } from "@tauri-apps/api/core";
import { createSession, disposeSession, getSessionHandle, setSessionActive, setSessionCallbacks } from "./registry";
import { openActiveTerminalSearch, searchActiveTerminal } from "../ai/terminalContext";

let leafId = 0;
afterEach(() => { if (leafId) disposeSession(leafId); vi.restoreAllMocks(); });

it("opens terminal find from Cmd/Ctrl+F and the active search actions without shell input", async () => {
  const keySpy = vi.spyOn(Terminal.prototype, "attachCustomKeyEventHandler");
  await createSession(++leafId, "/project");
  setSessionActive(leafId, true);
  const onSearchOpen = vi.fn();
  setSessionCallbacks(leafId, { onSearchOpen });

  const handler = keySpy.mock.lastCall?.[0];
  expect(handler).toBeTypeOf("function");
  const key = new KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true, cancelable: true });
  expect(handler!(key)).toBe(false);
  expect(key.defaultPrevented).toBe(true);
  expect(onSearchOpen).toHaveBeenCalledExactlyOnceWith();

  expect(openActiveTerminalSearch()).toBe(true);
  expect(onSearchOpen).toHaveBeenCalledTimes(2);
  expect(searchActiveTerminal("needle")).toBe(true);
  expect(onSearchOpen).toHaveBeenLastCalledWith("needle");
  getSessionHandle(leafId)!.openSearch();
  expect(onSearchOpen).toHaveBeenCalledTimes(4);
  expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "pty_write")).toEqual([]);
});
