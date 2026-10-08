// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandFollowupBar } from "./CommandFollowupBar";
import type { CommandFollowup } from "../ai/commandFollowup";

let container: HTMLDivElement;
let root: Root;
const handlers = { onToggle: vi.fn(), onStop: vi.fn(), onAnalyze: vi.fn(), onInterrupt: vi.fn() };
const state = (patch: Partial<CommandFollowup> = {}): CommandFollowup => ({
  id: "run-1", sessionId: "chat", remoteScope: "null", target: { ptyId: 3, cwd: "/project", isRemote: false, host: null },
  command: "sleep 5", queuedAt: 1, phase: "waiting", completed: false, note: "Waiting for command result…", ...patch,
});
function render(value: CommandFollowup | undefined = state(), busy = false) {
  act(() => root.render(createElement(CommandFollowupBar, { ...handlers, enabled: true, state: value, busy })));
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
  expect(button).toBeDefined();
  act(() => button!.click());
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("exposes a labelled toggle and never executes a command when toggled", () => {
  render();
  expect(container.querySelector("label")?.textContent).toContain("Auto follow-up");
  act(() => container.querySelector("input")!.click());
  expect(handlers.onToggle).toHaveBeenCalledExactlyOnceWith(false);
  expect(handlers.onInterrupt).not.toHaveBeenCalled();
});
it("stops analysis separately from shell interruption", () => {
  render(); click("Stop follow-up");
  expect(handlers.onStop).toHaveBeenCalledTimes(1);
  expect(handlers.onInterrupt).not.toHaveBeenCalled();
});
it("requires explicit Ctrl+C confirmation and cancel sends nothing", () => {
  render(); click("Interrupt command…");
  expect(handlers.onInterrupt).not.toHaveBeenCalled();
  expect(container.textContent).toContain("cannot undo changes");
  click("Cancel"); expect(handlers.onInterrupt).not.toHaveBeenCalled();
  click("Interrupt command…"); click("Send Ctrl+C");
  expect(handlers.onInterrupt).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Send Ctrl+C");
});
it("drops interrupt confirmation when the command changes or completes", () => {
  render(); click("Interrupt command…");
  render(state({ id: "run-2" }));
  expect(container.textContent).not.toContain("Send Ctrl+C");
  click("Interrupt command…");
  render(state({ id: "run-2", completed: true, phase: "paused" }));
  expect(container.textContent).not.toContain("Interrupt command");
  expect(handlers.onInterrupt).not.toHaveBeenCalled();
});
it("offers explicit analysis of a completed paused result, disabled while busy", () => {
  const value = state({ phase: "paused", completed: true, result: { command: "pwd", output: "/project", exitCode: 0, at: 5, cwd: "/project", terminalPtyId: 3 } });
  render(value, true); click("Analyze result"); expect(handlers.onAnalyze).not.toHaveBeenCalled();
  render(value); click("Analyze result"); expect(handlers.onAnalyze).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toContain("Interrupt command");
});
it("keeps completed analysis compact without stale run controls", () => {
  render(state({ phase: "done", completed: true }));
  expect(container.querySelectorAll("button")).toHaveLength(0);
  expect(container.querySelector("input")?.checked).toBe(true);
});
