// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openSavedCommandEditor, openWorkflowEditor } from "./editorActions";
import { collapseWorkflowEditor, discardWorkflowEditor, getWorkflowEditorSession, setWorkflowEditorBusy, updateWorkflowEditor } from "./editorSession";

function reset() {
  const current = getWorkflowEditorSession();
  if (current) { setWorkflowEditorBusy(current.key, false); discardWorkflowEditor(current.key); }
}
beforeEach(() => { reset(); vi.stubGlobal("confirm", vi.fn()); });
afterEach(() => { reset(); vi.unstubAllGlobals(); });

it("opens a new saved command as an unsaved draft with exact source text and no original", () => {
  expect(openSavedCommandEditor("  ll --color=auto  ", "terminal-history")).toBe(true);
  expect(getWorkflowEditorSession()).toMatchObject({ original: null, workflow: { kind: "command", name: "", steps: ["  ll --color=auto  "] }, sourceDraft: { kind: "command", source: "terminal-history", steps: ["  ll --color=auto  "] } });
  expect(window.confirm).not.toHaveBeenCalled();
});

it("opens an empty new command and preserves existing drafts when replacement is declined", () => {
  openSavedCommandEditor();
  const first = getWorkflowEditorSession()!;
  expect(first.workflow.steps).toEqual([""]); expect(first.sourceDraft?.source).toBe("manual");
  updateWorkflowEditor(first.key, { ...first.workflow, name: "Unfinished" });
  collapseWorkflowEditor(first.key);
  const edited = getWorkflowEditorSession();
  vi.mocked(window.confirm).mockReturnValueOnce(false);
  expect(openSavedCommandEditor("pwd")).toBe(false);
  expect(getWorkflowEditorSession()).toBe(edited);
  vi.mocked(window.confirm).mockReturnValueOnce(true);
  expect(openSavedCommandEditor("pwd")).toBe(true);
  expect(getWorkflowEditorSession()?.key).not.toBe(first.key);
  expect(getWorkflowEditorSession()?.workflow.id).not.toBe(first.workflow.id);
  expect(getWorkflowEditorSession()?.original).toBeNull();
  expect(getWorkflowEditorSession()?.workflow).toMatchObject({ kind: "command", steps: ["pwd"] });
});

it("resumes editing an existing command without replacing its unsaved values", () => {
  const command = { id: "saved_command", kind: "command" as const, name: "Status", steps: ["git status"] };
  openWorkflowEditor(command);
  const first = getWorkflowEditorSession()!;
  updateWorkflowEditor(first.key, { ...first.workflow, name: "Unsaved edit" });
  collapseWorkflowEditor(first.key);
  expect(openWorkflowEditor(command)).toBe(true);
  expect(getWorkflowEditorSession()).toMatchObject({ key: first.key, collapsed: false, original: command, workflow: { kind: "command", name: "Unsaved edit" } });
  expect(window.confirm).not.toHaveBeenCalled();
});

it("does not replace a saving draft or a draft with oversized or unsafe captured text", () => {
  openSavedCommandEditor("pwd");
  const first = getWorkflowEditorSession()!;
  for (const text of ["界".repeat(2667), "echo\u0000bad", "echo\u001b[31mbad", "echo\u0085bad"]) {
    expect(() => openSavedCommandEditor(text, "terminal-selection")).toThrow();
    expect(getWorkflowEditorSession()).toBe(first);
  }
  setWorkflowEditorBusy(first.key, true);
  expect(() => openSavedCommandEditor("whoami")).toThrow("being saved");
  expect(getWorkflowEditorSession()?.workflow.steps).toEqual(["pwd"]);
  expect(window.confirm).not.toHaveBeenCalled();
});
