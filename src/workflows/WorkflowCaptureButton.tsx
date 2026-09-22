import { isWorkflowShellLanguage, requestWorkflowCapture } from "./captureRequest";

/** Only explicitly labelled shell fences are offered as workflow commands. */
export function WorkflowCaptureButton({ language, code }: { language: string; code: string }) {
  if (!isWorkflowShellLanguage(language)) return null;
  return <button type="button" className="composer-code-header-btn" title="Add to workflow"
    onClick={() => requestWorkflowCapture(code, "ai-code")}>Add to workflow…</button>;
}
