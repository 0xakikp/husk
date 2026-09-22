// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Workflow } from "./schema";
const fixture = vi.hoisted(() => ({ saved: [] as Workflow[] }));
vi.mock("./store", () => ({ loadWorkflows: () => fixture.saved, saveWorkflows: vi.fn(), newWorkflowId: () => "wf_new" }));
vi.mock("./suggestions", () => ({ dismissWorkflowSuggestionFingerprint: vi.fn() }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: false }) }));
vi.mock("../ai/assist", () => ({ refineWorkflowDraft: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { WorkflowSidebarEditor } from "./WorkflowSidebarEditor";
import { toast } from "../toast";
import { saveWorkflows } from "./store";
import { addWorkflowCapture, discardWorkflowEditor, getWorkflowEditorSession, resumeWorkflowEditor, setWorkflowEditorBusy, startWorkflowEditor } from "./editorSession";

let root: Root; let container: HTMLDivElement;
const wf: Workflow = { id: "wf_original", name: "Check", description: "Original description", steps: ["git status"], stepTitles: ["Status"], inputs: [{ name: "count", label: "Count", type: "number", defaultValue: "5", required: true }] };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.saved = [structuredClone(wf)]; vi.mocked(saveWorkflows).mockReset().mockResolvedValue(undefined); vi.mocked(toast).mockClear();
  const session = getWorkflowEditorSession(); if (session) { setWorkflowEditorBusy(session.key, false); discardWorkflowEditor(session.key); }
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); const session = getWorkflowEditorSession();
  if (session) { setWorkflowEditorBusy(session.key, false); discardWorkflowEditor(session.key); }
  vi.unstubAllGlobals();
});
async function renderEditor() { await act(async () => root.render(createElement(WorkflowSidebarEditor))); }
function button(label: string) { const found = [...container.querySelectorAll("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function input(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("fits the existing sidebar and keeps the raw draft across collapse/resume", async () => {
  startWorkflowEditor(wf); await renderEditor();
  expect(container.querySelector(".workflow-sidebar-editor")).not.toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(container.querySelector(".workflow-sidebar-editor.compact-panel > .compact-body")).not.toBeNull();
  expect(container.querySelectorAll(".workflow-sidebar-editor .compact-actions")).toHaveLength(1);
  expect(button("Discard draft").closest(".compact-actions")).toBe(button("Save workflow").closest(".compact-actions"));
  expect(document.body.style.pointerEvents).not.toBe("none");
  await input("Workflow name", "  My unsaved workflow  ");
  await click("Collapse workflow editor"); expect(container.querySelector(".workflow-sidebar-editor")).toBeNull();
  expect(getWorkflowEditorSession()?.workflow.name).toBe("  My unsaved workflow  ");
  await act(async () => resumeWorkflowEditor());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.value).toBe("  My unsaved workflow  ");
  expect(getWorkflowEditorSession()?.workflow.inputs).toEqual(wf.inputs); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("keeps edits across unmount and appends collected commands without replacing them", async () => {
  startWorkflowEditor(wf); await renderEditor(); await input("Workflow name", "Edited");
  await act(async () => root.render(null));
  const session = getWorkflowEditorSession()!;
  addWorkflowCapture("git diff", "ai-code", "current", session.key);
  await renderEditor();
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.value).toBe("Edited");
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Step 2 command"]')?.value).toBe("git diff");
  expect(getWorkflowEditorSession()?.workflow.stepTitles).toEqual(["Status", ""]); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("has no independent column width, height, or resize separator", async () => {
  startWorkflowEditor(wf); await renderEditor();
  const editor = container.querySelector<HTMLElement>('[aria-label="Workflow editor"]')!;
  expect(editor.style.width).toBe(""); expect(editor.style.height).toBe("");
  expect(editor.querySelector('[role="separator"]')).toBeNull();
  expect(container.querySelector(".workflow-dock")).toBeNull();
});
it("awaits a durable save, locks capture during it, then closes only the saved session", async () => {
  let done!: () => void; vi.mocked(saveWorkflows).mockReturnValueOnce(new Promise<void>((resolve) => { done = resolve; }));
  startWorkflowEditor(wf); await renderEditor(); await click("Save workflow");
  const session = getWorkflowEditorSession()!; expect(session.busy).toBe(true);
  expect(() => addWorkflowCapture("git diff", "ai-code", "current", session.key)).toThrow("being saved");
  expect(button("Collapse workflow editor").disabled).toBe(true);
  await act(async () => done()); expect(getWorkflowEditorSession()).toBeNull();
});
it("retains drafts on failed saves and refuses to overwrite workflows changed elsewhere", async () => {
  vi.mocked(saveWorkflows).mockRejectedValueOnce(new Error("disk full"));
  startWorkflowEditor(wf); await renderEditor(); await click("Save workflow");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("disk full"); expect(getWorkflowEditorSession()?.busy).toBe(false);
  fixture.saved = [{ ...wf, name: "Changed elsewhere" }]; await click("Save workflow");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed while you were editing");
  expect(saveWorkflows).toHaveBeenCalledTimes(1); expect(getWorkflowEditorSession()?.workflow.name).toBe(wf.name);
});
it("requires confirmation to discard and Escape only collapses without saving", async () => {
  startWorkflowEditor(wf); await renderEditor(); vi.stubGlobal("confirm", vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true));
  await click("Discard draft"); expect(getWorkflowEditorSession()).not.toBeNull();
  await act(async () => container.querySelector('[aria-label="Workflow editor"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(getWorkflowEditorSession()?.collapsed).toBe(true);
  await act(async () => resumeWorkflowEditor()); await click("Discard draft");
  expect(getWorkflowEditorSession()).toBeNull(); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("keeps a pending save locked after the sidebar unmounts and remounts", async () => {
  let done!: () => void; vi.mocked(saveWorkflows).mockReturnValueOnce(new Promise<void>((resolve) => { done = resolve; }));
  startWorkflowEditor(wf); await renderEditor(); await click("Save workflow");
  await act(async () => root.render(null)); await renderEditor();
  expect(getWorkflowEditorSession()?.busy).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.disabled).toBe(true);
  for (const label of ["Saving…", "Collapse", "Collapse workflow editor", "Discard draft"]) expect(button(label).disabled).toBe(true);
  await click("Saving…"); expect(saveWorkflows).toHaveBeenCalledTimes(1);
  await act(async () => done());
  expect(getWorkflowEditorSession()).toBeNull(); expect(container.querySelector('[aria-label="Workflow editor"]')).toBeNull();
});
it("reports a failed save after unmount and retains an editable draft on reopen", async () => {
  let fail!: (error: Error) => void; vi.mocked(saveWorkflows).mockReturnValueOnce(new Promise<void>((_, reject) => { fail = reject; }));
  startWorkflowEditor(wf); await renderEditor(); await input("Workflow name", "Kept after error"); await click("Save workflow");
  await act(async () => root.render(null));
  await act(async () => fail(new Error("disk full")));
  expect(toast).toHaveBeenCalledWith({ title: "Could not save workflow", message: "disk full", variant: "error" });
  expect(getWorkflowEditorSession()?.busy).toBe(false);
  await renderEditor();
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.value).toBe("Kept after error");
  expect(button("Save workflow").disabled).toBe(false);
});
