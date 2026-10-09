import { CompactButton } from "../components/compact-form";
import { WorkflowDialog } from "./WorkflowDialog";
import type { WorkflowRunStatus } from "./runStatus";

export function workflowRunLabel(run: WorkflowRunStatus | undefined): string {
  if (!run) return "Not run in this window";
  switch (run.phase) {
    case "submitting": return "Submitting…";
    case "running": return "Awaiting result";
    case "succeeded": return "Last run succeeded";
    case "failed": return "Last run failed";
    default: return "Result unavailable";
  }
}

export function WorkflowRunOutput({ name, run, onClose }: { name: string; run?: WorkflowRunStatus; onClose: () => void }) {
  return <WorkflowDialog title={"Last run · " + name} onClose={onClose} variant="run"
    footer={<div className="compact-actions"><span className="wf-run-footer-note">Local memory · cleared when this window closes</span><CompactButton onClick={onClose}>Close</CompactButton></div>}>
    {run ? <div className="wf-run-output">
      <strong>{workflowRunLabel(run)}{run.exitCode != null ? ` · exit ${run.exitCode}` : ""}</strong>
      <p>{run.terminal.host ? `SSH · ${run.terminal.host}` : "Local shell"} · terminal {run.terminal.leafId}</p>
      <code>{run.terminal.cwd}</code>
      <p>{new Date(run.submittedAt).toLocaleString()}</p>
      <p className="compact-help">This is the last observed run, not a check of the current workflow or script. Opening this view never reruns it.</p>
      {run.outputUnavailableReason && <p role="status">{run.outputUnavailableReason}</p>}
      {run.output != null ? <><pre aria-label="Captured workflow output">{run.output || "(No output captured)"}</pre><p className="compact-help">Bounded terminal capture, not a complete log. {run.outputTruncated ? "Output is truncated. " : ""}Check the original terminal for more context.</p></>
        : !run.outputUnavailableReason && <p role="status">Output unavailable. Check the original terminal.</p>}
    </div> : <p role="status">Result unavailable. This window no longer has the captured run. Check the original terminal.</p>}
  </WorkflowDialog>;
}
