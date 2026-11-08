import type { MouseEvent } from "react";
import { isWorkflowShellLanguage, requestWorkflowCapture, requestWorkflowStepsCapture } from "./captureRequest";
import { captureSavedCommand } from "./savedCommandCapture";
import { getAiCommandCandidates } from "./aiCommandCandidates";
import { bytes } from "./schema";

/** A highlight is meaningful only inside this action's currently displayed code. */
function selectedCode(button: HTMLButtonElement, expectedCode: string): string | null {
  const block = button.closest(".composer-code-block");
  const code = block?.querySelector("pre.composer-code-pre code");
  if (!code || code.closest(".composer-code-block") !== block || code.textContent !== expectedCode) return null;
  const selection = button.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!code.contains(range.startContainer) || !code.contains(range.endContainer)) return null;
  const text = range.toString();
  return text.trim() ? text : null;
}

/** Only explicitly labelled shell fences are offered as workflow commands. */
export function WorkflowCaptureButton({ language, code, blocks, blockIndex }: {
  language: string;
  code: string;
  blocks?: readonly { lang: string; code: string }[];
  blockIndex?: number;
}) {
  if (!isWorkflowShellLanguage(language)) return null;
  const activeIndex = blockIndex ?? blocks?.findIndex((block) => block.lang === language && block.code === code);
  // Stale tab metadata must never substitute a different code block. Keep
  // repeated commands indexed: identical examples may have different meanings.
  const matchingActive = activeIndex !== undefined && activeIndex >= 0
    && blocks?.[activeIndex]?.lang === language && blocks[activeIndex].code === code;
  const candidates = getAiCommandCandidates(matchingActive ? blocks! : [{ lang: language, code }]);
  const needsChoices = candidates.length !== 1 || candidates[0].kind === "script" || candidates[0].text !== code;
  const preserveSelection = (event: MouseEvent<HTMLButtonElement>) => {
    if (selectedCode(event.currentTarget, code) !== null) event.preventDefault();
  };
  return <><button type="button" className="composer-code-header-btn" title={needsChoices ? "Choose commands or highlighted text for a workflow; nothing runs" : "Add this command or highlighted text to a workflow; nothing runs"}
    onMouseDown={preserveSelection}
    onClick={(event) => {
      const selection = selectedCode(event.currentTarget, code);
      if (selection !== null || !needsChoices) {
        requestWorkflowCapture(selection ?? code, "ai-code");
        return;
      }
      const stepTitles = candidates.map(({ label }) => bytes(label) <= 160 && !/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(label) ? label : "");
      requestWorkflowStepsCapture(candidates.map((candidate) => candidate.text), "ai-code", {
        selectedIndices: candidates.length === 1 && candidates[0].kind === "command" ? [0] : [],
        candidateDetails: candidates.map(({ text: _text, ...details }) => details),
        ...(stepTitles.some(Boolean) ? { stepTitles } : {}),
      });
    }}>{needsChoices ? "Choose commands…" : "Add to workflow…"}</button>
    <button type="button" className="composer-code-header-btn" title="Review and save this command; nothing runs"
      onMouseDown={preserveSelection}
      onClick={(event) => captureSavedCommand(selectedCode(event.currentTarget, code) ?? code, "ai-code")}>Save command…</button></>;
}
