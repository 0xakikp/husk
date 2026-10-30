import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Workflow } from "./schema";

const store = vi.hoisted(() => ({ workflows: [] as Workflow[], save: vi.fn() }));
vi.mock("./store", () => ({ loadWorkflows: () => store.workflows, saveWorkflows: store.save }));
import { addWorkflowCaptures, discardWorkflowEditor, getWorkflowEditorSession, setWorkflowEditorBusy, startWorkflowEditor, updateWorkflowEditor } from "./editorSession";

const workflow = (): Workflow => ({
  id: "wf_saved", name: "History", description: "Keep this description", steps: ["git log -n {{count}}"], stepTitles: ["Recent commits"], stopOnError: false,
  inputs: [{ name: "count", label: "Commit count", type: "number", required: true, defaultValue: "5" }],
});
function resetSession() {
  const session = getWorkflowEditorSession();
  if (session) { setWorkflowEditorBusy(session.key, false); discardWorkflowEditor(session.key); }
}
beforeEach(() => { resetSession(); store.workflows = [workflow()]; store.save.mockClear(); });
afterEach(resetSession);
const emptyGuard = { expectedKey: null, expectedRevision: null };

it("stages a saved workflow append without persistence, preserving its original snapshot and metadata", () => {
  const selected = structuredClone(store.workflows[0]);
  const steps = ["git status", "git diff"];
  const stepTitles = ["Status", "Diff"];
  addWorkflowCaptures(steps, "ai-code", { savedWorkflow: selected }, { ...emptyGuard, name: "Do not rename", description: "Do not replace", stepTitles });
  expect(store.workflows).toEqual([workflow()]);
  expect(store.save).not.toHaveBeenCalled();
  expect(getWorkflowEditorSession()).toMatchObject({
    original: workflow(), collapsed: false, revision: 0,
    workflow: { ...workflow(), steps: [workflow().steps[0], ...steps], stepTitles: ["Recent commits", ...stepTitles] },
    sourceDraft: { source: "ai-code", targetWorkflowId: selected.id, originalSteps: workflow().steps },
  });
  selected.steps[0] = "changed"; selected.inputs![0].label = "changed"; steps[0] = "changed"; stepTitles[0] = "changed";
  expect(getWorkflowEditorSession()?.original).toEqual(workflow());
  expect(getWorkflowEditorSession()?.workflow.steps).toEqual([workflow().steps[0], "git status", "git diff"]);
  expect(getWorkflowEditorSession()?.workflow.stepTitles).toEqual(["Recent commits", "Status", "Diff"]);
});

it("rejects changed or deleted saved targets instead of retargeting a stale review", () => {
  const selected = structuredClone(store.workflows[0]);
  store.workflows = [{ ...selected, name: "Renamed elsewhere" }];
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, emptyGuard)).toThrow("changed or was removed");
  expect(getWorkflowEditorSession()).toBeNull();
  store.workflows = [];
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, emptyGuard)).toThrow("changed or was removed");
  expect(getWorkflowEditorSession()).toBeNull();
  expect(store.save).not.toHaveBeenCalled();
});

it("does not silently convert a saved command to a workflow", () => {
  const command: Workflow = { id: "command", name: "Status", kind: "command", steps: ["gs"] };
  store.workflows = [command];
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: command }, emptyGuard)).toThrow("Choose a workflow");
  expect(getWorkflowEditorSession()).toBeNull();
  expect(store.workflows).toEqual([command]);
});

it("redirects an already-open saved target to Current draft, even with replacement consent", () => {
  const selected = structuredClone(store.workflows[0]);
  startWorkflowEditor(selected);
  const first = getWorkflowEditorSession()!;
  updateWorkflowEditor(first.key, { ...first.workflow, name: "Unsaved name" });
  const edited = getWorkflowEditorSession()!;
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, { expectedKey: edited.key, expectedRevision: edited.revision, replaceExisting: true })).toThrow("Choose Current draft");
  expect(getWorkflowEditorSession()).toBe(edited);
  expect(store.save).not.toHaveBeenCalled();
});

it("requires reviewed draft identity, revision and explicit consent when switching to a saved target", () => {
  const selected = structuredClone(store.workflows[0]);
  startWorkflowEditor();
  const original = getWorkflowEditorSession()!;
  const guard = { expectedKey: original.key, expectedRevision: original.revision };
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, guard)).toThrow("already an unsaved");
  expect(getWorkflowEditorSession()).toBe(original);
  updateWorkflowEditor(original.key, { ...original.workflow, name: "Newer edit" });
  const edited = getWorkflowEditorSession()!;
  expect(() => addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, { ...guard, replaceExisting: true })).toThrow("draft changed");
  expect(getWorkflowEditorSession()).toBe(edited);
  addWorkflowCaptures(["pwd"], "ai-code", { savedWorkflow: selected }, { expectedKey: edited.key, expectedRevision: edited.revision, replaceExisting: true });
  expect(getWorkflowEditorSession()?.key).not.toBe(edited.key);
  expect(getWorkflowEditorSession()?.original).toEqual(selected);
  expect(store.save).not.toHaveBeenCalled();
});

it("rejects an oversized combined workflow without replacing an unrelated draft", () => {
  const selected = { ...workflow(), steps: Array(99).fill("pwd"), stepTitles: undefined };
  store.workflows = [selected];
  startWorkflowEditor();
  const original = getWorkflowEditorSession()!;
  const guard = { expectedKey: original.key, expectedRevision: original.revision, replaceExisting: true };
  expect(() => addWorkflowCaptures(["whoami", "hostname"], "ai-code", { savedWorkflow: selected }, guard)).toThrow("at most 100");
  expect(getWorkflowEditorSession()).toBe(original);
  addWorkflowCaptures(["whoami"], "ai-code", { savedWorkflow: selected }, guard);
  expect(getWorkflowEditorSession()?.workflow.steps).toHaveLength(100);
  expect(getWorkflowEditorSession()?.workflow.stepTitles).toHaveLength(100);
  expect(store.workflows[0].steps).toHaveLength(99);
  expect(store.save).not.toHaveBeenCalled();
});
