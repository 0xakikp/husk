import { useSyncExternalStore } from "react";
import type { Workflow } from "./store";
import type { WorkflowDraft } from "./draftStore";

export type WorkflowEditorSession = {
  key: string;
  workflow: Workflow;
  original: Workflow | null;
  sourceDraft: WorkflowDraft | null;
  collapsed: boolean;
  busy: boolean;
  revision: number;
  /** Explicit open/resume/capture requests, not typing or save notifications. */
  revealRevision: number;
};

// Deliberately window-memory only: an unfinished selection may contain secrets.
// Saved workflows use the existing validated durable store, not this draft.
let session: WorkflowEditorSession | null = null;
const subscribers = new Set<() => void>();
function publish(next: WorkflowEditorSession | null) {
  session = next;
  for (const subscriber of subscribers) subscriber();
}
export function getWorkflowEditorSession() { return session; }
export function useWorkflowEditorSession() {
  return useSyncExternalStore((subscriber) => { subscribers.add(subscriber); return () => { subscribers.delete(subscriber); }; }, getWorkflowEditorSession, () => null);
}
export function startWorkflowEditor(initial: Workflow | null = null, draft: WorkflowDraft | null = null, expectedKey: string | null = null, replaceExisting = false) {
  if ((session?.key ?? null) !== expectedKey) throw new Error("The workflow draft changed. Review the current draft before replacing it.");
  if (session?.busy) throw new Error("The workflow is being saved. Wait before changing the draft.");
  if (session && !replaceExisting) throw new Error("There is already an unsaved workflow draft.");
  const workflow: Workflow = initial ? structuredClone(initial) : { id: "wf_" + crypto.randomUUID(), name: "", steps: [""], stopOnError: true };
  if (draft) {
    if (draft.targetWorkflowId && (!initial || draft.targetWorkflowId !== initial.id)) throw new Error("The original workflow no longer exists. Reopen the workflow list.");
    Object.assign(workflow, { name: draft.name, description: draft.description, steps: [...draft.steps], stopOnError: draft.stopOnError });
    workflow.stepTitles = draft.steps.map((_, index) => initial?.steps[index] === draft.steps[index] ? initial.stepTitles?.[index] ?? "" : "");
  }
  publish({ key: crypto.randomUUID(), workflow, original: initial ? structuredClone(initial) : null, sourceDraft: draft ? structuredClone(draft) : null, collapsed: false, busy: false, revision: 0, revealRevision: 0 });
}
export function updateWorkflowEditor(key: string, workflow: Workflow) {
  if (!session || session.key !== key || session.busy) return;
  if (workflow.id !== session.workflow.id) throw new Error("Cannot change a draft's workflow identity.");
  publish({ ...session, workflow: structuredClone(workflow), revision: session.revision + 1 });
}
export function collapseWorkflowEditor(key: string) {
  if (session?.key === key && !session.busy) publish({ ...session, collapsed: true });
}
export function resumeWorkflowEditor() { if (session) publish({ ...session, collapsed: false, revealRevision: session.revealRevision + 1 }); }
export function setWorkflowEditorBusy(key: string, busy: boolean) {
  if (session?.key === key) publish({ ...session, busy });
}
export function discardWorkflowEditor(key: string) {
  if (session?.key === key && !session.busy) publish(null);
}
export function finishWorkflowEditor(key: string, revision: number) {
  if (session?.key !== key || session.revision !== revision) throw new Error("The workflow draft changed while saving. Your current draft was kept.");
  publish(null);
}

export function addWorkflowCapture(text: string, source: "terminal-selection" | "ai-code", target: "new" | "current", expectedKey: string | null, replaceExisting = false) {
  if (!text.trim()) throw new Error("Select command text to add to a workflow.");
  if (new TextEncoder().encode(text).length > 8000) throw new Error("Selected text exceeds the 8,000-byte step limit. Select a smaller command; nothing was shortened.");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Error("Selected text contains control characters. Copy a plain command instead.");
  if ((session?.key ?? null) !== expectedKey) throw new Error("The workflow draft changed. Reopen Add to workflow to choose the draft again.");
  if (session?.busy) throw new Error("The workflow is being saved. Wait before adding another command.");
  if (target === "new") {
    startWorkflowEditor(null, { name: "", description: "", steps: [text], stopOnError: true, source }, expectedKey, replaceExisting);
    return;
  }
  if (!session) throw new Error("There is no current workflow draft. Choose New workflow.");
  const replacingEmpty = session.workflow.steps.length === 1 && !session.workflow.steps[0].trim();
  if (!replacingEmpty && session.workflow.steps.length >= 100) throw new Error("A workflow can contain at most 100 steps.");
  const steps = replacingEmpty ? [text] : [...session.workflow.steps, text];
  const stepTitles = replacingEmpty ? [session.workflow.stepTitles?.[0] ?? ""] : [...session.workflow.steps.map((_, index) => session!.workflow.stepTitles?.[index] ?? ""), ""];
  publish({ ...session, workflow: { ...session.workflow, steps, stepTitles }, collapsed: false, revision: session.revision + 1, revealRevision: session.revealRevision + 1 });
}
