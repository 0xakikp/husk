// @vitest-environment happy-dom
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const prefs = vi.hoisted(() => ({ aiEnabled: false }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => prefs }));
vi.mock("../ai/assist", () => ({ refineWorkflowDraft: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { WorkflowEditor } from "./WorkflowEditor";
import type { Workflow } from "./store";
import { refineWorkflowDraft } from "../ai/assist";
const wf: Workflow = { id: "wf_1", name: "History", steps: ["git log -n {{count}}", "git status"], stepTitles: ["History", "Status"], inputs: [{ name: "count", label: "Commits", type: "number", required: true, defaultValue: "5" }] };
let container: HTMLDivElement; let root: Root; const save = vi.fn();
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); prefs.aiEnabled = false; vi.mocked(refineWorkflowDraft).mockReset(); save.mockReset().mockResolvedValue(undefined); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(value: Workflow | null = wf) { await act(async () => root.render(createElement(WorkflowEditor, { initial: value, onSave: save, onCancel: vi.fn() }))); }
function button(label: string) { const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function type(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("uses the shared compact form controls and action variants", async () => {
  await render();
  expect(container.querySelector(".compact-form.wf-form")).not.toBeNull();
  for (const control of container.querySelectorAll('input:not([type="checkbox"]), textarea, select')) expect(control.classList.contains("compact-control")).toBe(true);
  for (const action of container.querySelectorAll("button")) expect(action.classList.contains("compact-button")).toBe(true);
  expect(button("Save workflow").dataset.compactVariant).toBe("primary");
  expect(button("Collapse").dataset.compactVariant).toBe("ghost");
  expect(button("Duplicate step 1").dataset.compactSize).toBe("small");
  expect(container.querySelector('[aria-label="Insert input in step 1"]')?.parentElement?.classList.contains("compact-native-select")).toBe(true);
  expect(container.querySelector('label.compact-check input[type="checkbox"]')).not.toBeNull();
});
it("keeps optional fields collapsed and preserves metadata when moving/duplicating steps", async () => {
  await render();
  expect(container.querySelector("legend")?.textContent).toBe("Steps");
  const inputs = [...container.querySelectorAll("details")].find((node) => node.querySelector("summary")?.textContent === "Inputs · 1")!;
  expect(inputs.open).toBe(false);
  await click("Move step 2 up"); await click("Duplicate step 1"); await click("Save workflow");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ steps: ["git status", "git status", "git log -n {{count}}"], stepTitles: ["Status", "Status", "History"], inputs: wf.inputs }));
});
it("uses the same flat labelled field anatomy as other compact forms with a single step card layer", async () => {
  await render();
  const name = container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!;
  const nameField = name.parentElement!;
  expect(nameField.classList.contains("compact-field")).toBe(true);
  expect(name.closest("fieldset")).toBeNull();
  const nameLabel = nameField.querySelector<HTMLLabelElement>("label.compact-label")!;
  expect(nameLabel.textContent).toBe("Name"); expect(nameLabel.htmlFor).toBe(name.id);
  const steps = container.querySelector("fieldset")!;
  expect(steps.classList.contains("compact-section")).toBe(true);
  expect(steps.querySelector("legend")?.classList.contains("compact-label")).toBe(true);
  expect(steps.querySelectorAll(":scope > article.wf-step")).toHaveLength(wf.steps.length);
  expect(steps.querySelector("fieldset")).toBeNull();
  expect(steps.querySelector(".wf-step-head strong")).toBeNull();
  for (const field of container.querySelectorAll(".wf-input-grid > .compact-field")) {
    const label = field.querySelector<HTMLLabelElement>("label.compact-label")!;
    expect(label).not.toBeNull();
    expect(field.querySelector(".compact-control")?.id).toBe(label.htmlFor);
    expect(label.querySelector("input, select")).toBeNull();
  }
});
it("still disables flat name and description controls while the save is pending", async () => {
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render({ ...wf, description: "Keep this description" });
  await click("Save workflow");
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.disabled).toBe(true);
  expect(container.querySelector<HTMLInputElement>('[placeholder="What this workflow does"]')?.disabled).toBe(true);
  expect([...container.querySelectorAll("fieldset")].every((field) => field.disabled)).toBe(true);
  expect(button("Collapse").disabled).toBe(true);
  await act(async () => finish());
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.disabled).toBe(false);
  expect(button("Save workflow").disabled).toBe(false);
});
it("respects an externally busy session on mount and remount until it is released", async () => {
  const onChange = vi.fn(); const cancel = vi.fn(); const discard = vi.fn();
  const value = { ...wf, description: "In-flight save" };
  const props = { initial: wf, value, onChange, onSave: save, onCancel: cancel, onDiscard: discard };
  async function renderBusy(busy: boolean) {
    await act(async () => root.render(createElement(WorkflowEditor, { ...props, busy })));
  }
  for (let mount = 0; mount < 2; mount++) {
    if (mount) await act(async () => root.render(null));
    await renderBusy(true);
    expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('[placeholder="What this workflow does"]')?.disabled).toBe(true);
    expect([...container.querySelectorAll("fieldset")].every((field) => field.disabled)).toBe(true);
    expect(button("Collapse").disabled).toBe(true);
    expect(button("Discard draft").disabled).toBe(true);
    expect(button("Saving…").disabled).toBe(true);
    await click("Saving…"); await click("Collapse"); await click("Discard draft");
    expect(save).not.toHaveBeenCalled(); expect(onChange).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled(); expect(discard).not.toHaveBeenCalled();
  }
  await renderBusy(false);
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.disabled).toBe(false);
  expect([...container.querySelectorAll("fieldset")].every((field) => !field.disabled)).toBe(true);
  expect(button("Save workflow").disabled).toBe(false);
  expect(button("Collapse").disabled).toBe(false);
  expect(button("Discard draft").disabled).toBe(false);
  expect(save).not.toHaveBeenCalled();
});
it("keeps optional discard, collapse, and save in one shared footer with the persistence note below", async () => {
  const discard = vi.fn(); const cancel = vi.fn();
  await act(async () => root.render(createElement(WorkflowEditor, { initial: wf, onSave: save, onCancel: cancel, onDiscard: discard, footerNote: "Draft kept in this window." })));
  const actions = container.querySelectorAll(".compact-actions");
  expect(actions).toHaveLength(1);
  expect([...actions[0].querySelectorAll("button")].map((action) => action.textContent)).toEqual(["Discard draft", "Collapse", "Save workflow"]);
  expect(button("Discard draft").classList.contains("compact-action-start")).toBe(true);
  expect(button("Discard draft").dataset.compactVariant).toBe("danger");
  expect(button("Collapse").parentElement?.classList.contains("compact-actions-main")).toBe(true);
  expect(button("Collapse").parentElement).toBe(button("Save workflow").parentElement);
  expect(actions[0].nextElementSibling?.classList.contains("compact-help")).toBe(true);
  expect(actions[0].nextElementSibling?.textContent).toBe("Draft kept in this window.");
  await click("Discard draft");
  expect(discard).toHaveBeenCalledOnce(); expect(cancel).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  let finish!: () => void;
  save.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await click("Save workflow");
  expect(button("Discard draft").disabled).toBe(true);
  await act(async () => finish());
  expect(button("Discard draft").disabled).toBe(false);
});
it("inserts a declared input at the command cursor", async () => {
  await render(); const field = container.querySelector<HTMLTextAreaElement>('[aria-label="Step 2 command"]')!;
  field.setSelectionRange(field.value.length, field.value.length);
  await act(async () => field.dispatchEvent(new Event("select", { bubbles: true })));
  const select = container.querySelector<HTMLSelectElement>('[aria-label="Insert input in step 2"]')!;
  await act(async () => { select.value = "count"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(field.value).toBe("git status{{count}}");
});
it("clears a secret input's saved default", async () => {
  await render(); const type = [...container.querySelectorAll("select")].find((node) => node.value === "number")!;
  await act(async () => { type.value = "secret"; type.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Save workflow");
  expect(save.mock.calls[0][0].inputs[0]).not.toHaveProperty("defaultValue");
});
it("does not silently omit blank added steps and shows durable save errors", async () => {
  await render(); await click("+ Add step"); expect(button("Save workflow").disabled).toBe(true);
  await click("Delete step 3"); save.mockRejectedValueOnce(new Error("disk full")); await click("Save workflow");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("disk full"); expect(button("Save workflow").disabled).toBe(false);
});
it("starts quietly with only Name and Steps expanded and reveals optional titles", async () => {
  await render(null);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(button("Save workflow").disabled).toBe(true);
  expect([...container.querySelectorAll("details")].every((details) => !details.open)).toBe(true);
  expect(container.querySelector('[aria-label="Step 1 title"]')).toBeNull();
  await click("Add title to step 1");
  expect(container.querySelector('[aria-label="Step 1 title"]')).not.toBeNull();
  expect(button("Collapse")).toBeDefined();
  await type(container.querySelector('[aria-label="Workflow name"]')!, "New workflow");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Step 1");
});
it("renders external collected steps and reports raw draft fields without trimming or dropping blanks", async () => {
  let setValue!: (workflow: Workflow) => void;
  const onChange = vi.fn();
  function Controlled() {
    const [value, update] = useState<Workflow>({ id: "draft", name: "", steps: [""] }); setValue = update;
    return createElement(WorkflowEditor, { initial: null, value, onChange: (next) => { onChange(next); update(next); }, onSave: save, onCancel: vi.fn() });
  }
  await act(async () => root.render(createElement(Controlled)));
  await type(container.querySelector('[aria-label="Workflow name"]')!, "  My workflow  ");
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ name: "  My workflow  ", steps: [""] }));
  await act(async () => setValue({ id: "draft", name: "  My workflow  ", steps: ["", "git status"] }));
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Step 2 command"]')?.value).toBe("git status");
  expect(button("Save workflow").disabled).toBe(true);
  await click("Delete step 1"); await click("Save workflow");
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: "My workflow", steps: ["git status"] }));
});
it("discards late AI refinement after externally collected commands change the draft", async () => {
  prefs.aiEnabled = true;
  let resolve!: (result: { name: string; description: string; steps: string[] }) => void;
  vi.mocked(refineWorkflowDraft).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const onChange = vi.fn();
  const props = { initial: null, draft: { name: "History", description: "", steps: ["git status"], stopOnError: true, source: "recent" as const }, onChange, onSave: save, onCancel: vi.fn(), onDiscard: vi.fn() };
  await act(async () => root.render(createElement(WorkflowEditor, { ...props, value: wf })));
  await click("Refine visible steps with AI");
  expect(button("Discard draft").disabled).toBe(true);
  await act(async () => root.render(createElement(WorkflowEditor, { ...props, value: { ...wf, steps: [...wf.steps, "pwd"], stepTitles: [...wf.stepTitles!, ""] } })));
  await act(async () => resolve({ name: "Old refinement", description: "", steps: ["echo old"] }));
  expect(onChange).not.toHaveBeenCalled();
  expect(container.querySelector('[role="status"]')?.textContent).toContain("draft changed");
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Step 3 command"]')?.value).toBe("pwd");
  expect(button("Discard draft").disabled).toBe(false);
});
