// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarRail, sidebarRailParent, visibleRailSlots, type SidebarViewId } from "./SidebarRail";
let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
it.each(["docker", "kubernetes", "tailscale"] as const)("keeps Tools selected inside %s", async (view) => {
  await act(async () => root.render(createElement(SidebarRail, { view, onSelectView: vi.fn() })));
  expect(container.querySelector('[aria-label="Tools"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(container.querySelector('[aria-label="Plugins"]')).toBeNull();
});
it("provides keyboard navigation without changing the selected view until activated", async () => {
  const select = vi.fn();
  await act(async () => root.render(createElement(SidebarRail, { view: "explorer", onSelectView: select })));
  const first = container.querySelector<HTMLButtonElement>("[data-rail-button]")!; first.focus();
  await act(async () => first.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })));
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Tools");
  expect(select).not.toHaveBeenCalled();
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(select).toHaveBeenCalledWith("tools-hub");
});
it("reserves a full-size More button instead of squeezing the rail", () => {
  expect(visibleRailSlots(232)).toBe(7);
  expect(visibleRailSlots(200)).toBe(5);
  expect(visibleRailSlots(40)).toBe(0);
  expect(sidebarRailParent("sftp")).toBe("remotes");
  expect(sidebarRailParent("workflows" as SidebarViewId)).toBe("workflows");
});
it("shows the active hidden destination in More and retains access to it", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 200 } as DOMRect);
  const select = vi.fn();
  await act(async () => root.render(createElement(SidebarRail, { view: "docker", onSelectView: select })));
  const more = container.querySelector<HTMLButtonElement>('[aria-label="More sections (Tools active)"]')!;
  expect(more).not.toBeNull();
  expect(container.querySelectorAll("[data-rail-button]")).toHaveLength(6);
  await act(async () => more.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find((node) => node.textContent === "Tools")!;
  expect(item.getAttribute("aria-checked")).toBe("true");
  await act(async () => item.click());
  expect(select).toHaveBeenCalledWith("tools-hub");
});
