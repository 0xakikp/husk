import { CompactForm, CompactButton, CompactLabel, CompactSelect } from "../components/compact-form";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { WorkflowCircle01Icon } from "@hugeicons/core-free-icons";
import { PanelHeader } from "../shell/PanelHeader";
import { addWorkflowCaptures, useWorkflowEditorSession } from "./editorSession";
import { clearWorkflowCaptureRequest, useWorkflowCaptureRequest, workflowCaptureStepsError, type WorkflowCaptureRequest } from "./captureRequest";
import { getWorkflowLoadError, useWorkflows, type Workflow } from "./store";
import { commandPlaceholderError } from "../lib/commandPlaceholders";
import "./workflowUi.css";

export { requestWorkflowCapture } from "./captureRequest";

/** Global capture review remains independent of both the source view and the draft editor. */
export function WorkflowCapture() {
  const request = useWorkflowCaptureRequest();
  return request ? <CaptureReview key={request.id} request={request} /> : null;
}

function CaptureReview({ request }: { request: WorkflowCaptureRequest }) {
  const session = useWorkflowEditorSession();
  const workflows = useWorkflows();
  const [expectedKey] = useState(session?.key ?? null);
  const [expectedRevision] = useState(session?.revision ?? null);
  const candidates = request.steps ?? [request.text];
  const [order, setOrder] = useState(() => candidates.map((_, index) => index));
  const [selected, setSelected] = useState(() => new Set(request.selectedIndices ?? candidates.map((_, index) => index)));
  const [target, setTarget] = useState<"new" | "current" | "saved">(session && session.workflow.kind !== "command" ? "current" : "new");
  const [savedTarget, setSavedTarget] = useState<Workflow | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState("");
  const indices = order.filter((index) => selected.has(index));
  const steps = indices.map((index) => candidates[index]);
  const stepTitles = request.stepTitles ? indices.map((index) => request.stepTitles![index] ?? "") : undefined;
  const emptyChoice = !!request.candidateDetails && !steps.length;
  const placeholders = steps.some((step) => commandPlaceholderError(step));
  const changed = (session?.key ?? null) !== expectedKey || (session?.revision ?? null) !== expectedRevision;
  const metadataError = request.stepTitles && request.stepTitles.length !== candidates.length
    ? "Step titles must match the number of commands. Close this capture and request a corrected proposal."
    : request.candidateDetails && request.candidateDetails.length !== candidates.length
    ? "Source details must match the number of choices. Close this capture and choose commands again."
    : null;
  const sourceError = metadataError || workflowCaptureStepsError(steps, stepTitles);
  const visibleSourceError = metadataError || (!emptyChoice ? sourceError : null);
  const savedOptions = workflows.filter((workflow) => workflow.kind !== "command" && workflow.id !== session?.original?.id);
  const savedChanged = savedTarget && JSON.stringify(workflows.find((workflow) => workflow.id === savedTarget.id)) !== JSON.stringify(savedTarget);
  const savedError = target === "saved" ? getWorkflowLoadError() || (savedChanged ? "The saved workflow changed or was removed. Choose it again to review the updated destination." : !savedTarget ? "Choose a saved workflow to append to." : "") : "";
  const replacing = target !== "current" && expectedKey !== null;
  const currentUnavailable = !session || session.workflow.kind === "command";
  const unavailable = changed || !!session?.busy || !!sourceError || !!savedError || (target === "current" && currentUnavailable) || (replacing && !replaceExisting);
  const chooseTarget = (next: typeof target) => { setTarget(next); setReplaceExisting(false); setError(""); };
  const move = (position: number, delta: number) => {
    setOrder((previous) => {
      const next = [...previous];
      [next[position], next[position + delta]] = [next[position + delta], next[position]];
      return next;
    });
    setError("");
  };
  const close = () => clearWorkflowCaptureRequest(request.id);
  const add = () => {
    if (unavailable) return;
    try {
      addWorkflowCaptures(steps, request.source, target === "saved" ? { savedWorkflow: savedTarget! } : target, {
        expectedKey, expectedRevision, replaceExisting,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(stepTitles ? { stepTitles } : {}),
      });
      close();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Content className="compact-panel compact-dialog workflow-dialog workflow-capture-dialog" aria-describedby="workflow-capture-description">
      <PanelHeader icon={WorkflowCircle01Icon} title={<Dialog.Title className="workflow-dialog-title">Add to workflow</Dialog.Title>}
        actions={<Dialog.Close asChild><CompactButton type="button" variant="ghost" icon aria-label="Close workflow capture">×</CompactButton></Dialog.Close>} />
      <CompactForm className="compact-body workflow-dialog-body wf-form">
        <Dialog.Description className="compact-help wf-help" id="workflow-capture-description">{request.source === "ai-code" ? "AI shell code" : "Terminal selection"} · draft only. Nothing runs, saves, or is sent to AI.</Dialog.Description>
        {request.steps ? <section aria-label="Commands to include">
          <div className="wf-capture-heading"><h3>{request.name || "Choose commands"}</h3><span aria-live="polite">{steps.length} of {candidates.length} selected</span></div>
          {request.description && <p className="compact-help wf-help">{request.description}</p>}
          {!request.name && <p className="compact-help wf-help">{request.candidateDetails
            ? "These examples may be alternatives, not a sequence. Choose only what you need; source labels are kept and complex shell blocks stay intact."
            : "Code examples may be alternatives. Select only commands that belong together, in the order you want."}</p>}
          <ol className="wf-capture-steps">
            {order.map((index, position) => {
              const detail = request.candidateDetails?.[index];
              const placeholderError = commandPlaceholderError(candidates[index]);
              const label = request.stepTitles?.[index] || detail?.label || (detail?.kind === "script" ? `Shell block ${detail.blockIndex + 1}` : `Command ${index + 1}`);
              const actionName = detail?.kind === "script" ? `shell block ${detail.blockIndex + 1}` : `command ${index + 1}`;
              return <li key={index} className="wf-capture-step" data-selected={selected.has(index)}>
              <div className="wf-capture-step-head">
                <CompactLabel className="compact-check"><input type="checkbox" checked={selected.has(index)} onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((previous) => { const next = new Set(previous); if (checked) next.add(index); else next.delete(index); return next; }); setError("");
                }} />{label}</CompactLabel>
                <div className="wf-step-actions">
                  <CompactButton variant="ghost" icon disabled={position === 0} aria-label={`Move ${actionName} up`} onClick={() => move(position, -1)}>↑</CompactButton>
                  <CompactButton variant="ghost" icon disabled={position === order.length - 1} aria-label={`Move ${actionName} down`} onClick={() => move(position, 1)}>↓</CompactButton>
                </div>
              </div>
              {detail && <p className="wf-capture-origin" title={placeholderError ?? undefined}>Code block {detail.blockIndex + 1} · {detail.lineStart === detail.lineEnd ? `line ${detail.lineStart}` : `lines ${detail.lineStart}–${detail.lineEnd}`}{detail.kind === "script" ? " · kept intact" : ""}{placeholderError ? " · needs input" : ""}</p>}
              <pre aria-label={detail?.kind === "script" ? `Exact shell block ${detail.blockIndex + 1}` : `Exact command ${index + 1}`}>{candidates[index]}</pre>
              {detail?.kind === "script" && <p className="wf-capture-note">Not split: this may be a script or contain dependent shell syntax. Review and edit it in the draft.</p>}
            </li>;
            })}
          </ol>
          {emptyChoice && <p className="compact-help wf-help">Nothing is selected yet. Each selected command becomes a separate draft step.</p>}
        </section> : <><div className="wf-scope"><pre aria-label="Exact captured text" className="wf-capture-single">{request.text}</pre></div>
          <p className="compact-help wf-help">Review the exact text above, including any prompts or output. Nothing is removed automatically.</p></>}
        {steps.some((step) => /[\t\r\n\u2028\u2029]/.test(step)) && <p className="compact-help wf-warning">Multiple lines are kept together in one editable step. Split or edit them before running; workflows require one command line per step without tabs.</p>}
        {placeholders && <p className="compact-help wf-warning">Selected examples contain placeholders. Edit them in the draft or use {"{{name}}"} runtime inputs. Running is blocked until example placeholders are resolved.</p>}
        <fieldset className="compact-section"><legend>Add to</legend>
          <CompactLabel className="compact-check wf-check"><input type="radio" name="workflow-capture-target" checked={target === "current"} disabled={currentUnavailable || changed || session?.busy}
            onChange={() => chooseTarget("current")} />Current draft{session?.workflow.kind === "command" ? " · saved command, choose a workflow" : session?.workflow.name ? ` · ${session.workflow.name}` : !session ? " · none open" : " · untitled"}</CompactLabel>
          <CompactLabel className="compact-check wf-check"><input type="radio" name="workflow-capture-target" checked={target === "new"} disabled={changed || session?.busy}
            onChange={() => chooseTarget("new")} />New workflow</CompactLabel>
          <CompactLabel className="compact-check wf-check"><input type="radio" name="workflow-capture-target" checked={target === "saved"} disabled={changed || session?.busy || (!savedOptions.length && !savedTarget) || !!getWorkflowLoadError()}
            onChange={() => chooseTarget("saved")} />Append to saved workflow{!savedOptions.length && !savedTarget ? " · none available" : ""}</CompactLabel>
          {target === "saved" && <div className="wf-capture-destination">
            <CompactLabel htmlFor="workflow-capture-saved">Saved workflow</CompactLabel>
            <CompactSelect id="workflow-capture-saved" value={savedChanged ? "" : savedTarget?.id ?? ""} disabled={changed || session?.busy} onChange={(event) => {
              const workflow = savedOptions.find((item) => item.id === event.target.value);
              setSavedTarget(workflow ? structuredClone(workflow) : null); setReplaceExisting(false); setError("");
            }}>
              <option value="">Choose a workflow…</option>
              {savedOptions.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.name} · {workflow.steps.length} {workflow.steps.length === 1 ? "step" : "steps"}</option>)}
            </CompactSelect>
            {savedTarget && !savedChanged && <p className="compact-help wf-help">{savedTarget.steps.length} existing + {steps.length} selected steps. Opens an editable draft; the saved workflow stays unchanged until you save.</p>}
          </div>}
          {(target === "current" && session || target === "saved" && savedTarget && !savedChanged) && <p className="compact-help wf-help">Existing inputs, titles, and execution options are kept · {(target === "current" ? session?.workflow : savedTarget)?.stopOnError === false ? "continues after a failed step" : "stops on a failed step"}.</p>}
          {replacing && <CompactLabel className="compact-check wf-check"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />Replace the current draft and discard its unsaved edits. Saved workflows are unchanged.</CompactLabel>}
        </fieldset>
        {(visibleSourceError || changed || session?.busy || savedError || error) && <p role="alert" className="compact-error wf-error">{visibleSourceError || (changed ? "The draft changed while this capture was open. Close and add the commands again to review the new target." : session?.busy ? "Wait for the current draft operation to finish." : savedError || error)}</p>}
      </CompactForm>
      <div className="compact-form compact-actions wf-actions wf-capture-footer"><CompactButton type="button" variant="ghost" onClick={close}>Cancel</CompactButton><CompactButton type="button" variant="primary" disabled={unavailable} onClick={add}>Add to draft</CompactButton></div>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
