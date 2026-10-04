// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cwd: "/fixture/project", home: "/fixture/home" }));
vi.mock("./ai/terminalContext", () => ({
  getActiveTerminalCwd: () => state.cwd,
  useActiveTerminalCwd: () => state.cwd,
}));
vi.mock("./workspace/store", () => ({ getWorkspaceRoot: () => "" }));
vi.mock("./settings/preferences", () => ({ getPrefs: () => ({ sessionRestoreEnabled: true }) }));
vi.mock("./fs", () => ({ homeDir: async () => state.home }));
vi.mock("./ai/sessionStore", () => ({ renameSession: vi.fn(), tabSessionId: (id: number) => `tab-${id}` }));
vi.mock("./terminal/registry", () => ({ disposeSession: vi.fn() }));
vi.mock("./Terminal", () => ({ TerminalView: () => null }));

import { useTerminalTabs, type TerminalTabsApi } from "./useTerminalTabs";

let tabs: TerminalTabsApi;
let root: Root;
let container: HTMLDivElement;
function Harness() {
  tabs = useTerminalTabs();
  // Deliberately simulate a caller forwarding an event. The hook must still
  // enforce the runtime directory contract even if a UI boundary regresses.
  return createElement("button", { onClick: event => tabs.addTab(event as unknown as string) }, "New tab");
}
async function render() {
  await act(async () => root.render(createElement(Harness)));
}
function lastCwd() {
  const pane = tabs.tabs[tabs.tabs.length - 1].root;
  if (pane.kind !== "leaf") throw new Error("Expected a terminal leaf");
  return pane.initialCwd;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.cwd = "/fixture/project"; state.home = "/fixture/home";
  localStorage.clear();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); localStorage.clear();
});

it("does not store an actual React click event as a launch directory or break autosave", async () => {
  await render();
  await act(async () => container.querySelector("button")!.click());
  expect(lastCwd()).toBe("/fixture/project");
  expect(() => JSON.stringify(tabs.tabs)).not.toThrow();
  const saved = JSON.parse(localStorage.getItem("huskv2.session.v1")!);
  expect(saved.tabs).toHaveLength(2);
  expect(saved.tabs[1].root.initialCwd).toBe("/fixture/project");
  await act(async () => root.render(null));
  await render();
  expect(tabs.tabs).toHaveLength(2);
  expect(lastCwd()).toBe("/fixture/project");
});

it("keeps explicit paths and no-argument keyboard/palette launches working", async () => {
  await render();
  await act(async () => { tabs.addTab("/fixture/work with spaces"); });
  expect(lastCwd()).toBe("/fixture/work with spaces");
  await act(async () => { tabs.addTab(); });
  expect(lastCwd()).toBe("/fixture/project");
});

it("falls back to home for invalid launch values when no terminal cwd is available", async () => {
  state.cwd = "";
  await render();
  const circular = { self: null as unknown }; circular.self = circular;
  await act(async () => { tabs.addTab(circular as unknown as string); });
  expect(lastCwd()).toBe("/fixture/home");
});
