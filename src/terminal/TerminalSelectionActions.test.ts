// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TerminalSelectionActions } from "./TerminalSelectionActions";

let root: Root;
let container: HTMLDivElement;
let element: HTMLDivElement;
let input: HTMLTextAreaElement;
let selected = "ls -lh";
let selectionChange: (() => void) | null;
let scroll: (() => void) | null;
const action = vi.fn();
const focus = vi.fn(() => input.focus());
let terminal: Parameters<typeof TerminalSelectionActions>[0]["terminal"];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  container = document.createElement("div"); element = document.createElement("div"); input = document.createElement("textarea");
  element.append(input); document.body.append(container, element); root = createRoot(container);
  selected = "ls -lh"; selectionChange = null; scroll = null;
  terminal = { element, getSelection: () => selected, focus,
    onSelectionChange: (fn) => { selectionChange = fn; return { dispose: () => { selectionChange = null; } }; },
    onScroll: (fn) => { scroll = () => fn(0); return { dispose: () => { scroll = null; } }; },
  };
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); element.remove(); vi.useRealTimers(); });
async function render(enabled = true, aiEnabled = true) {
  await act(async () => root.render(createElement(TerminalSelectionActions, { terminal, enabled, aiEnabled, onAction: action })));
}
async function select() {
  input.focus();
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 50, clientY: 90 }));
    await vi.advanceTimersByTimeAsync(1);
  });
}
function toolbar() { return document.querySelector('[aria-label="Selected terminal text actions"]'); }
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((node) => node.textContent === label)!;
  expect(button).toBeDefined(); await act(async () => button.click());
}

it("offers passive selection actions without moving focus or acting automatically", async () => {
  await render(); await select();
  expect(toolbar()?.textContent).toContain("Explain"); expect(document.activeElement).toBe(input);
  expect(action).not.toHaveBeenCalled(); expect(focus).not.toHaveBeenCalled();
  await click("Review command"); expect(action).toHaveBeenCalledExactlyOnceWith("review", { text: "ls -lh", x: 50, y: 102 });
  expect(toolbar()).toBeNull();
});
it("does not review multiline text but retains Explain and local Save", async () => {
  selected = "first line\nsecond line"; await render(); await select();
  expect(toolbar()?.textContent).not.toContain("Review command");
  expect(toolbar()?.textContent).toContain("Explain"); await click("Save to Vault");
  expect(action).toHaveBeenCalledWith("save", expect.objectContaining({ text: selected }));
});
it("keeps local saving available beyond the AI size limit and with AI disabled", async () => {
  selected = "line\n".repeat(170); await render(); await select();
  expect(toolbar()?.textContent).not.toContain("Explain"); expect(toolbar()?.textContent).toContain("Save to Vault");
  await render(true, false); expect(toolbar()?.textContent).not.toContain("Review command");
});
it("captures exact multiline selections for workflows even when AI is disabled", async () => {
  selected = "$ printf first\noutput\nprintf second "; await render(true, false); await select();
  expect(toolbar()?.textContent).toContain("Add to workflow…"); await click("Add to workflow…");
  expect(action).toHaveBeenCalledExactlyOnceWith("workflow", { text: selected, x: 50, y: 102 });
  expect(toolbar()).toBeNull();
});
it("does not capture a selection that changed after the workflow toolbar appeared", async () => {
  await render(); await select(); selected = "changed";
  await click("Add to workflow…"); expect(action).not.toHaveBeenCalled();
});
it("hides stale selections after scroll, changed selection or pane deactivation", async () => {
  await render(); await select(); await act(async () => scroll?.()); expect(toolbar()).toBeNull();
  await select(); await act(async () => selectionChange?.()); expect(toolbar()).toBeNull();
  await select(); await render(false); expect(toolbar()).toBeNull();
  expect(selectionChange).toBeNull(); expect(scroll).toBeNull();
});
it("validates the exact selection again when an action is clicked", async () => {
  await render(); await select(); selected = "changed";
  await click("Explain"); expect(action).not.toHaveBeenCalled();
});
it("supports F6 focus and Escape return without stealing normal terminal keys", async () => {
  await render(); await select();
  const f6 = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "F6" });
  await act(async () => { input.dispatchEvent(f6); });
  expect(f6.defaultPrevented).toBe(true); expect(document.activeElement?.textContent).toBe("Explain");
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" })));
  expect(toolbar()).toBeNull(); expect(document.activeElement).toBe(input);
  await select();
  const enter = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" });
  await act(async () => input.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(false); expect(action).not.toHaveBeenCalled(); expect(toolbar()).toBeNull();
});
it("does not interfere with right-click context menus or pending teardown", async () => {
  await render(); await select();
  await act(async () => element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })));
  expect(toolbar()).toBeNull();
  await act(async () => {
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    root.render(null);
  });
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(toolbar()).toBeNull(); expect(selectionChange).toBeNull();
});
