// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitActionsMenu } from "./GitActionsMenu";

let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
const action = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  action.mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  frames = new Map(); let id = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => { frames.set(++id, callback); return id; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((key) => { frames.delete(key); });
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
const render = async (disabledFirst = false) => {
  await act(async () => root.render(<GitActionsMenu>
    <button disabled={disabledFirst} onClick={action}>Branches</button>
    <button disabled onClick={action}>Pull</button>
    <button onClick={action}><span>Stashes</span></button>
    <button onClick={action}>Publish</button>
  </GitActionsMenu>));
};
const details = () => host.querySelector("details")!;
const menu = () => host.querySelector<HTMLDivElement>(".git-more-items")!;
const trigger = () => host.querySelector("summary")!;
const buttons = () => [...host.querySelectorAll("button")];
const highlighted = () => host.querySelector("[data-highlighted]");
const open = async () => { await act(async () => { trigger().focus(); details().open = true; }); };
const move = async (target: Element, pointerType = "mouse") => {
  await act(async () => target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType, clientX: 50, clientY: 80 })));
};
const key = async (value: string) => {
  await act(async () => (document.activeElement ?? trigger()).dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true })));
};
const flushFrames = async () => {
  await act(async () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((callback) => callback(0)); });
};

it("follows the mouse with one highlight and never invokes an action", async () => {
  await render(); await open();
  await act(async () => buttons()[0].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", clientX: 50, clientY: 80 })));
  expect(highlighted()).toBe(buttons()[0]); expect(document.activeElement).toBe(buttons()[0]);
  await move(buttons()[2].querySelector("span")!);
  expect(highlighted()).toBe(buttons()[2]); expect(host.querySelectorAll("[data-highlighted]")).toHaveLength(1);
  expect(action).not.toHaveBeenCalled(); expect(details().open).toBe(true);
});

it("clears the previous highlight over disabled actions, padding and when leaving", async () => {
  await render(); await open(); await move(buttons()[0]); await move(buttons()[1]);
  expect(highlighted()).toBeNull(); expect(document.activeElement).toBe(menu());
  await move(buttons()[2]); await move(menu()); expect(highlighted()).toBeNull();
  await move(buttons()[0]);
  await act(async () => menu().dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: document.body })));
  expect(highlighted()).toBeNull(); expect(action).not.toHaveBeenCalled();
});

it("rechecks the item underneath a stationary mouse after scrolling", async () => {
  await render(); await open(); await move(buttons()[0]);
  const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(buttons()[2]);
  await act(async () => menu().dispatchEvent(new Event("scroll")));
  expect(highlighted()).toBe(buttons()[0]); await flushFrames();
  expect(hit).toHaveBeenCalledWith(50, 80); expect(highlighted()).toBe(buttons()[2]);
  hit.mockReturnValue(buttons()[1]);
  await act(async () => menu().dispatchEvent(new Event("scroll"))); await flushFrames();
  expect(highlighted()).toBeNull(); expect(action).not.toHaveBeenCalled();
});

it("uses wheel coordinates even before a pointer move, without activating anything", async () => {
  await render(); await open();
  const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(buttons()[3]);
  const wheel = new WheelEvent("wheel", { bubbles: true, deltaY: 20 });
  // happy-dom's WheelEvent does not currently inherit MouseEvent coordinates.
  Object.defineProperties(wheel, { clientX: { value: 12 }, clientY: { value: 34 } });
  await act(async () => menu().dispatchEvent(wheel));
  await flushFrames(); expect(hit).toHaveBeenCalledWith(12, 34); expect(highlighted()).toBe(buttons()[3]);
  expect(action).not.toHaveBeenCalled();
});

it("opens with arrow keys, skips disabled items and supports Home/End", async () => {
  await render(); await act(async () => trigger().focus()); await key("ArrowDown");
  expect(details().open).toBe(true); expect(highlighted()).toBe(buttons()[0]);
  await key("ArrowDown"); expect(highlighted()).toBe(buttons()[2]);
  await key("End"); expect(highlighted()).toBe(buttons()[3]);
  await key("ArrowDown"); expect(highlighted()).toBe(buttons()[0]);
  await key("ArrowUp"); expect(highlighted()).toBe(buttons()[3]);
  await key("Home"); expect(highlighted()).toBe(buttons()[0]);
  expect(action).not.toHaveBeenCalled();
});

it("does not let scrolling overwrite keyboard navigation until fresh pointer input", async () => {
  await render(); await open(); await move(buttons()[0]); await key("End");
  const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(buttons()[2]);
  await act(async () => buttons()[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })));
  await act(async () => menu().dispatchEvent(new Event("scroll"))); await flushFrames();
  expect(highlighted()).toBe(buttons()[3]); expect(hit).not.toHaveBeenCalled();
  await move(buttons()[0]); expect(highlighted()).toBe(buttons()[0]); expect(details().dataset.input).toBe("pointer");
});

it("Escape closes and restores focus to the trigger, cancelling pending hit tests", async () => {
  await render(); await open(); await move(buttons()[0]);
  await act(async () => menu().dispatchEvent(new Event("scroll")));
  await key("Escape"); expect(details().open).toBe(false); expect(document.activeElement).toBe(trigger());
  expect(highlighted()).toBeNull(); expect(frames.size).toBe(0); expect(action).not.toHaveBeenCalled();
});

it("closes on outside pointer, focus leaving, and an explicit action click", async () => {
  await render(); await open();
  await act(async () => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  expect(details().open).toBe(false);
  await open(); await move(buttons()[0]);
  const outside = document.createElement("button"); document.body.append(outside);
  await act(async () => outside.focus()); expect(details().open).toBe(false); outside.remove();
  await open(); await act(async () => buttons()[2].click());
  expect(details().open).toBe(false); expect(action).toHaveBeenCalledTimes(1);
});

it("clears an item when a refresh disables it and ignores touch hovering", async () => {
  await render(); await open(); await move(buttons()[0]); await render(true);
  expect(highlighted()).toBeNull(); await move(buttons()[2], "touch"); expect(highlighted()).toBeNull();
  expect(action).not.toHaveBeenCalled();
});
