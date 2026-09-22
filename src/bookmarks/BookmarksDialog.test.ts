// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./store", () => ({ useBookmarks: () => [], addBookmark: vi.fn(), removeBookmark: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { BookmarksDialog } from "./BookmarksDialog";
import { addBookmark, removeBookmark } from "./store";
import { toast } from "../toast";

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const onRunCommand = vi.fn();
const onOpenFile = vi.fn();
const onOpenDirectory = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); document.body.style.pointerEvents = ""; });
async function render() {
  await act(async () => root.render(createElement(BookmarksDialog, { open: true, onClose, onRunCommand, onOpenFile, onOpenDirectory })));
}
function button(text: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent?.trim() === text || element.getAttribute("aria-label") === text);
  expect(result, text).toBeDefined(); return result!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function type(id: string, text: string) {
  const field = document.getElementById(id) as HTMLInputElement;
  expect(field, id).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function chooseType(text: string) {
  const trigger = document.getElementById("bookmark-type")!;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((element) => element.textContent === text);
  expect(option, text).toBeDefined();
  await act(async () => { option!.focus(); option!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
}
function expectNoOpeningOrExecution() {
  expect(onRunCommand).not.toHaveBeenCalled(); expect(onOpenFile).not.toHaveBeenCalled(); expect(onOpenDirectory).not.toHaveBeenCalled();
}

it("opens a portalled compact Add Bookmark form with labelled shared controls", async () => {
  await render();
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[role="dialog"].compact-panel.compact-dialog > .compact-body')).not.toBeNull();
  expect(document.querySelector('[aria-label="Add bookmark"]')).toBeNull();
  await click("Add Bookmark");
  const form = document.querySelector('[aria-label="Add bookmark"].compact-form')!;
  expect(form).not.toBeNull();
  expect(document.querySelector(".compact-body")?.firstElementChild).toBe(form);
  expect(form.classList.contains("border-t")).toBe(false);
  for (const [id, label] of [["bookmark-type", "Type"], ["bookmark-label", "Label"], ["bookmark-path", "Path"]]) {
    expect(form.querySelector(`label[for="${id}"]`)?.textContent).toBe(label);
    expect(form.querySelector(`#${id}`)?.classList.contains("compact-control")).toBe(true);
  }
  for (const action of form.querySelectorAll("button:not([role=combobox])")) expect(action.classList.contains("compact-button")).toBe(true);
  expect(button("Add").dataset.compactVariant).toBe("primary");
  expect(button("Cancel").dataset.compactVariant).toBe("ghost");
  expect(addBookmark).not.toHaveBeenCalled(); expectNoOpeningOrExecution();
});

it("validates directory fields and saves only the trimmed bookmark definition", async () => {
  await render(); await click("Add Bookmark");
  await click("Add"); expect(addBookmark).not.toHaveBeenCalled();
  await type("bookmark-label", "   "); await type("bookmark-path", "/tmp/project");
  await click("Add"); expect(addBookmark).not.toHaveBeenCalled();
  await type("bookmark-label", "  Project root  "); await type("bookmark-path", "   ");
  await click("Add"); expect(addBookmark).not.toHaveBeenCalled();
  await type("bookmark-path", "  /tmp/project  "); await click("Add");
  expect(addBookmark).toHaveBeenCalledExactlyOnceWith({ type: "directory", label: "Project root", path: "/tmp/project", command: undefined });
  expect(toast).toHaveBeenCalledWith({ title: "Bookmark added", variant: "success" });
  expect(document.querySelector('[aria-label="Add bookmark"]')).toBeNull();
  expect(onClose).not.toHaveBeenCalled(); expectNoOpeningOrExecution();
});

it("uses the real Radix Type selector to reveal and validate a command without running it", async () => {
  await render(); await click("Add Bookmark");
  await type("bookmark-path", "/tmp/previous-directory");
  await chooseType("Command");
  expect(document.getElementById("bookmark-path")).toBeNull();
  expect(document.querySelector('label[for="bookmark-command"]')?.textContent).toBe("Command");
  expect(document.getElementById("bookmark-command")?.classList.contains("compact-control")).toBe(true);
  await type("bookmark-label", "  Dev server  "); await click("Add");
  expect(addBookmark).not.toHaveBeenCalled();
  await type("bookmark-command", "   "); await click("Add"); expect(addBookmark).not.toHaveBeenCalled();
  await type("bookmark-command", "  pnpm tauri dev  "); await click("Add");
  expect(addBookmark).toHaveBeenCalledExactlyOnceWith({ type: "command", label: "Dev server", path: undefined, command: "pnpm tauri dev" });
  expectNoOpeningOrExecution();
});

it("cancels a populated form without saving, removing, opening, or executing anything", async () => {
  await render(); await click("Add Bookmark");
  await type("bookmark-label", "Unfinished"); await type("bookmark-path", "/tmp/draft");
  await click("Cancel");
  expect(document.querySelector('[aria-label="Add bookmark"]')).toBeNull();
  expect(button("Add Bookmark")).toBeDefined();
  expect(addBookmark).not.toHaveBeenCalled(); expect(removeBookmark).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled(); expectNoOpeningOrExecution();
});
