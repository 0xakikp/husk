import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addWorkflowCapture,
  addWorkflowCaptures,
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

  it("keeps a command draft distinct from an existing original across edits and collapse", () => {
    startWorkflowEditor(null, { kind: "command", name: "", description: "", steps: ["  git status  "], stopOnError: true, source: "terminal-history" });
    const key = current().key;
    expect(current().original).toBeNull();
    expect(current().sourceDraft).toMatchObject({ kind: "command", source: "terminal-history" });
    expect(current().workflow).toMatchObject({ kind: "command", steps: ["  git status  "] });
    updateWorkflowEditor(key, { ...current().workflow, name: "  Status  " });
    collapseWorkflowEditor(key); resumeWorkflowEditor();
    expect(current()).toMatchObject({ key, original: null, workflow: { kind: "command", name: "  Status  ", steps: ["  git status  "] } });
    expect(() => updateWorkflowEditor(key, { ...current().workflow, kind: undefined })).toThrow("kind");
    expect(() => updateWorkflowEditor(key, { ...current().workflow, steps: ["git status", "pwd"] })).toThrow("exactly one command");
    expect(current().workflow.steps).toEqual(["  git status  "]);
  });

  it("only fills a blank command draft from capture and never appends another step", () => {
    startWorkflowEditor(null, { kind: "command", name: "Status", description: "Preserve this", steps: [""], stopOnError: true, source: "manual" });
    const key = current().key;
    collapseWorkflowEditor(key);
    addWorkflowCapture("git status", "terminal-history", "current", key);
    expect(current()).toMatchObject({ collapsed: false, workflow: { kind: "command", name: "Status", description: "Preserve this", steps: ["git status"] } });
    expect(current().workflow).not.toHaveProperty("stepTitles");
    const full = current();
    expect(() => addWorkflowCapture("pwd", "terminal-selection", "current", key)).toThrow("already has a command");
    expect(current()).toBe(full);
  });

  it("preserves saved command kind when opening an edit draft without an explicit kind", () => {
    const command: Workflow = { id: "saved_command", kind: "command", name: "Status", steps: ["git status"] };
    startWorkflowEditor(command, { name: "Status", description: "Updated", steps: ["git status --short"], stopOnError: true, source: "edit" });
    expect(current().original).toEqual(command);
    expect(current().workflow).toMatchObject({ kind: "command", description: "Updated", steps: ["git status --short"] });
  });

  it("opens a batch with exact step boundaries and proposal titles without executing or persisting it", () => {
    const steps = ["  git status  ", "printf '%s\\n' \\\n  hello"];
    const titles = ["Status", "Print"];
    addWorkflowCaptures(steps, "ai-code", "new", { expectedKey: null, expectedRevision: null, name: "Inspect", description: "A proposed check", stepTitles: titles });
    expect(current()).toMatchObject({ original: null, revision: 0, workflow: { name: "Inspect", description: "A proposed check", steps, stepTitles: titles, stopOnError: true }, sourceDraft: { source: "ai-code", steps, stepTitles: titles } });
    steps[0] = "mutated"; titles[0] = "mutated";
    expect(current().workflow.steps[0]).toBe("  git status  ");
    expect(current().workflow.stepTitles).toEqual(["Status", "Print"]);
    expect(current().sourceDraft?.stepTitles).toEqual(["Status", "Print"]);
  });

  it("appends the whole batch in order while preserving existing raw values, inputs and policy", () => {
    startWorkflowEditor(fixture());
    const { key, revision, revealRevision } = current();
    collapseWorkflowEditor(key);
    addWorkflowCaptures(["git status", "git diff"], "ai-code", "current", { expectedKey: key, expectedRevision: revision, name: "Must not rename", description: "Must not replace", stepTitles: ["Status", "Diff"] });
    expect(current()).toMatchObject({ key, collapsed: false, revision: revision + 1, revealRevision: revealRevision + 1, original: fixture(), workflow: {
      ...fixture(), steps: [fixture().steps[0], "git status", "git diff"], stepTitles: ["Recent commits", "Status", "Diff"],
    } });
  });

  it("requires the reviewed revision even when the draft key has not changed", () => {
    startWorkflowEditor(fixture());
    const { key, revision } = current();
    updateWorkflowEditor(key, { ...current().workflow, name: "Newer edit" });
    const edited = current();
    for (const target of ["current", "new"] as const) {
      expect(() => addWorkflowCaptures(["pwd", "whoami"], "ai-code", target, { expectedKey: key, expectedRevision: revision, replaceExisting: true })).toThrow("draft changed");
      expect(current()).toBe(edited);
    }
  });

  it("validates the full batch and metadata before publishing any changes", () => {
    startWorkflowEditor(fixture());
    const original = current();
    const options = { expectedKey: original.key, expectedRevision: original.revision };
    for (const steps of [[], ["pwd", ""], ["pwd", "é".repeat(4001)], ["pwd", "bad\u0000"], Array(100).fill("pwd")]) {
      expect(() => addWorkflowCaptures(steps, "ai-code", "current", options)).toThrow();
      expect(current()).toBe(original);
    }
    for (const metadata of [{ name: "界".repeat(54) }, { description: "a".repeat(2001) }, { name: "bad\u0085" }, { stepTitles: ["Only one"] }, { stepTitles: ["Good", "bad\u001b"] }]) {
      expect(() => addWorkflowCaptures(["pwd", "whoami"], "ai-code", "new", { ...options, replaceExisting: true, ...metadata })).toThrow();
      expect(current()).toBe(original);
    }
  });

  it("fills an empty workflow with a batch but cannot convert an empty saved-command draft", () => {
    startWorkflowEditor();
    const { key, revision } = current();
    addWorkflowCaptures(["pwd", "whoami"], "ai-code", "current", { expectedKey: key, expectedRevision: revision, stepTitles: ["Directory", "User"] });
    expect(current().workflow.steps).toEqual(["pwd", "whoami"]);
    expect(current().workflow.stepTitles).toEqual(["Directory", "User"]);
    resetSession();
    startWorkflowEditor(null, { kind: "command", name: "", description: "", steps: [""], stopOnError: true, source: "manual" });
    const original = current();
    expect(() => addWorkflowCaptures(["pwd", "whoami"], "ai-code", "current", { expectedKey: original.key, expectedRevision: original.revision })).toThrow("exactly one command");
    expect(current()).toBe(original);
  });

  it("rejects multiline proposal names atomically while preserving multiline descriptions and shell text", () => {
    for (const separator of ["\r", "\n", "\t", "\u2028", "\u2029"]) {
      expect(() => addWorkflowCaptures(["pwd"], "ai-code", "new", { expectedKey: null, expectedRevision: null, name: `First${separator}second` })).toThrow("single-line");
      expect(getWorkflowEditorSession()).toBeNull();
    }
    addWorkflowCaptures(["printf 'one\ntwo'"], "ai-code", "new", { expectedKey: null, expectedRevision: null, name: "Inspect", description: "First line\nSecond line" });
    expect(current().workflow).toMatchObject({ name: "Inspect", description: "First line\nSecond line", steps: ["printf 'one\ntwo'"] });
  });

  it("requires consent before replacing a draft with a batch and blocks capture while saving", () => {
    startWorkflowEditor(fixture());
    const original = current();
    const options = { expectedKey: original.key, expectedRevision: original.revision };
    expect(() => addWorkflowCaptures(["pwd", "whoami"], "ai-code", "new", options)).toThrow("already an unsaved");
    expect(current()).toBe(original);
    setWorkflowEditorBusy(original.key, true);
    expect(() => addWorkflowCaptures(["pwd", "whoami"], "ai-code", "new", { ...options, replaceExisting: true })).toThrow("being saved");
    setWorkflowEditorBusy(original.key, false);
    addWorkflowCaptures(["pwd", "whoami"], "ai-code", "new", { ...options, replaceExisting: true });
    expect(current().key).not.toBe(original.key);
    expect(current().workflow.steps).toEqual(["pwd", "whoami"]);
  });
});
