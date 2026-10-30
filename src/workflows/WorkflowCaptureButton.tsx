import { isWorkflowShellLanguage, requestWorkflowCapture, requestWorkflowStepsCapture } from "./captureRequest";
import { captureSavedCommand } from "./savedCommandCapture";

/** Only explicitly labelled shell fences are offered as workflow commands. */
export function WorkflowCaptureButton({ language, code, blocks, blockIndex }: {
  language: string;
  code: string;
  blocks?: readonly { lang: string; code: string }[];
  blockIndex?: number;
}) {
  if (!isWorkflowShellLanguage(language)) return null;
  const candidates = (blocks ?? []).map((block, index) => ({ ...block, index })).filter((block) => isWorkflowShellLanguage(block.lang));
  const activeIndex = blockIndex ?? blocks?.findIndex((block) => block.lang === language && block.code === code);
  // Keep candidates indexed: identical commands may be intentional separate
  // steps, and only the actively reviewed block starts selected.
  const selectedIndex = candidates.findIndex((block) => block.index === activeIndex && block.lang === language && block.code === code);
  const multiple = candidates.length > 1 && selectedIndex >= 0;
  return <><button type="button" className="composer-code-header-btn" title={multiple ? "Choose commands from this reply for a workflow; nothing runs" : "Add to workflow"}
    onClick={() => multiple
      ? requestWorkflowStepsCapture(candidates.map((block) => block.code), "ai-code", { selectedIndices: [selectedIndex] })
      : requestWorkflowCapture(code, "ai-code")}>{multiple ? "Build workflow…" : "Add to workflow…"}</button>
    <button type="button" className="composer-code-header-btn" title="Review and save this command; nothing runs"
      onClick={() => captureSavedCommand(code, "ai-code")}>Save command…</button></>;
}
