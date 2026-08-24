import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { monaco } from "../editor/monacoEnv";
import { getPrefs } from "../settings/preferences";
import { fontStack } from "../styles/fonts";
import { sheetHost } from "../components/sheetHost";

function changedLineCount(original: string, modified: string): number {
  const left = original.split(/\r?\n/);
  const right = modified.split(/\r?\n/);
  const length = Math.max(left.length, right.length);
  let changed = 0;
  for (let index = 0; index < length; index += 1) {
    if (left[index] !== right[index]) changed += 1;
  }
  return changed;
}

export function NoteOrganizeReview({
  name,
  original,
  organized,
  applying,
  onApply,
  onClose,
}: {
  name: string;
  original: string;
  organized: string;
  applying: boolean;
  onApply: () => void;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const changes = useMemo(() => changedLineCount(original, organized), [original, organized]);

  useEffect(() => {
    if (!hostRef.current) return;
    const originalModel = monaco.editor.createModel(original, "markdown");
    const organizedModel = monaco.editor.createModel(organized, "markdown");
    const prefs = getPrefs();
    const editor = monaco.editor.createDiffEditor(hostRef.current, {
      theme: prefs.theme === "dark" ? "husk-black" : "vs",
      automaticLayout: true,
      originalEditable: false,
      readOnly: true,
      renderSideBySide: true,
      enableSplitViewResizing: true,
      renderOverviewRuler: false,
      fontSize: 12,
      fontFamily: fontStack(prefs.fontFamily),
      lineNumbers: "on",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      wordWrap: "on",
      padding: { top: 8, bottom: 8 },
    });
    editor.setModel({ original: originalModel, modified: organizedModel });
    return () => {
      editor.dispose();
      originalModel.dispose();
      organizedModel.dispose();
    };
  }, [original, organized]);

  return createPortal(
    <div className="sidebar-sheet" onClick={applying ? undefined : onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`Review organized ${name}`}
        className="pointer-events-auto flex h-[min(760px,calc(100vh-48px))] w-[min(1100px,calc(100vw-48px))] flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header data-drag-handle className="flex h-11 shrink-0 cursor-move items-center border-b border-border px-4">
          <div className="min-w-0">
            <h2 className="truncate font-mono text-xs font-semibold">Organize note · {name}</h2>
            <p className="font-mono text-[9px] text-muted-foreground">Original on the left · proposed Markdown on the right · {changes} changed lines</p>
          </div>
          <button
            type="button"
            disabled={applying}
            className="ml-auto inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={onClose}
            aria-label="Close review"
          >
            ×
          </button>
        </header>
        <div ref={hostRef} className="min-h-0 flex-1" />
        <footer className="flex h-12 shrink-0 items-center gap-2 border-t border-border px-4">
          <span className="mr-auto max-w-[60%] font-mono text-[9px] text-muted-foreground">
            Husk will apply only this reviewed version. If the note changed meanwhile, it will stop instead of overwriting it.
          </span>
          <button
            type="button"
            disabled={applying}
            className="h-7 rounded-md px-3 font-mono text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            onClick={onClose}
          >
            Keep original
          </button>
          <button
            type="button"
            disabled={applying}
            className="h-7 rounded-md border border-primary/55 bg-primary/10 px-3 font-mono text-[10px] text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
            onClick={onApply}
          >
            {applying ? "Applying…" : "Apply organized note"}
          </button>
        </footer>
      </section>
    </div>,
    sheetHost(),
  );
}
