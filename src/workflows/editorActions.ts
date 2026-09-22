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
