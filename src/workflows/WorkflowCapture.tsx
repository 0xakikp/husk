import { CompactForm, CompactButton, CompactLabel } from "../components/compact-form";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { WorkflowCircle01Icon } from "@hugeicons/core-free-icons";
import { PanelHeader } from "../shell/PanelHeader";
import { addWorkflowCapture, useWorkflowEditorSession } from "./editorSession";
import { clearWorkflowCaptureRequest, useWorkflowCaptureRequest, workflowCaptureError, type WorkflowCaptureRequest } from "./captureRequest";
import "./workflowUi.css";

export { requestWorkflowCapture } from "./captureRequest";

/** Global capture review remains independent of both the source view and the draft editor. */
export function WorkflowCapture() {
  const request = useWorkflowCaptureRequest();
  return request ? <CaptureReview key={request.id} request={request} /> : null;
}

function CaptureReview({ request }: { request: WorkflowCaptureRequest }) {
  const session = useWorkflowEditorSession();
  const [expectedKey] = useState(session?.key ?? null);
  const [target, setTarget] = useState<"new" | "current">(session ? "current" : "new");
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [error, setError] = useState("");
  const changed = (session?.key ?? null) !== expectedKey;
  const sourceError = workflowCaptureError(request.text);
  const replacing = target === "new" && expectedKey !== null;
  const unavailable = changed || !!session?.busy || !!sourceError || (target === "current" && !session) || (replacing && !replaceExisting);
  const close = () => clearWorkflowCaptureRequest(request.id);
  const add = () => {
    if (unavailable) return;
    try {
      addWorkflowCapture(request.text, request.source, target, expectedKey, replaceExisting);
      close();
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return <Dialog.Root open onOpenChange={(open) => { if (!open) close(); }}>
    <Dialog.Portal><Dialog.Content className="compact-panel compact-dialog workflow-dialog" style={{ width: "min(480px, calc(100vw - 32px))", zIndex: 100 }} aria-describedby="workflow-capture-description">
      <PanelHeader icon={WorkflowCircle01Icon} title={<Dialog.Title className="workflow-dialog-title">Add to workflow</Dialog.Title>}
        actions={<Dialog.Close asChild><CompactButton type="button" variant="ghost" icon aria-label="Close workflow capture">×</CompactButton></Dialog.Close>} />
      <CompactForm className="compact-body workflow-dialog-body wf-form">
        <Dialog.Description className="compact-help wf-help" id="workflow-capture-description">{request.source === "ai-code" ? "AI shell code" : "Terminal selection"} · saved to the draft only. Nothing runs or is sent to AI.</Dialog.Description>
        <div className="wf-scope"><pre aria-label="Exact captured text" style={{ maxHeight: "min(220px, 30dvh)", overflow: "auto" }}>{request.text}</pre></div>
        <p className="compact-help wf-help">Review the exact text above, including any prompts or output. Nothing is removed automatically.</p>
        {/[\r\n\u2028\u2029]/.test(request.text) && <p className="compact-help wf-warning">Multiple lines are kept together in one editable step. Split or edit them before running; workflows require one command line per step.</p>}
        <fieldset className="compact-section"><legend>Add to</legend>
          <CompactLabel className="compact-check wf-check"><input type="radio" name="workflow-capture-target" checked={target === "current"} disabled={!session || changed || session.busy}
            onChange={() => { setTarget("current"); setReplaceExisting(false); setError(""); }} />Current draft{session?.workflow.name ? ` · ${session.workflow.name}` : !session ? " · none open" : " · untitled"}</CompactLabel>
          <CompactLabel className="compact-check wf-check"><input type="radio" name="workflow-capture-target" checked={target === "new"} disabled={changed || session?.busy}
            onChange={() => { setTarget("new"); setReplaceExisting(false); setError(""); }} />New workflow</CompactLabel>
          {replacing && <CompactLabel className="compact-check wf-check"><input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.target.checked)} />Replace the current draft and discard its unsaved edits. Saved workflows are unchanged.</CompactLabel>}
        </fieldset>
        {(sourceError || changed || session?.busy || error) && <p role="alert" className="compact-error wf-error">{sourceError || (changed ? "The draft changed while this capture was open. Close and add the command again to review the new target." : session?.busy ? "Wait for the current draft operation to finish." : error)}</p>}
        <div className="compact-actions wf-actions"><CompactButton type="button" variant="ghost" onClick={close}>Cancel</CompactButton><CompactButton type="button" variant="primary" disabled={unavailable} onClick={add}>Add to draft</CompactButton></div>
      </CompactForm>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
