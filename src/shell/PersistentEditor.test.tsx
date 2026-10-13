// @vitest-environment happy-dom
import { act, createElement, useEffect, useState, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersistentEditor } from "./PersistentEditor";

let root: Root;
let container: HTMLDivElement;
let panel: HTMLDivElement;
let tab: HTMLDivElement;
const mounted = vi.fn();
const unmounted = vi.fn();

function DraftProbe() {
  const [draft, setDraft] = useState("initial draft");
  useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
  return createElement("div", {},
    createElement("button", { onClick: () => setDraft("edited draft") }, draft),
    createElement("textarea", { defaultValue: "initial text", "aria-label": "Note draft" }),
  );
}
async function render(targetRef: RefObject<HTMLDivElement | null>) {
  await act(async () => root.render(createElement(PersistentEditor, { targetRef, children: createElement(DraftProbe) })));
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mounted.mockReset(); unmounted.mockReset();
  container = document.createElement("div"); panel = document.createElement("div"); tab = document.createElement("div");
  document.body.append(container, panel, tab); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); panel.remove(); tab.remove(); vi.restoreAllMocks();
});

it("moves a single editor host between panel and tab without remounting or losing drafts and selection", async () => {
  const writes = vi.spyOn(localStorage, "setItem");
  await render({ current: panel });
  const host = panel.querySelector<HTMLElement>(".workspace-editor-host")!;
  const button = host.querySelector("button")!;
  const textarea = host.querySelector("textarea")!;
  await act(async () => button.click());
  textarea.value = "unsaved note contents"; textarea.setSelectionRange(3, 8); textarea.scrollTop = 62;
  await render({ current: tab });
  expect(panel.querySelector(".workspace-editor-host")).toBeNull();
  expect(tab.querySelector(".workspace-editor-host")).toBe(host);
  expect(host.querySelector("button")).toBe(button); expect(button.textContent).toBe("edited draft");
  expect(host.querySelector("textarea")).toBe(textarea);
  expect(textarea.value).toBe("unsaved note contents");
  expect([textarea.selectionStart, textarea.selectionEnd, textarea.scrollTop]).toEqual([3, 8, 62]);
  await render({ current: panel });
  expect(panel.querySelector(".workspace-editor-host")).toBe(host);
  expect(tab.querySelector(".workspace-editor-host")).toBeNull();
  expect(document.querySelectorAll(".workspace-editor-host")).toHaveLength(1);
  expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
  expect(writes).not.toHaveBeenCalled();
});

it("attaches a previously absent destination on a later commit using the same ref and child instance", async () => {
  const targetRef: RefObject<HTMLDivElement | null> = { current: null };
  await render(targetRef);
  expect(document.querySelector(".workspace-editor-host")).toBeNull();
  expect(mounted).toHaveBeenCalledOnce();
  targetRef.current = panel;
  await render(targetRef);
  const button = panel.querySelector("button")!;
  await act(async () => button.click());
  targetRef.current = tab;
  await render(targetRef);
  expect(tab.querySelector("button")).toBe(button); expect(button.textContent).toBe("edited draft");
  expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
});

it("keeps child identity while a destination is hidden and when rerendered in the same destination", async () => {
  const targetRef = { current: panel };
  await render(targetRef);
  const host = panel.querySelector(".workspace-editor-host")!;
  const button = panel.querySelector("button")!;
  await act(async () => button.click());
  panel.hidden = true;
  await render(targetRef);
  expect(panel.querySelector(".workspace-editor-host")).toBe(host);
  expect(panel.querySelector("button")).toBe(button);
  panel.hidden = false;
  await render(targetRef);
  expect(button.textContent).toBe("edited draft");
  expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
});

it("removes its own host on unmount without deleting destination containers or siblings", async () => {
  const sibling = document.createElement("span"); sibling.textContent = "other panel content"; panel.append(sibling);
  await render({ current: panel });
  const host = panel.querySelector(".workspace-editor-host")!;
  await act(async () => root.render(null));
  expect(host.isConnected).toBe(false);
  expect(document.querySelector(".workspace-editor-host")).toBeNull();
  expect(panel.isConnected).toBe(true); expect(sibling.isConnected).toBe(true);
  expect(panel.textContent).toBe("other panel content");
  expect(unmounted).toHaveBeenCalledOnce();
});
