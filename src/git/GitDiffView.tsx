import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { diffLines, stageableHunks, type DiffLine } from "./patches";
import "./GitDiffView.css";

const MAX_RENDERED_LINES = 6_000;
export type GitDiffViewProps = {
  text: string;
  title?: string;
  onOpenFile?: () => void;
  onStageHunk?: (hunkIndex: number) => Promise<void>;
  stagingDisabled?: boolean;
};

/** A read-only code review, with optional explicitly authorized index actions.
 * This component never runs code, writes a file, or chooses a Git target. */
export function GitDiffView({ text, title = "Review changes", onOpenFile, onStageHunk, stagingDisabled = false }: GitDiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState("");
  const running = useRef(false);
  const generation = useRef(0);
  const lines = useMemo(() => diffLines(text), [text]);
  const stageable = useMemo(() => !!onStageHunk && lines.length <= MAX_RENDERED_LINES && stageableHunks(text).length > 0, [text, lines.length, onStageHunk]);
  const counts = useMemo(() => lines.reduce((sum, line) => ({ added: sum.added + Number(line.kind === "addition"), removed: sum.removed + Number(line.kind === "deletion") }), { added: 0, removed: 0 }), [lines]);
  useEffect(() => { generation.current++; setError(""); }, [text]);
  useEffect(() => () => { generation.current++; }, []);
  const stage = async (index: number) => {
    if (!onStageHunk || !stageable || stagingDisabled || running.current) return;
    running.current = true; setPending(index); setError("");
    const request = generation.current;
    try { await onStageHunk(index); }
    catch (cause) { if (request === generation.current) setError(cause instanceof Error ? cause.message.slice(0, 1500) : "Could not stage this hunk. Refresh and review the diff."); }
    finally { running.current = false; setPending(null); }
  };
  const body = <>
    <div className="git-diff-toolbar">
      <span className="git-diff-readonly">Read-only review</span>
      <span className="git-diff-counts" aria-label={`${counts.added} added lines, ${counts.removed} removed lines`}><span>+{counts.added}</span><span>−{counts.removed}</span></span>
      {onOpenFile && <button type="button" onClick={onOpenFile}>Open file</button>}
      {!expanded && <button type="button" onClick={() => setExpanded(true)}>Expand diff</button>}
    </div>
    {error && <p className="git-diff-error" role="alert">{error}</p>}
    {stageable && <p className="git-diff-hint">Stage a hunk to include only that change in your next commit. Your working file stays unchanged.</p>}
    <div className="git-diff-code" tabIndex={0} role="region" aria-label="Changes with old and new line numbers">
      <pre>{lines.slice(0, MAX_RENDERED_LINES).map((line, index) => <DiffRow key={index} line={line} stage={stageable ? stage : undefined} disabled={stagingDisabled || pending !== null} pending={pending} />)}</pre>
      {!text && <p className="git-diff-empty">No differences to display.</p>}
    </div>
    {lines.length > MAX_RENDERED_LINES && <p className="git-diff-hint" role="status">Preview limited to {MAX_RENDERED_LINES.toLocaleString()} lines. Use the editor or terminal for the complete review; hunk staging is disabled.</p>}
  </>;
  return <>
    <section className="git-diff-view" aria-label={title}>{body}</section>
    {expanded && <Dialog.Root open modal={false} onOpenChange={setExpanded}>
      <Dialog.Portal>
        <Dialog.Content className="git-diff-expanded" aria-describedby={undefined} onInteractOutside={(event) => event.preventDefault()}>
          <div className="git-diff-expanded-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close aria-label="Close expanded diff">×</Dialog.Close></div>
          <section className="git-diff-view git-diff-view-expanded">{body}</section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>}
  </>;
}

function DiffRow({ line, stage, disabled, pending }: { line: DiffLine; stage?: (index: number) => Promise<void>; disabled: boolean; pending: number | null }) {
  return <span className={`git-diff-line git-diff-line-${line.kind}`}>
    <span className="git-diff-lineno" aria-hidden="true">{line.oldLine ?? ""}</span>
    <span className="git-diff-lineno" aria-hidden="true">{line.newLine ?? ""}</span>
    <span className="git-diff-source">{line.text}{"\n"}</span>
    {stage && line.hunkIndex !== undefined && <button type="button" className="git-diff-stage" aria-label={`Stage hunk ${line.hunkIndex + 1}`} disabled={disabled} onClick={() => void stage(line.hunkIndex!)}>{pending === line.hunkIndex ? "Staging…" : "Stage hunk"}</button>}
  </span>;
}
