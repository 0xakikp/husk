import { CompactButton } from "../components/compact-form";
import { HugeiconsIcon } from "@hugeicons/react";
import { WorkflowCircle01Icon, MinusSignIcon } from "@hugeicons/core-free-icons";
import { WorkflowEditor } from "./WorkflowEditor";
import { PanelHeader } from "../shell/PanelHeader";
import { loadWorkflows, saveWorkflows, type Workflow } from "./store";
import { assertShareableWorkflows } from "./transfer";
import { dismissWorkflowSuggestionFingerprint } from "./suggestions";
import { collapseWorkflowEditor, discardWorkflowEditor, finishWorkflowEditor, getWorkflowEditorSession, setWorkflowEditorBusy, updateWorkflowEditor, useWorkflowEditorSession } from "./editorSession";
import { toast } from "../toast";
import "./workflowUi.css";

export function WorkflowSidebarEditor() {
  const session = useWorkflowEditorSession();
  if (!session || session.collapsed) return null;
  const save = async (workflow: Workflow) => {
    const currentSession = getWorkflowEditorSession();
    if (!currentSession || currentSession.key !== session.key || currentSession.busy) throw new Error("This draft is no longer available for saving.");
    if (currentSession.revision !== session.revision) throw new Error("The draft changed. Review the latest steps before saving.");
    assertShareableWorkflows([workflow]);
    const current = loadWorkflows();
    if (currentSession.original) {
      if (JSON.stringify(current.find((item) => item.id === workflow.id)) !== JSON.stringify(currentSession.original)) throw new Error("The saved workflow changed while you were editing. Your draft was kept; reopen the saved workflow before replacing it.");
    } else if (current.some((item) => item.id === workflow.id)) throw new Error("A workflow with this ID already exists. Your draft was kept.");
    setWorkflowEditorBusy(session.key, true);
    try {
      await saveWorkflows(currentSession.original ? current.map((item) => item.id === workflow.id ? workflow : item) : [...current, workflow]);
      if (currentSession.sourceDraft?.fingerprint) dismissWorkflowSuggestionFingerprint(currentSession.sourceDraft.fingerprint);
      finishWorkflowEditor(session.key, currentSession.revision);
      toast({ title: "Workflow saved", message: "Nothing was executed.", variant: "success" });
    } catch (reason) {
      // The sidebar may have been closed during the write. Report failures even
      // when the original form has unmounted; the draft remains in window memory.
      toast({ title: "Could not save workflow", message: reason instanceof Error ? reason.message : String(reason), variant: "error" });
      throw reason;
    } finally { setWorkflowEditorBusy(session.key, false); }
  };
  return <section className="compact-panel workflow-sidebar-editor" aria-label="Workflow editor"
    onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented && !session.busy) { event.stopPropagation(); collapseWorkflowEditor(session.key); } }}>
    <PanelHeader icon={WorkflowCircle01Icon} title={session.original ? "Edit workflow" : "New workflow"} actions={<CompactButton type="button" variant="ghost" icon aria-label="Collapse workflow editor" title="Collapse · keep draft" disabled={session.busy} onClick={() => collapseWorkflowEditor(session.key)}><HugeiconsIcon icon={MinusSignIcon} size={13} /></CompactButton>} />
    <div className="compact-body workflow-sidebar-editor-body">
      <WorkflowEditor key={session.key} initial={session.original} draft={session.sourceDraft} value={session.workflow} busy={session.busy}
        onChange={(workflow) => updateWorkflowEditor(session.key, workflow)} onSave={save} onCancel={() => collapseWorkflowEditor(session.key)}
        onDiscard={() => { if (window.confirm("Discard this unsaved workflow draft?")) discardWorkflowEditor(session.key); }}
        footerNote="Draft kept in this window. Save to keep it after restart." />
    </div>
  </section>;
}
