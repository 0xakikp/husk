// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Workflow } from "./schema";
const fixture = vi.hoisted(() => ({ session: null as null | { key: string; busy: boolean; workflow: Workflow } }));
vi.mock("./editorSession", () => ({ useWorkflowEditorSession: () => fixture.session, addWorkflowCapture: vi.fn() }));
import { addWorkflowCapture } from "./editorSession";
import { WorkflowCapture } from "./WorkflowCapture";
import { WorkflowCaptureButton } from "./WorkflowCaptureButton";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest, requestWorkflowCapture } from "./captureRequest";
let root: Root; let container: HTMLDivElement;
const draft = () => ({ key: "draft-1", busy: false, workflow: { id: "wf_1", name: "My workflow", steps: ["printf existing"] } });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.session = null; clearWorkflowCaptureRequest(); vi.mocked(addWorkflowCapture).mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearWorkflowCaptureRequest(); });
async function render() { await act(async () => root.render(createElement(WorkflowCapture))); }
async function capture(text = "printf hello", source: "terminal-selection" | "ai-code" = "terminal-selection") {
  await act(async () => requestWorkflowCapture(text, source)); await render();
}
function button(label: string) { const found = [...document.querySelectorAll("button")].find((node) => node.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function chooseNew() { await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[1].click()); }

it("opens an inert exact-text preview and cancellation never creates a draft", async () => {
  const text = "$ printf one\noutput\nprintf two "; await capture(text);
  expect(document.querySelector("pre")?.textContent).toBe(text);
  expect(document.body.textContent).toContain("kept together in one editable step");
  expect(document.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(true);
  expect(addWorkflowCapture).not.toHaveBeenCalled(); await click("Cancel");
  expect(addWorkflowCapture).not.toHaveBeenCalled(); expect(getWorkflowCaptureRequest()).toBeNull();
});
it("adds exact text only after explicit approval", async () => {
  await capture("  printf hello  ", "ai-code"); await click("Add to draft");
  expect(addWorkflowCapture).toHaveBeenCalledExactlyOnceWith("  printf hello  ", "ai-code", "new", null, false);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("appends to the reviewed current draft by default", async () => {
  fixture.session = draft(); await capture(); await click("Add to draft");
  expect(addWorkflowCapture).toHaveBeenCalledExactlyOnceWith("printf hello", "terminal-selection", "current", "draft-1", false);
});
it("requires explicit confirmation before replacing an existing draft", async () => {
  fixture.session = draft(); await capture(); await chooseNew(); expect(button("Add to draft").disabled).toBe(true);
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Add to draft");
  expect(addWorkflowCapture).toHaveBeenCalledExactlyOnceWith("printf hello", "terminal-selection", "new", "draft-1", true);
});
it("rejects changed draft targets and does not retarget silently", async () => {
  fixture.session = draft(); await capture(); fixture.session = { ...draft(), key: "draft-2" }; await render();
  expect(button("Add to draft").disabled).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toContain("draft changed");
  await click("Add to draft"); expect(addWorkflowCapture).not.toHaveBeenCalled();
});
it("disables capture while draft operations are pending", async () => {
  fixture.session = { ...draft(), busy: true }; await capture();
  expect(button("Add to draft").disabled).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Wait");
  expect(addWorkflowCapture).not.toHaveBeenCalled();
});
it("keeps invalid text visible but refuses to add or silently sanitize it", async () => {
  const text = "printf \x1b[31munsafe"; await capture(text);
  expect(document.querySelector("pre")?.textContent).toBe(text); expect(button("Add to draft").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("control characters");
  expect(addWorkflowCapture).not.toHaveBeenCalled();
});
it("shows add failures without discarding the captured text", async () => {
  vi.mocked(addWorkflowCapture).mockImplementation(() => { throw new Error("Draft has reached 100 steps."); });
  await capture(); await click("Add to draft");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("100 steps");
  expect(getWorkflowCaptureRequest()?.text).toBe("printf hello");
});
it("offers capture only on explicitly shell-labelled AI blocks", async () => {
  await act(async () => root.render(createElement(WorkflowCaptureButton, { language: "python", code: "print('hi')" })));
  expect(container.querySelector("button")).toBeNull(); expect(getWorkflowCaptureRequest()).toBeNull();
  await act(async () => root.render(createElement(WorkflowCaptureButton, { language: "bash", code: "printf first\nprintf second" })));
  await click("Add to workflow…");
  expect(getWorkflowCaptureRequest()).toEqual({ id: expect.any(Number), text: "printf first\nprintf second", source: "ai-code" });
  expect(addWorkflowCapture).not.toHaveBeenCalled();
});
