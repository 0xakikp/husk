// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mounts: new Map<number, number>(),
  unmounts: new Map<number, number>(),
  handles: new Map<number, { focus: ReturnType<typeof vi.fn> }>(),
}));
vi.mock("./Terminal", async () => {
  const { createElement: element, useEffect } = await import("react");
  return {
    TerminalView: ({ leafId, active }: { leafId: number; active: boolean }) => {
      useEffect(() => {
        state.mounts.set(leafId, (state.mounts.get(leafId) ?? 0) + 1);
        return () => { state.unmounts.set(leafId, (state.unmounts.get(leafId) ?? 0) + 1); };
      }, [leafId]);
      return element("div", {
        className: "terminal-host-wrap",
        "data-terminal-leaf": leafId,
        "data-terminal-active": String(active),
      });
    },
  };
});
vi.mock("./terminal/registry", () => ({
  getSessionHandle: vi.fn((leafId: number) => state.handles.get(leafId)),
}));

import { PaneView, type Pane } from "./terminalPanes";

const layout: Pane = {
  kind: "split", id: 100, dir: "row", ratio: 0.5,
  a: { kind: "leaf", id: 11, initialCwd: "/first" },
  b: {
    kind: "split", id: 200, dir: "col", ratio: 0.6,
    a: { kind: "leaf", id: 22, initialCwd: "/second" },
    b: { kind: "leaf", id: 33, initialCwd: "/third" },
  },
};
let root: Root;
let host: HTMLDivElement;
let ops: Omit<ComponentProps<typeof PaneView>, "node">;
let originalCursor: string;
let originalUserSelect: string;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.mounts.clear(); state.unmounts.clear(); state.handles.clear();
  for (const id of [11, 22, 33]) state.handles.set(id, { focus: vi.fn() });
  ops = {
    tabActive: true, focusedId: 22, multi: true,
    onSplit: vi.fn(), onClose: vi.fn(), onFocus: vi.fn(),
    onOpenLogs: vi.fn(), onCwd: vi.fn(), onCommandComplete: vi.fn(),
    onFocusDirection: vi.fn(), onRatio: vi.fn(),
  };
  originalCursor = document.body.style.cursor;
  originalUserSelect = document.body.style.userSelect;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  document.body.style.cursor = originalCursor;
  document.body.style.userSelect = originalUserSelect;
});

async function render(node: Pane = layout, overrides: Partial<typeof ops> = {}) {
  await act(async () => root.render(createElement(PaneView, { node, ...ops, ...overrides })));
}
function button(label: string) {
  const element = host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  expect(element, `Expected ${label} button`).not.toBeNull(); return element!;
}

it("numbers nested panes in visual tree order and marks only the active terminal", async () => {
  await render();
  const labels = [...host.querySelectorAll<HTMLButtonElement>('button[aria-label^="Focus Terminal "]')];
  expect(labels.map((label) => label.querySelector(".pane-label-text")?.textContent)).toEqual(["Terminal 1", "Terminal 2", "Terminal 3"]);
  expect(labels.map((label) => label.getAttribute("aria-pressed"))).toEqual(["false", "true", "false"]);
  expect(host.querySelectorAll(".pane-leaf.focused")).toHaveLength(1);
  expect(host.querySelector(".pane-leaf.focused [data-terminal-leaf]")?.getAttribute("data-terminal-leaf")).toBe("22");
  expect(host.querySelectorAll('[data-terminal-active="true"]')).toHaveLength(1);
});

it("removes active chrome when the terminal tab is not visible without unmounting sessions", async () => {
  await render(); await render(layout, { tabActive: false });
  expect(host.querySelectorAll('[aria-pressed="true"], .pane-leaf.focused, [data-terminal-active="true"]')).toHaveLength(0);
  expect([...state.mounts.values()]).toEqual([1, 1, 1]);
  expect(state.unmounts.size).toBe(0);
});

it("keeps a single terminal free of pane labels, close controls, and split frames", async () => {
  await render({ kind: "leaf", id: 11 }, { multi: false, focusedId: 11 });
  expect(host.querySelector("button")).toBeNull();
  expect(host.querySelector(".pane-framed, .pane-leaf.focused")).toBeNull();
  expect(host.querySelector('[data-terminal-leaf="11"]')).not.toBeNull();
});

it.each([[1, 11], [2, 22], [3, 33]])("focuses Terminal %i directly, including an already-active pane", async (number, leafId) => {
  await render();
  await act(async () => button(`Focus Terminal ${number}`).click());
  expect(ops.onFocus).toHaveBeenCalledExactlyOnceWith(leafId);
  expect(state.handles.get(leafId)!.focus).toHaveBeenCalledOnce();
  for (const [otherId, handle] of state.handles) {
    if (otherId !== leafId) expect(handle.focus).not.toHaveBeenCalled();
  }
  expect(ops.onClose).not.toHaveBeenCalled();
});

it.each([[1, 11], [2, 22], [3, 33]])("closes only Terminal %i without focusing it or another pane", async (number, leafId) => {
  await render();
  await act(async () => button(`Close Terminal ${number}`).click());
  expect(ops.onClose).toHaveBeenCalledExactlyOnceWith(leafId);
  expect(ops.onFocus).not.toHaveBeenCalled();
  for (const handle of state.handles.values()) expect(handle.focus).not.toHaveBeenCalled();
});

it("preserves terminal component and DOM identity through ratio, cwd, and focus updates", async () => {
  await render();
  const terminals = [...host.querySelectorAll("[data-terminal-leaf]")];
  if (layout.kind !== "split" || layout.b.kind !== "split" || layout.b.a.kind !== "leaf") throw new Error("Expected nested split fixture");
  const updated: Pane = {
    ...layout, ratio: 0.7,
    b: { ...layout.b, ratio: 0.3, a: { ...layout.b.a, initialCwd: "/new-directory" } },
  };
  await render(updated, { focusedId: 33, onFocus: vi.fn(), onCwd: vi.fn(), onCommandComplete: vi.fn() });
  const current = [...host.querySelectorAll("[data-terminal-leaf]")];
  current.forEach((terminal, index) => expect(terminal).toBe(terminals[index]));
  expect([...state.mounts.entries()]).toEqual([[11, 1], [22, 1], [33, 1]]);
  expect(state.unmounts.size).toBe(0);
  expect(button("Focus Terminal 3").getAttribute("aria-pressed")).toBe("true");
});

function separator(direction: "row" | "col" = "row") {
  const element = host.querySelector<HTMLDivElement>(`.pane-divider.${direction}`);
  expect(element).not.toBeNull(); return element!;
}
async function key(element: HTMLElement, value: string, modifiers: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true, ...modifiers });
  await act(async () => { element.dispatchEvent(event); });
  return event;
}
function mockGeometry(element: HTMLDivElement, width = 806, height = 406) {
  vi.spyOn(element.parentElement!, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, width, height));
  const captured = new Set<number>();
  const setPointerCapture = vi.fn((id: number) => { captured.add(id); });
  const releasePointerCapture = vi.fn((id: number) => { captured.delete(id); });
  Object.defineProperties(element, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: (id: number) => captured.has(id) },
    releasePointerCapture: { configurable: true, value: releasePointerCapture },
  });
  return { setPointerCapture, releasePointerCapture };
}
async function pointer(target: EventTarget, type: string, values: PointerEventInit = {}) {
  const event = new PointerEvent(type, {
    pointerId: 7, pointerType: "mouse", isPrimary: true, button: 0,
    clientX: 310, clientY: 220, bubbles: true, cancelable: true, ...values,
  });
  await act(async () => { target.dispatchEvent(event); });
  return event;
}

it("exposes focusable separators with the correct orientation, percentage, and controlled pane", async () => {
  await render();
  for (const [direction, orientation, value] of [["row", "vertical", "50"], ["col", "horizontal", "60"]] as const) {
    const control = separator(direction);
    expect(control.getAttribute("role")).toBe("separator");
    expect(control.tabIndex).toBe(0);
    expect(control.getAttribute("aria-orientation")).toBe(orientation);
    expect(control.getAttribute("aria-valuemin")).toBe("15");
    expect(control.getAttribute("aria-valuemax")).toBe("85");
    expect(control.getAttribute("aria-valuenow")).toBe(value);
    expect(document.getElementById(control.getAttribute("aria-controls")!)).toBe(control.previousElementSibling);
  }
  await render(layout, { tabActive: false });
  expect(separator("row").tabIndex).toBe(-1);
  expect(separator("col").tabIndex).toBe(-1);
});

it.each([
  ["row", "ArrowLeft", 100, 0.48], ["row", "ArrowRight", 100, 0.52],
  ["col", "ArrowUp", 200, 0.58], ["col", "ArrowDown", 200, 0.62],
] as const)("resizes a %s split with %s in two-percent steps", async (direction, arrow, id, ratio) => {
  await render();
  const control = separator(direction); control.focus();
  expect((await key(control, arrow)).defaultPrevented).toBe(true);
  expect(ops.onRatio).toHaveBeenCalledOnce();
  const [actualId, actualRatio] = vi.mocked(ops.onRatio).mock.calls[0];
  expect(actualId).toBe(id); expect(actualRatio).toBeCloseTo(ratio);
  expect(document.activeElement).toBe(control);
  expect(ops.onFocus).not.toHaveBeenCalled();
});

it.each([
  ["row", "ArrowLeft", 100, 0.4], ["row", "ArrowRight", 100, 0.6],
  ["col", "ArrowUp", 200, 0.5], ["col", "ArrowDown", 200, 0.7],
] as const)("supports coarse Shift+%s %s resizing", async (direction, arrow, id, ratio) => {
  await render(); await key(separator(direction), arrow, { shiftKey: true });
  const [actualId, actualRatio] = vi.mocked(ops.onRatio).mock.calls[0];
  expect(actualId).toBe(id); expect(actualRatio).toBeCloseTo(ratio);
});

it.each([["Home", 0.15], ["End", 0.85], ["Enter", 0.5]] as const)("supports %s on either separator orientation", async (value, ratio) => {
  await render();
  await key(separator("row"), value); await key(separator("col"), value);
  expect(ops.onRatio).toHaveBeenNthCalledWith(1, 100, ratio);
  expect(ops.onRatio).toHaveBeenNthCalledWith(2, 200, ratio);
});

it.each([[0.15, "ArrowLeft"], [0.85, "ArrowRight"]] as const)("clamps keyboard resizing at the %s boundary", async (ratio, arrow) => {
  if (layout.kind !== "split") throw new Error("Expected split fixture");
  await render({ ...layout, ratio });
  await key(separator(), arrow, { shiftKey: true });
  expect(ops.onRatio).toHaveBeenCalledExactlyOnceWith(100, ratio);
});

it("ignores wrong-axis keys, unrelated keys, and command modifiers", async () => {
  await render();
  for (const value of ["ArrowUp", "ArrowDown", "Escape", " "]) {
    expect((await key(separator("row"), value)).defaultPrevented).toBe(false);
  }
  for (const value of ["ArrowLeft", "ArrowRight"]) {
    expect((await key(separator("col"), value)).defaultPrevented).toBe(false);
  }
  for (const modifiers of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
    expect((await key(separator("row"), "ArrowRight", modifiers)).defaultPrevented).toBe(false);
    expect((await key(separator("col"), "Home", modifiers)).defaultPrevented).toBe(false);
  }
  expect(ops.onRatio).not.toHaveBeenCalled();
});

it("balances only the double-clicked split", async () => {
  await render();
  await act(async () => { separator("col").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  expect(ops.onRatio).toHaveBeenCalledExactlyOnceWith(200, 0.5);
  expect(ops.onFocus).not.toHaveBeenCalled();
});

it.each([["row", 100, 390, 220, 0.6, "col-resize"], ["col", 200, 310, 260, 0.7, "row-resize"]] as const)(
  "drags the %s split by its initial ratio and usable size without a pointer-down jump",
  async (direction, id, clientX, clientY, ratio, cursor) => {
    await render(); const control = separator(direction); const capture = mockGeometry(control);
    expect((await pointer(control, "pointerdown")).defaultPrevented).toBe(true);
    expect(ops.onRatio).not.toHaveBeenCalled();
    expect(capture.setPointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    expect(control.dataset.dragging).toBe("true");
    expect(document.body.style.cursor).toBe(cursor);
    expect(document.body.style.userSelect).toBe("none");
    await pointer(window, "pointermove", { clientX, clientY });
    const [actualId, actualRatio] = vi.mocked(ops.onRatio).mock.calls[0];
    expect(actualId).toBe(id); expect(actualRatio).toBeCloseTo(ratio);
    expect(ops.onFocus).not.toHaveBeenCalled();
  },
);

it("filters non-primary mouse buttons, other pointer IDs, and a second concurrent drag", async () => {
  await render(); const control = separator(); mockGeometry(control);
  expect((await pointer(control, "pointerdown", { button: 2 })).defaultPrevented).toBe(false);
  expect((await pointer(control, "pointerdown", { isPrimary: false })).defaultPrevented).toBe(false);
  await pointer(window, "pointermove", { clientX: 390 });
  expect(ops.onRatio).not.toHaveBeenCalled(); expect(control.dataset.dragging).toBeUndefined();
  await pointer(control, "pointerdown");
  await pointer(window, "pointermove", { pointerId: 8, clientX: 390 });
  await pointer(window, "pointerup", { pointerId: 8 });
  expect(control.dataset.dragging).toBe("true"); expect(ops.onRatio).not.toHaveBeenCalled();
  await pointer(control, "pointerdown", { pointerId: 9, clientX: 500 });
  await pointer(window, "pointermove", { pointerId: 9, clientX: 700 });
  expect(ops.onRatio).not.toHaveBeenCalled();
  await pointer(window, "pointermove", { clientX: 390 });
  expect(ops.onRatio).toHaveBeenCalledExactlyOnceWith(100, 0.6);
});

it.each([[2000, 0.85], [-1000, 0.15]] as const)("clamps pointer drags at x=%i", async (clientX, ratio) => {
  await render(); const control = separator(); mockGeometry(control);
  await pointer(control, "pointerdown"); await pointer(window, "pointermove", { clientX });
  expect(ops.onRatio).toHaveBeenCalledExactlyOnceWith(100, ratio);
});

it.each(["pointerup", "pointercancel", "blur", "resize", "lostpointercapture", "unmount", "hidden"] as const)(
  "restores cursor, selection, and pointer capture after %s",
  async (ending) => {
    await render(); const control = separator(); const capture = mockGeometry(control);
    document.body.style.cursor = "crosshair"; document.body.style.userSelect = "text";
    await pointer(control, "pointerdown");
    if (ending === "unmount") await act(async () => root.render(null));
    else if (ending === "hidden") await render(layout, { tabActive: false });
    else if (ending === "blur" || ending === "resize") await act(async () => { window.dispatchEvent(new Event(ending)); });
    else await pointer(ending === "lostpointercapture" ? control : window, ending);
    expect(control.dataset.dragging).toBeUndefined();
    expect(document.body.style.cursor).toBe("crosshair");
    expect(document.body.style.userSelect).toBe("text");
    expect(capture.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
    await pointer(window, "pointermove", { clientX: 600 });
    expect(ops.onRatio).not.toHaveBeenCalled();
  },
);

it("preserves the drag anchor and terminal mounts while using the latest resize callback", async () => {
  if (layout.kind !== "split") throw new Error("Expected split fixture");
  await render(); const control = separator(); mockGeometry(control);
  await pointer(control, "pointerdown");
  const latestRatio = vi.fn();
  await render({ ...layout, ratio: 0.55 }, { onRatio: latestRatio });
  expect(separator()).toBe(control); expect(control.dataset.dragging).toBe("true");
  await pointer(window, "pointermove", { clientX: 390 });
  expect(latestRatio).toHaveBeenCalledExactlyOnceWith(100, 0.6);
  expect(ops.onRatio).not.toHaveBeenCalled();
  expect([...state.mounts.values()]).toEqual([1, 1, 1]); expect(state.unmounts.size).toBe(0);
});

it("does not begin dragging a split with no usable space", async () => {
  await render(); const control = separator(); const capture = mockGeometry(control, 6, 406);
  expect((await pointer(control, "pointerdown")).defaultPrevented).toBe(false);
  expect(control.dataset.dragging).toBeUndefined(); expect(capture.setPointerCapture).not.toHaveBeenCalled();
  await pointer(window, "pointermove", { clientX: 390 }); expect(ops.onRatio).not.toHaveBeenCalled();
});
