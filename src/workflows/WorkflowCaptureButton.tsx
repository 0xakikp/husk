import { isWorkflowShellLanguage, requestWorkflowCapture } from "./captureRequest";
import { captureSavedCommand } from "./savedCommandCapture";

/** Only explicitly labelled shell fences are offered as workflow commands. */
export function WorkflowCaptureButton({ language, code }: { language: string; code: string }) {
  if (!isWorkflowShellLanguage(language)) return null;
  return <><button type="button" className="composer-code-header-btn" title="Add to workflow"
    onClick={() => requestWorkflowCapture(code, "ai-code")}>Add to workflow…</button>
    <button type="button" className="composer-code-header-btn" title="Review and save this command; nothing runs"
      onClick={() => captureSavedCommand(code, "ai-code")}>Save command…</button></>;
}
