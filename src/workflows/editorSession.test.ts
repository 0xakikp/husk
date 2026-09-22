import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorkflowCapture,
  collapseWorkflowEditor,
  discardWorkflowEditor,
  finishWorkflowEditor,
  getWorkflowEditorSession,
  resumeWorkflowEditor,
  setWorkflowEditorBusy,
  startWorkflowEditor,
  updateWorkflowEditor,
} from "./editorSession";
import type { Workflow } from "./store";
import type { WorkflowDraft } from "./draftStore";

function resetSession() {
  const current = getWorkflowEditorSession();
  if (!current) return;
  setWorkflowEditorBusy(current.key, false);
  discardWorkflowEditor(current.key);
}
beforeEach(resetSession);
afterEach(resetSession);
function fixture(): Workflow {
  return {
    id: "wf_history", name: "History", description: "Saved description", steps: ["git log -n {{count}}"], stepTitles: ["Recent commits"], stopOnError: false,
    inputs: [{ name: "count", label: "Number of commits", type: "number", required: true, defaultValue: "5" }],
  };
}
const current = () => getWorkflowEditorSession()!;

describe("workflow editor session", () => {
  it("keeps raw unsaved values and all metadata when collapsed and resumed", () => {
    startWorkflowEditor(fixture());
    const key = current().key;
    const edited: Workflow = { ...fixture(), name: "  In progress  ", description: "Unsaved description", steps: ["git status", ""], stepTitles: ["Status", "Not finished"], inputs: [{ name: "", label: "Still typing", type: "text", required: false }] };
    updateWorkflowEditor(key, edited);
    expect(current().revision).toBe(1);
    collapseWorkflowEditor(key);
    expect(current()).toMatchObject({ key, collapsed: true, workflow: edited });
    expect(current().original).toEqual(fixture());
    resumeWorkflowEditor();
    expect(current()).toMatchObject({ key, collapsed: false, revision: 1, workflow: edited });
  });

  it("requires explicit replacement of the exact current draft", () => {
    startWorkflowEditor();
    const first = current();
    expect(() => startWorkflowEditor()).toThrow("draft changed");
    expect(() => startWorkflowEditor(null, null, first.key)).toThrow("already an unsaved");
    expect(() => startWorkflowEditor(null, null, "stale", true)).toThrow("draft changed");
    expect(current()).toBe(first);
    startWorkflowEditor(fixture(), null, first.key, true);
    expect(current().key).not.toBe(first.key);
    expect(current().workflow).toEqual(fixture());
    collapseWorkflowEditor(first.key);
    discardWorkflowEditor(first.key);
    updateWorkflowEditor(first.key, first.workflow);
    expect(current().workflow).toEqual(fixture());
    expect(current().collapsed).toBe(false);
  });

  it("clones initial, original, source, and incoming updates instead of retaining caller-owned arrays", () => {
    const initial = fixture();
    const draft: WorkflowDraft = { name: "Refined history", description: "Review this", steps: [initial.steps[0], "git status"], originalSteps: [...initial.steps], stopOnError: true, source: "evolution", targetWorkflowId: initial.id };
    startWorkflowEditor(initial, draft);
    const key = current().key;
    initial.steps[0] = "mutated"; initial.inputs![0].label = "mutated";
    draft.steps.push("mutated"); draft.originalSteps![0] = "mutated";
    expect(current().original).toEqual(fixture());
    expect(current().workflow.steps).toEqual(["git log -n {{count}}", "git status"]);
    expect(current().workflow.stepTitles).toEqual(["Recent commits", ""]);
    expect(current().sourceDraft?.originalSteps).toEqual(["git log -n {{count}}"]);
    const next = { ...fixture(), steps: ["pwd"] };
    updateWorkflowEditor(key, next);
    next.steps.push("mutated"); next.inputs![0].label = "mutated";
    expect(current().workflow.steps).toEqual(["pwd"]);
    expect(current().workflow.inputs![0].label).toBe("Number of commits");
  });

  it("cannot change an existing draft's identity or apply an evolution to a missing original", () => {
    const draft: WorkflowDraft = { name: "Update", description: "", steps: ["pwd"], stopOnError: true, source: "evolution", targetWorkflowId: "missing" };
    expect(() => startWorkflowEditor(null, draft)).toThrow("original workflow no longer exists");
    expect(getWorkflowEditorSession()).toBeNull();
    startWorkflowEditor(fixture());
    expect(() => updateWorkflowEditor(current().key, { ...fixture(), id: "other" })).toThrow("identity");
    expect(current().workflow.id).toBe("wf_history");
  });

  it("preserves unsaved input and title metadata while appending to the current draft", () => {
    startWorkflowEditor(fixture());
    const key = current().key;
    updateWorkflowEditor(key, { ...current().workflow, name: "  Untrimmed  ", description: "Uncommitted", steps: [...current().workflow.steps, ""], stepTitles: ["Recent commits", "Blank to finish"] });
    collapseWorkflowEditor(key);
    addWorkflowCapture("  git status  ", "terminal-selection", "current", key);
    expect(current()).toMatchObject({ key, collapsed: false, revision: 2, workflow: {
      name: "  Untrimmed  ", description: "Uncommitted", steps: ["git log -n {{count}}", "", "  git status  "], stepTitles: ["Recent commits", "Blank to finish", ""], inputs: fixture().inputs, stopOnError: false,
    } });
  });

  it("fills an empty sole command without losing its title or other edits", () => {
    startWorkflowEditor();
    const key = current().key;
    updateWorkflowEditor(key, { ...current().workflow, name: "Draft", steps: ["  "], stepTitles: ["My first command"] });
    addWorkflowCapture("pwd", "ai-code", "current", key);
    expect(current().workflow).toMatchObject({ name: "Draft", steps: ["pwd"], stepTitles: ["My first command"] });
    expect(current().revision).toBe(2);
  });

  it("keeps multiline captured text exact in one card, without running or splitting it", () => {
    const text = "  printf '%s\\n' 'hello'\n# review this\n  git status\n";
    addWorkflowCapture(text, "ai-code", "new", null);
    expect(current().workflow.steps).toEqual([text]);
    expect(current().sourceDraft?.source).toBe("ai-code");
    expect(current().sourceDraft?.steps).toEqual([text]);
    expect(current().workflow.name).toBe("");
  });

  it("requires a current draft and rejects stale capture choices or replacement without consent", () => {
    expect(() => addWorkflowCapture("pwd", "terminal-selection", "current", null)).toThrow("no current workflow draft");
    addWorkflowCapture("pwd", "terminal-selection", "new", null);
    const original = current();
    expect(() => addWorkflowCapture("whoami", "terminal-selection", "current", null)).toThrow("draft changed");
    expect(() => addWorkflowCapture("whoami", "terminal-selection", "new", original.key)).toThrow("already an unsaved");
    expect(current()).toBe(original);
    addWorkflowCapture("whoami", "terminal-selection", "new", original.key, true);
    expect(current().key).not.toBe(original.key);
    expect(current().workflow.steps).toEqual(["whoami"]);
  });

  it("rejects blank, oversized UTF-8, and control-character captures without changing the draft", () => {
    startWorkflowEditor();
    const original = current();
    for (const text of [" \t\n", "界".repeat(2667), "a".repeat(8001), "echo\u0000bad", "echo\u001b[31mbad", "echo\u0085bad"]) {
      expect(() => addWorkflowCapture(text, "terminal-selection", "current", original.key)).toThrow();
      expect(current()).toBe(original);
    }
    const bounded = "界".repeat(2666) + "ab";
    expect(new TextEncoder().encode(bounded).length).toBe(8000);
    addWorkflowCapture(bounded, "terminal-selection", "current", original.key);
    expect(current().workflow.steps).toEqual([bounded]);
  });

  it("enforces the 100-step limit without truncating or overwriting prior commands", () => {
    startWorkflowEditor({ ...fixture(), steps: Array.from({ length: 99 }, (_, index) => `echo ${index}`), stepTitles: undefined });
    const key = current().key;
    addWorkflowCapture("echo 99", "ai-code", "current", key);
    expect(current().workflow.steps).toHaveLength(100);
    expect(current().workflow.stepTitles).toHaveLength(100);
    const full = current();
    expect(() => addWorkflowCapture("echo 100", "ai-code", "current", key)).toThrow("at most 100");
    expect(current()).toBe(full);
  });

  it("blocks append, replacement, edits, collapse, and discard while saving", () => {
    startWorkflowEditor(fixture());
    const key = current().key;
    setWorkflowEditorBusy(key, true);
    const saving = current();
    expect(() => addWorkflowCapture("pwd", "ai-code", "current", key)).toThrow("being saved");
    expect(() => startWorkflowEditor(null, null, key, true)).toThrow("being saved");
    updateWorkflowEditor(key, { ...fixture(), name: "Must not change" });
    discardWorkflowEditor(key); collapseWorkflowEditor(key); setWorkflowEditorBusy("stale", false);
    expect(current()).toBe(saving);
    setWorkflowEditorBusy(key, false);
    updateWorkflowEditor(key, { ...fixture(), name: "Can edit again" });
    expect(current().workflow.name).toBe("Can edit again");
  });

  it("finishes only the exact saved session and revision, retaining newer edits", () => {
    startWorkflowEditor(fixture());
    const { key, revision } = current();
    updateWorkflowEditor(key, { ...fixture(), name: "Newer edit" });
    expect(() => finishWorkflowEditor(key, revision)).toThrow("draft changed while saving");
    expect(() => finishWorkflowEditor("stale", current().revision)).toThrow("draft changed while saving");
    expect(current().workflow.name).toBe("Newer edit");
    setWorkflowEditorBusy(key, true);
    finishWorkflowEditor(key, current().revision);
    expect(getWorkflowEditorSession()).toBeNull();
  });
});
