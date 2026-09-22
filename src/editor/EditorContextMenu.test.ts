// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { editor as MonacoEditor } from "monaco-editor";

vi.mock("@/lib/utils", () => ({ cn: (...classes: unknown[]) => classes.filter(Boolean).join(" ") }));
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../components/HuskContextMenu", () => ({ huskContextMenuContentClass: "menu", huskContextMenuItemClass: "item" }));
const fixture = vi.hoisted(() => ({ enabled: true }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: fixture.enabled }) }));
vi.mock("../ai/ScreenAiPopover", () => ({
  ScreenAiPopover: ({ selection }: { selection: { text: string; source: string } }) => createElement("div", { "data-peek": true }, `${selection.source}: ${selection.text}`),
}));
import { EditorContextMenu } from "./EditorContextMenu";

let root: Root;
let container: HTMLDivElement;
let host: HTMLDivElement;
let text: string;
let editor: MonacoEditor.IStandaloneCodeEditor;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.enabled = true;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  host = document.createElement("div"); host.className = "editor-host"; document.body.append(host);
  text = "selected code";
  editor = {
    getDomNode: () => host,
    getSelection: () => ({ isEmpty: () => false, startLineNumber: 7, endLineNumber: 7 }),
    getModel: () => ({ uri: { path: "/project/example.ts" }, getValueInRange: () => text }),
    trigger: vi.fn(), focus: vi.fn(),
  } as unknown as MonacoEditor.IStandaloneCodeEditor;
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); host.remove(); });
async function render() { await act(async () => root.render(createElement(EditorContextMenu, { editor }))); }
async function context(target: HTMLElement) {
  await act(async () => target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 30, clientY: 50 })));
}

it("explains the selection captured at right-click, not a later editor selection", async () => {
  await render(); await context(host); text = "a different selection";
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent === "Explain here")!;
  expect(button).toBeDefined(); await act(async () => button.click());
  expect(container.querySelector("[data-peek]")?.textContent).toBe("/project/example.ts · L7: selected code");
  expect(editor.trigger).not.toHaveBeenCalled();
});

it("ignores another editor's context event and hides Peek when AI is disabled", async () => {
  await render();
  const otherHost = document.createElement("div"); otherHost.className = "editor-host"; document.body.append(otherHost);
  try { await context(otherHost); expect(container.querySelector(".menu")).toBeNull(); } finally { otherHost.remove(); }
  fixture.enabled = false; await render(); await context(host);
  expect(container.textContent).not.toContain("Explain here");
  expect(container.textContent).toContain("Copy");
});
