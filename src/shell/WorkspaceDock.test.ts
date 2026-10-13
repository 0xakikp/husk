// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceDock } from "./WorkspaceDock";
import { WORKSPACE_DOCK_HEIGHT_KEY } from "./workspaceDockLayout";

let root: Root;
let host: HTMLDivElement;
let container: HTMLDivElement;
let height: number;
let width: number;
let observerCallback: ResizeObserverCallback;
let props: ComponentProps<typeof WorkspaceDock>;
const disconnected = vi.fn();
const unmounted = vi.fn();

function Probe() {
  const [draft, setDraft] = useState("draft survives");
  useEffect(() => () => { unmounted(); }, []);
  return createElement("button", { onClick: () => setDraft("edited draft") }, draft);
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { observerCallback = callback; }
    observe() {}
    disconnect() { disconnected(); }
  });
  localStorage.clear();
  height = 800;
  width = 1000;
  host = document.createElement("div");
  container = document.createElement("div");
  container.getBoundingClientRect = () => ({ height, width, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} });
  document.body.append(container);
  container.append(host);
  root = createRoot(host);
  props = {
    containerRef: { current: container },
    terminalRoot: { kind: "leaf", id: 1 },
    collapsed: false,
    onCollapsedChange: vi.fn(),
    header: ({ cramped, expanded }) => createElement("span", { "data-header-state": `${cramped}/${expanded}` }, "Notes"),
    children: createElement(Probe),
  };
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  vi.unstubAllGlobals();
});

const dock = () => host.querySelector<HTMLElement>(".workspace-dock")!;
const content = () => host.querySelector<HTMLElement>(".workspace-dock__content")!;
const separator = () => host.querySelector<HTMLElement>('[role="separator"]')!;
const toggle = () => host.querySelector<HTMLButtonElement>(".workspace-dock__toggle")!;
async function render(changes: Partial<typeof props> = {}) {
  props = { ...props, ...changes };
  await act(async () => root.render(createElement(WorkspaceDock, props)));
}
async function resize(nextHeight: number, nextWidth = width) {
  height = nextHeight; width = nextWidth;
  await act(async () => observerCallback([], {} as ResizeObserver));
}
async function pointer(target: EventTarget, type: string, clientY: number, pointerId = 7) {
  await act(async () => target.dispatchEvent(new PointerEvent(type, { bubbles: true, button: 0, clientY, pointerId })));
}
async function key(value: string) {
  await act(async () => separator().dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: value })));
}

it("measures the actual terminal-only container, not window height", async () => {
  container.style.paddingTop = "10px";
  container.style.paddingBottom = "10px";
  container.style.rowGap = "8px";
  container.style.borderTop = "1px solid";
  container.style.borderBottom = "1px solid";
  await render();
  expect(dock().style.height).toBe("216px"); // 28% of 770px
  expect(separator().getAttribute("aria-orientation")).toBe("horizontal");
  expect(separator().getAttribute("aria-valuemin")).toBe("160");
  expect(separator().getAttribute("aria-valuemax")).toBe("628");
  expect(content().hidden).toBe(false);
});

it("keeps draft identity and scroll while collapsed, with an always-visible header", async () => {
  await render();
  const child = content().querySelector("button")!;
  await act(async () => child.click());
  content().scrollTop = 48;
  await render({ collapsed: true });
  expect(dock().style.height).toBe("32px");
  expect(content().hidden).toBe(true);
  expect(content().hasAttribute("inert")).toBe(true);
  expect(content().querySelector("button")).toBe(child);
  expect(host.querySelector('[role="separator"]')).toBeNull();
  expect(host.querySelector('[data-header-state="false/false"]')).not.toBeNull();
  expect(unmounted).not.toHaveBeenCalled();
  await act(async () => toggle().click());
  expect(props.onCollapsedChange).toHaveBeenCalledWith(false);
  await render({ collapsed: false });
  expect(content().hidden).toBe(false);
  expect(content().textContent).toBe("edited draft");
  expect(content().scrollTop).toBe(48);
});

it("uses a compact header on short containers without automatic reopening on resize", async () => {
  height = 280;
  function Controlled() {
    const [collapsed, setCollapsed] = useState(false);
    return createElement(WorkspaceDock, { ...props, collapsed, onCollapsedChange: setCollapsed });
  }
  await act(async () => root.render(createElement(Controlled)));
  expect(dock().dataset.cramped).toBe("true");
  expect(dock().style.height).toBe("32px");
  expect(toggle().disabled).toBe(true);
  expect(content().hidden).toBe(true);
  await resize(800);
  expect(dock().dataset.cramped).toBe("false");
  expect(toggle().disabled).toBe(false);
  expect(content().hidden).toBe(true);
  expect(dock().style.height).toBe("32px");
  await act(async () => toggle().click());
  expect(content().hidden).toBe(false);
});

it("reports effective body visibility as measured cramped space expands and collapses", async () => {
  const onExpandedChange = vi.fn();
  height = 280;
  await render({ onExpandedChange });
  expect(onExpandedChange.mock.calls.map(([expanded]) => expanded)).toEqual([false]);
  await resize(800);
  expect(onExpandedChange.mock.calls.map(([expanded]) => expanded)).toEqual([false, true]);
  await render({ collapsed: true });
  expect(onExpandedChange.mock.calls.map(([expanded]) => expanded)).toEqual([false, true, false]);
  await resize(900);
  expect(onExpandedChange).toHaveBeenCalledTimes(3);
  await render({ collapsed: false });
  await resize(280);
  expect(onExpandedChange.mock.calls.map(([expanded]) => expanded)).toEqual([false, true, false, true, false]);
});

it("does not consume more height on narrow layouts or alter an adjacent AI sibling", async () => {
  const aiSibling = document.createElement("aside");
  aiSibling.style.width = "420px";
  aiSibling.style.height = "800px";
  container.before(aiSibling);
  await render();
  const initialHeight = dock().style.height;
  await resize(800, 220);
  expect(dock().style.height).toBe(initialHeight);
  expect(content().hidden).toBe(false);
  expect(aiSibling.style.width).toBe("420px");
  expect(aiSibling.style.height).toBe("800px");
  aiSibling.remove();
});

it("recalculates its maximum from the current unequal vertical split tree", async () => {
  localStorage.setItem(WORKSPACE_DOCK_HEIGHT_KEY, "500");
  await render();
  expect(dock().style.height).toBe("500px");
  await render({ terminalRoot: { kind: "split", id: 3, dir: "col", ratio: 0.4, a: { kind: "leaf", id: 1 }, b: { kind: "leaf", id: 2 } } });
  expect(dock().style.height).toBe("446px");
  await render({ terminalRoot: { ...props.terminalRoot, kind: "split", id: 3, dir: "col", ratio: 0.2, a: { kind: "leaf", id: 1 }, b: { kind: "leaf", id: 2 } } });
  expect(dock().dataset.cramped).toBe("true");
  expect(dock().style.height).toBe("32px");
  expect(props.onCollapsedChange).toHaveBeenCalledWith(true);
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBe("500");
});

it.each(["NaN", "-100", "Infinity", "100px", "32"])("ignores invalid persisted height %s", async (saved) => {
  localStorage.setItem(WORKSPACE_DOCK_HEIGHT_KEY, saved);
  await render();
  expect(dock().style.height).toBe("224px");
});

it("supports bounded keyboard resizing and saves only the resulting local height", async () => {
  await render();
  await key("ArrowUp");
  expect(dock().style.height).toBe("244px");
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBe("244");
  await key("ArrowDown");
  expect(dock().style.height).toBe("224px");
  await key("Home");
  expect(dock().style.height).toBe("160px");
  await key("ArrowDown");
  expect(dock().style.height).toBe("160px");
  await key("End");
  expect(dock().style.height).toBe("658px");
  expect(separator().getAttribute("aria-valuenow")).toBe("658");
  await key("ArrowUp");
  expect(dock().style.height).toBe("658px");
  expect(localStorage.length).toBe(1);
});

it("captures dragging, clamps live height, and writes storage only on release", async () => {
  await render();
  const handle = separator();
  handle.setPointerCapture = vi.fn();
  handle.hasPointerCapture = () => true;
  handle.releasePointerCapture = vi.fn();
  await pointer(handle, "pointerdown", 500);
  expect(handle.setPointerCapture).toHaveBeenCalledWith(7);
  await pointer(window, "pointermove", 450, 8);
  expect(dock().style.height).toBe("224px");
  await pointer(window, "pointermove", 450);
  expect(dock().style.height).toBe("274px");
  expect(separator().getAttribute("aria-valuenow")).toBe("274");
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBeNull();
  await pointer(window, "pointermove", -500);
  expect(dock().style.height).toBe("658px");
  await pointer(window, "pointerup", -500);
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBe("658");
  expect(handle.releasePointerCapture).toHaveBeenCalledWith(7);
  expect(document.body.style.userSelect).toBe("");
  expect(document.body.style.cursor).toBe("");
});

it("cancels without saving and restores preexisting body styles", async () => {
  document.body.style.cursor = "crosshair";
  document.body.style.userSelect = "text";
  await render();
  await pointer(separator(), "pointerdown", 500);
  await pointer(window, "pointermove", 450);
  await pointer(window, "pointercancel", 450);
  expect(dock().style.height).toBe("224px");
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBeNull();
  expect(document.body.style.cursor).toBe("crosshair");
  expect(document.body.style.userSelect).toBe("text");
});

it("cancels a drag if the observed container gets shorter, and cleans up on unmount", async () => {
  await render();
  await pointer(separator(), "pointerdown", 500);
  await pointer(window, "pointermove", 450);
  await resize(400);
  expect(dock().style.height).toBe("160px");
  expect(document.body.style.cursor).toBe("");
  await pointer(window, "pointerup", 450);
  expect(localStorage.getItem(WORKSPACE_DOCK_HEIGHT_KEY)).toBeNull();
  await pointer(separator(), "pointerdown", 300);
  await act(async () => root.unmount());
  root = createRoot(host);
  expect(document.body.style.cursor).toBe("");
  expect(disconnected).toHaveBeenCalled();
});

it("also measures on window resize when the containing layout changes", async () => {
  await render();
  height = 600;
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(dock().style.height).toBe("168px");
});
