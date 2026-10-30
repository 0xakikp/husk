// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Workflow } from "./schema";
const fixture = vi.hoisted(() => ({
  session: null as null | { key: string; revision: number; busy: boolean; workflow: Workflow; original: Workflow | null },
  workflows: [] as Workflow[], loadError: null as string | null,
}));
vi.mock("./editorSession", () => ({ useWorkflowEditorSession: () => fixture.session, addWorkflowCaptures: vi.fn() }));
vi.mock("./store", () => ({ useWorkflows: () => fixture.workflows, getWorkflowLoadError: () => fixture.loadError }));
vi.mock("./savedCommandCapture", () => ({ captureSavedCommand: vi.fn() }));
import { captureSavedCommand } from "./savedCommandCapture";
import { addWorkflowCaptures } from "./editorSession";
import { WorkflowCapture } from "./WorkflowCapture";
import { WorkflowCaptureButton } from "./WorkflowCaptureButton";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest, requestWorkflowCapture, requestWorkflowStepsCapture } from "./captureRequest";
let root: Root; let container: HTMLDivElement;
const draft = () => ({ key: "draft-1", revision: 0, busy: false, original: null, workflow: { id: "wf_1", name: "My workflow", steps: ["printf existing"] } });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.session = null; fixture.workflows = []; fixture.loadError = null; clearWorkflowCaptureRequest(); vi.mocked(addWorkflowCaptures).mockReset();
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

it("captures AI shell code into a command draft only on explicit Save command", async () => {
  const text = "  arsloginp dev host-1\n";
  await act(async () => root.render(createElement(WorkflowCaptureButton, { language: "sh", code: text })));
  expect(captureSavedCommand).not.toHaveBeenCalled();
  await click("Save command…");
  expect(captureSavedCommand).toHaveBeenCalledExactlyOnceWith(text, "ai-code");
  expect(getWorkflowCaptureRequest()).toBeNull(); expect(addWorkflowCaptures).not.toHaveBeenCalled();
});

it("opens an inert exact-text preview and cancellation never creates a draft", async () => {
  const text = "$ printf one\noutput\nprintf two "; await capture(text);
  expect(document.querySelector("pre")?.textContent).toBe(text);
  expect(document.body.textContent).toContain("kept together in one editable step");
  expect(document.querySelector<HTMLInputElement>('input[type="radio"]')?.disabled).toBe(true);
  expect(addWorkflowCaptures).not.toHaveBeenCalled(); await click("Cancel");
  expect(addWorkflowCaptures).not.toHaveBeenCalled(); expect(getWorkflowCaptureRequest()).toBeNull();
});
it("adds exact text only after explicit approval", async () => {
  await capture("  printf hello  ", "ai-code"); await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith(["  printf hello  "], "ai-code", "new", { expectedKey: null, expectedRevision: null, replaceExisting: false });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("appends to the reviewed current draft by default", async () => {
  fixture.session = draft(); await capture(); await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith(["printf hello"], "terminal-selection", "current", { expectedKey: "draft-1", expectedRevision: 0, replaceExisting: false });
});
it("requires explicit confirmation before replacing an existing draft", async () => {
  fixture.session = draft(); await capture(); await chooseNew(); expect(button("Add to draft").disabled).toBe(true);
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith(["printf hello"], "terminal-selection", "new", { expectedKey: "draft-1", expectedRevision: 0, replaceExisting: true });
});
it("rejects changed draft targets and does not retarget silently", async () => {
  fixture.session = draft(); await capture(); fixture.session = { ...draft(), key: "draft-2" }; await render();
  expect(button("Add to draft").disabled).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toContain("draft changed");
  await click("Add to draft"); expect(addWorkflowCaptures).not.toHaveBeenCalled();
});
it("disables capture while draft operations are pending", async () => {
  fixture.session = { ...draft(), busy: true }; await capture();
  expect(button("Add to draft").disabled).toBe(true); expect(document.querySelector('[role="alert"]')?.textContent).toContain("Wait");
  expect(addWorkflowCaptures).not.toHaveBeenCalled();
});
it("keeps invalid text visible but refuses to add or silently sanitize it", async () => {
  const text = "printf \x1b[31munsafe"; await capture(text);
  expect(document.querySelector("pre")?.textContent).toBe(text); expect(button("Add to draft").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("control characters");
  expect(addWorkflowCaptures).not.toHaveBeenCalled();
});
it("shows add failures without discarding the captured text", async () => {
  vi.mocked(addWorkflowCaptures).mockImplementation(() => { throw new Error("Draft has reached 100 steps."); });
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
  expect(addWorkflowCaptures).not.toHaveBeenCalled();
});

it("blocks same-key edits made while reviewing, not only replacement drafts", async () => {
  fixture.session = draft(); await capture(); fixture.session = { ...draft(), revision: 1 }; await render();
  expect(button("Add to draft").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("draft changed");
  await click("Add to draft"); expect(addWorkflowCaptures).not.toHaveBeenCalled();
});

it("selects and reorders exact commands without deduplicating or splitting shell text", async () => {
  const commands = ["git status", "printf 'one\ntwo'", "git status"];
  requestWorkflowStepsCapture(commands, "ai-code", { selectedIndices: [0, 2] }); await render();
  expect(document.body.textContent).toContain("2 of 3 selected");
  expect(document.body.textContent).toContain("examples may be alternatives");
  expect(addWorkflowCaptures).not.toHaveBeenCalled();
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1].click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Move command 2 up"]')!.click());
  expect([...document.querySelectorAll("pre")].map((node) => node.textContent)).toEqual([commands[1], commands[0], commands[2]]);
  await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith([commands[1], commands[0], commands[2]], "ai-code", "new", { expectedKey: null, expectedRevision: null, replaceExisting: false });
});

it("preserves proposal metadata and aligns titles to selected reordered commands", async () => {
  requestWorkflowStepsCapture(["pnpm lint", "pnpm test", "pnpm build"], "ai-code", { name: "Project checks", description: "Check before release.", stepTitles: ["Lint", "Tests", "Build"] }); await render();
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[0].click());
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Move command 3 up"]')!.click());
  await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith(["pnpm build", "pnpm test"], "ai-code", "new", { expectedKey: null, expectedRevision: null, replaceExisting: false, name: "Project checks", description: "Check before release.", stepTitles: ["Build", "Tests"] });
});

it("requires an explicit nonempty selection and never includes invalid candidate indices", async () => {
  requestWorkflowStepsCapture(["pnpm lint", "pnpm test"], "ai-code", { selectedIndices: [-1, 2, 1.5] }); await render();
  expect(button("Add to draft").disabled).toBe(true);
  expect(document.body.textContent).toContain("0 of 2 selected");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("at least one");
});

it("does not silently pad mismatched proposal titles", async () => {
  requestWorkflowStepsCapture(["pnpm lint", "pnpm test"], "ai-code", { stepTitles: ["Lint"] }); await render();
  expect(button("Add to draft").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("titles must match");
});

async function chooseSaved(id = "wf_saved") {
  await act(async () => document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2].click());
  await selectSaved(id);
}
async function selectSaved(id: string) {
  const select = document.querySelector<HTMLSelectElement>("select")!;
  await act(async () => { select.value = id; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
const saved = (): Workflow => ({ id: "wf_saved", name: "Release checks", steps: ["git status"], stepTitles: ["Before"], stopOnError: false });

it("opens a reviewed snapshot of a saved workflow as a draft, never a saved command", async () => {
  const original = saved(); fixture.workflows = [original, { id: "cmd", name: "Alias", kind: "command", steps: ["myalias"] }];
  requestWorkflowStepsCapture(["pnpm lint", "pnpm test"], "ai-code"); await render(); await chooseSaved();
  expect(document.querySelector("select")?.textContent).not.toContain("Alias");
  expect(document.body.textContent).toContain("1 existing + 2 selected steps");
  expect(addWorkflowCaptures).not.toHaveBeenCalled(); await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledExactlyOnceWith(["pnpm lint", "pnpm test"], "ai-code", { savedWorkflow: original }, { expectedKey: null, expectedRevision: null, replaceExisting: false });
  expect(vi.mocked(addWorkflowCaptures).mock.calls[0][2]).not.toBe(original);
});

it("requires replacement consent for saved destinations and keeps the open saved workflow out of that list", async () => {
  const current = { id: "wf_current", name: "Current saved", steps: ["printf current"] };
  fixture.session = { ...draft(), original: current }; fixture.workflows = [current, saved()];
  await capture(); await chooseSaved();
  expect(document.querySelector("select")?.textContent).not.toContain("Current saved");
  expect(button("Add to draft").disabled).toBe(true);
  await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Add to draft");
  expect(addWorkflowCaptures).toHaveBeenCalledWith(["printf hello"], "terminal-selection", { savedWorkflow: saved() }, { expectedKey: "draft-1", expectedRevision: 0, replaceExisting: true });
});

it.each(["changed", "removed"])("blocks a saved workflow that was %s after selection", async (reason) => {
  fixture.workflows = [saved()]; await capture(); await chooseSaved();
  fixture.workflows = reason === "changed" ? [{ ...saved(), steps: ["git diff"] }] : []; await render();
  expect(button("Add to draft").disabled).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("changed or was removed");
  await click("Add to draft"); expect(addWorkflowCaptures).not.toHaveBeenCalled();
  if (reason === "changed") {
    await selectSaved("wf_saved"); await click("Add to draft");
    expect(addWorkflowCaptures).toHaveBeenCalledWith(["printf hello"], "terminal-selection", { savedWorkflow: fixture.workflows[0] }, expect.anything());
  }
});

it("does not turn a saved-command draft into a multi-step workflow", async () => {
  fixture.session = { ...draft(), workflow: { id: "cmd", name: "Alias", kind: "command", steps: ["myalias"] } };
  requestWorkflowStepsCapture(["pnpm lint", "pnpm test"], "ai-code"); await render();
  expect(document.querySelector<HTMLInputElement>('input[type="radio"]')!.disabled).toBe(true);
  expect(button("Add to draft").disabled).toBe(true); // replacing it still needs consent
  expect(document.body.textContent).toContain("saved command, choose a workflow");
});

it("disables saved destinations when the durable store is read-only", async () => {
  fixture.workflows = [saved()]; fixture.loadError = "Storage unavailable";
  await capture();
  expect(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')[2].disabled).toBe(true);
  expect(button("Add to draft").disabled).toBe(false); // local new draft remains available
});
