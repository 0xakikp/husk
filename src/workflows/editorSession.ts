import { useSyncExternalStore } from "react";
import { loadWorkflows, type Workflow } from "./store";
import type { WorkflowDraft } from "./draftStore";
import { workflowCaptureStepsError } from "./captureRequest";
import { bytes } from "./schema";

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
    if (draft.kind) workflow.kind = draft.kind;
    if (workflow.kind !== "command") workflow.stepTitles = draft.steps.map((_, index) => draft.stepTitles?.[index] ?? (initial?.steps[index] === draft.steps[index] ? initial.stepTitles?.[index] ?? "" : ""));
  }
  if (workflow.kind === "command" && workflow.steps.length !== 1) throw new Error("A saved command must contain exactly one command. Use a workflow for multiple steps.");
  publish({ key: crypto.randomUUID(), workflow, original: initial ? structuredClone(initial) : null, sourceDraft: draft ? structuredClone(draft) : null, collapsed: false, busy: false, revision: 0, revealRevision: 0 });
}
export function updateWorkflowEditor(key: string, workflow: Workflow) {
  if (!session || session.key !== key || session.busy) return;
  if (workflow.id !== session.workflow.id) throw new Error("Cannot change a draft's workflow identity.");
  if (workflow.kind !== session.workflow.kind) throw new Error("Cannot change a draft's kind.");
  if (workflow.kind === "command" && workflow.steps.length !== 1) throw new Error("A saved command must contain exactly one command. Use a workflow for multiple steps.");
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

export function addWorkflowCapture(text: string, source: "terminal-selection" | "terminal-history" | "ai-code", target: "new" | "current", expectedKey: string | null, replaceExisting = false) {
  addWorkflowCaptures([text], source, target, { expectedKey, expectedRevision: session?.revision ?? null, replaceExisting });
}

export type WorkflowCaptureTarget = "new" | "current" | { savedWorkflow: Workflow };
export type WorkflowCaptureOptions = {
  expectedKey: string | null;
  expectedRevision: number | null;
  replaceExisting?: boolean;
  name?: string;
  description?: string;
  stepTitles?: readonly string[];
};

/** Stage a reviewed batch atomically. Persistence and execution remain separate. */
export function addWorkflowCaptures(
  captured: readonly string[],
  source: "terminal-selection" | "terminal-history" | "ai-code",
  target: WorkflowCaptureTarget,
  options: WorkflowCaptureOptions,
) {
  const { expectedKey, expectedRevision, replaceExisting = false } = options;
  const error = workflowCaptureStepsError(captured, options.stepTitles);
  if (error) throw new Error(error);
  for (const [label, value, limit] of [["Workflow name", options.name, 160], ["Description", options.description, 2000]] as const) {
    if (value !== undefined && (typeof value !== "string" || bytes(value) > limit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(value))) throw new Error(`${label} must be text of at most ${limit} UTF-8 bytes, without control characters.`);
  }
  if (options.name !== undefined && /[\t\r\n\u2028\u2029]/.test(options.name)) throw new Error("Workflow name must be single-line text, without control characters.");
  if ((session?.key ?? null) !== expectedKey || (session?.revision ?? null) !== expectedRevision) throw new Error("The workflow draft changed. Reopen Add to workflow to choose the draft again.");
  if (session?.busy) throw new Error("The workflow is being saved. Wait before adding another command.");
  if (target === "new") {
    startWorkflowEditor(null, { name: options.name ?? "", description: options.description ?? "", steps: [...captured], ...(options.stepTitles ? { stepTitles: [...options.stepTitles] } : {}), stopOnError: true, source }, expectedKey, replaceExisting);
    return;
  }
  if (typeof target === "object") {
    const saved = loadWorkflows().find((workflow) => workflow.id === target.savedWorkflow.id);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(target.savedWorkflow)) throw new Error("The saved workflow changed or was removed. Choose it again before appending commands.");
    if (saved.kind === "command") throw new Error("A saved command cannot contain multiple steps. Choose a workflow instead.");
    if (session?.original?.id === saved.id) throw new Error("This workflow already has an open draft. Choose Current draft to keep its unsaved edits.");
    if (saved.steps.length + captured.length > 100) throw new Error("A workflow can contain at most 100 steps.");
    startWorkflowEditor(saved, {
      name: saved.name, description: saved.description ?? "", steps: [...saved.steps, ...captured],
      stepTitles: [...saved.steps.map((_, index) => saved.stepTitles?.[index] ?? ""), ...captured.map((_, index) => options.stepTitles?.[index] ?? "")],
      stopOnError: saved.stopOnError !== false, source, targetWorkflowId: saved.id, originalSteps: [...saved.steps],
    }, expectedKey, replaceExisting);
    return;
  }
  if (!session) throw new Error("There is no current workflow draft. Choose New workflow.");
  const replacingEmpty = session.workflow.steps.length === 1 && !session.workflow.steps[0].trim();
  if (session.workflow.kind === "command" && !replacingEmpty) throw new Error("The current saved-command draft already has a command. Edit it directly or choose New workflow for multiple steps.");
  if (session.workflow.kind === "command" && captured.length !== 1) throw new Error("A saved command must contain exactly one command. Choose New workflow for multiple steps.");
  if ((replacingEmpty ? 0 : session.workflow.steps.length) + captured.length > 100) throw new Error("A workflow can contain at most 100 steps.");
  const steps = replacingEmpty ? [...captured] : [...session.workflow.steps, ...captured];
  const newTitles = captured.map((_, index) => options.stepTitles?.[index] ?? "");
  // Filling the sole blank row keeps a title the user already entered.
  if (replacingEmpty && session.workflow.stepTitles?.[0]) newTitles[0] = session.workflow.stepTitles[0];
  const stepTitles = replacingEmpty ? newTitles : [...session.workflow.steps.map((_, index) => session!.workflow.stepTitles?.[index] ?? ""), ...newTitles];
  publish({ ...session, workflow: { ...session.workflow, steps, ...(session.workflow.kind === "command" ? {} : { stepTitles }) }, collapsed: false, revision: session.revision + 1, revealRevision: session.revealRevision + 1 });
}
