import type { Workflow } from "./store";
import type { WorkflowDraft } from "./draftStore";
import { getWorkflowEditorSession, resumeWorkflowEditor, startWorkflowEditor } from "./editorSession";

/** Opening another editor is explicit; never replace an unfinished draft silently. */
export function openWorkflowEditor(initial: Workflow | null = null, draft: WorkflowDraft | null = null): boolean {
  const current = getWorkflowEditorSession();
  if (current?.busy) throw new Error("The current workflow is being saved. Wait before opening another draft.");
  if (current && !draft && initial && current.original?.id === initial.id) { resumeWorkflowEditor(); return true; }
  if (current && !window.confirm("Replace the current unsaved workflow draft? Choose Cancel to keep it, or save it before starting another workflow.")) return false;
  startWorkflowEditor(initial, draft, current?.key ?? null, !!current);
  return true;
}

/** A new saved command is a draft, never an already-persisted original. */
export function openSavedCommandEditor(text = "", source: WorkflowDraft["source"] = "manual"): boolean {
  if (new TextEncoder().encode(text).length > 8000) throw new Error("Command exceeds the 8,000-byte limit. Select a smaller command; nothing was shortened.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Error("Command contains control characters. Copy a plain command instead.");
  return openWorkflowEditor(null, { kind: "command", name: "", description: "", steps: [text], stopOnError: true, source });
}
