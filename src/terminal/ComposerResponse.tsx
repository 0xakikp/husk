import { useEffect, useRef, useState, type ReactNode } from "react";
import { WorkflowCaptureButton } from "../workflows/WorkflowCaptureButton";
import { isWorkflowShellLanguage } from "../workflows/captureRequest";
import { AiWorkflowProposalCard } from "../workflows/AiWorkflowProposalCard";
import { parseWorkflowProposals } from "../ai/workflowProposals";
import { getTerminalRunDecision } from "./commandRun";
import { parseComposerResponseParts } from "./composerResponseParts";
import "./ComposerResponse.css";

type Code = { lang: string; code: string };

function CodeSaveMenu({ block, blocks, blockIndex }: { block: Code; blocks: Code[]; blockIndex: number }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!container.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  return <div ref={container} className="composer-save-menu" onBlur={(event) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
  }}>
    <button ref={trigger} type="button" className="composer-code-header-btn" aria-expanded={open} title="Save a command or choose workflow steps; nothing runs"
      onMouseDown={(event) => {
        // Preserve a code highlight while opening the menu. The capture
        // buttons still validate the exact selection in their own code block.
        const selection = event.currentTarget.ownerDocument.getSelection();
        const code = event.currentTarget.closest(".composer-code-block")?.querySelector("pre code");
        if (selection && !selection.isCollapsed && code?.contains(selection.anchorNode) && code.contains(selection.focusNode)) event.preventDefault();
      }} onClick={() => setOpen((value) => !value)}>Save…</button>
    {open && <div className="composer-save-options" role="group" aria-label="Save command options" onClick={(event) => {
      if ((event.target as Element).closest("button")) setOpen(false);
    }}><WorkflowCaptureButton language={block.lang} code={block.code} blocks={blocks} blockIndex={blockIndex} /></div>}
  </div>;
}

/** Render each explanation beside its command. Interactive controls never
 * receive a partial stream, embedded protocol example, or truncated reply. */
export function ComposerResponse({ text, messageKey, streaming = false, incomplete = false, copiedKey, onCopy, onRun, renderText }: {
  text: string; messageKey: string; streaming?: boolean; incomplete?: boolean;
  copiedKey: string | null; onCopy: (code: string, key: string) => void; onRun: (command: string) => void;
  renderText: (text: string) => ReactNode;
}) {
  const parts = parseComposerResponseParts(text);
  const blocks = parts.filter((part) => part.kind === "code" && part.actionable && !streaming && !incomplete);
  let workflowCount = 0;
  return <>{parts.map((part, index) => {
    if (part.kind === "text") return part.text.trim() ? <div key={index}>{renderText(part.text)}</div> : null;
    if (part.kind === "workflow") {
      const parsed = parseWorkflowProposals(part.text);
      const remaining = Math.max(0, 3 - workflowCount);
      const proposals = parsed.proposals.slice(0, remaining);
      workflowCount += proposals.length;
      const rejected = parsed.rejected + parsed.proposals.length - proposals.length;
      return <div key={index}>
        {proposals.map((proposal, proposalIndex) => <AiWorkflowProposalCard key={proposalIndex} proposal={proposal} disabled={streaming || incomplete} />)}
        {parsed.pending && <p className="composer-workflow-status" role="status">{streaming ? "Preparing workflow proposal…" : "This workflow proposal was incomplete. Ask Husk AI to send it again; no draft was created."}</p>}
        {!!rejected && <p className="composer-workflow-status" role="status">A workflow proposal could not be reviewed because its format or limits were unsupported. Ask for a smaller, valid workflow; nothing was created or run.</p>}
      </div>;
    }
    const enabled = part.actionable && !streaming && !incomplete;
    const shell = isWorkflowShellLanguage(part.lang);
    const run = getTerminalRunDecision(part.lang, part.code);
    const key = `${messageKey}:${index}`;
    const copied = copiedKey === key;
    return <div key={index} className="composer-code-block composer-ordered-code-block">
      <div className="composer-code-header">
        <span className="lang">{part.lang || "code"}</span>
        <div className="composer-code-actions">
          <button type="button" className="composer-code-header-btn" title={copied ? "Copied" : "Copy code"} onClick={() => onCopy(part.code, key)}>{copied ? "Copied" : "Copy"}</button>
          {enabled && shell && <CodeSaveMenu block={part} blocks={blocks as Code[]} blockIndex={blocks.indexOf(part)} />}
          {enabled && run.runnable ? <button type="button" className="composer-run-btn" title="Run this one command in the active terminal" onClick={() => onRun(run.command)}>Run command</button>
            : enabled && shell && <span className="composer-code-manual" title={run.runnable ? undefined : run.reason}>review before running</span>}
        </div>
      </div>
      <pre className="composer-code-pre"><code>{part.lang === "diff" ? part.code.split("\n").map((line, lineIndex, lines) => <span key={lineIndex} className={line.startsWith("+") ? "composer-diff-line-add" : line.startsWith("-") ? "composer-diff-line-del" : undefined}>{line}{lineIndex < lines.length - 1 ? "\n" : ""}</span>) : part.code}</code></pre>
    </div>;
  })}</>;
}
