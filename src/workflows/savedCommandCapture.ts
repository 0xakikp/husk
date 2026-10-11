import { openSavedCommandEditor } from "./editorActions";
import { workflowCaptureError } from "./captureRequest";
import type { WorkflowDraft } from "./draftStore";
import { toast } from "../toast";

/** Open an exact-text draft only. Saving and running are separate user actions. */
export function captureSavedCommand(text: string, source: WorkflowDraft["source"]): boolean {
  try {
    const error = workflowCaptureError(text);
    if (error) throw new Error(error);
    return openSavedCommandEditor(text, source);
  } catch (reason) {
    toast({ title: "Could not open command draft", message: reason instanceof Error ? reason.message : String(reason), variant: "error" });
    return false;
  }
}
