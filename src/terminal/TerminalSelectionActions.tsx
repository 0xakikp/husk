import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Terminal } from "@xterm/xterm";
import { selectionLines, validateStagedCommand } from "../ai/screenSelection";
import "./TerminalSelectionActions.css";

export type TerminalSelectionSnapshot = { text: string; x: number; y: number };
type SelectionTerminal = Pick<Terminal, "element" | "getSelection" | "onSelectionChange" | "onScroll" | "focus">;

/** A passive selection affordance. It never focuses or writes to the terminal,
 * fetches AI, or changes native copy/paste/Enter handling. */
export function TerminalSelectionActions({ terminal, enabled, aiEnabled, onAction }: {
  terminal: SelectionTerminal | null;
  enabled: boolean;
  aiEnabled: boolean;
  onAction: (action: "peek" | "review" | "save" | "workflow", selection: TerminalSelectionSnapshot) => void;
}) {
  const [selection, setSelection] = useState<TerminalSelectionSnapshot | null>(null);
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    setSelection(null);
    if (!terminal || !enabled) return;
    const hide = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; setSelection(null); };
    const mouseUp = (event: MouseEvent) => {
      if (event.button !== 0 || !terminal.element?.contains(event.target as Node)) return;
      hide();
      timer.current = setTimeout(() => {
        timer.current = null;
        const text = terminal.getSelection();
        // Local saving need not inherit the much smaller AI context budget.
        if (!text.trim() || text.length > 1024 * 1024) return;
        setSelection({ text, x: event.clientX, y: event.clientY + 12 });
      }, 0);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "F6" && !event.ctrlKey && !event.metaKey && !event.altKey && panel.current && terminal.element?.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation(); panel.current.querySelector<HTMLButtonElement>("button")?.focus(); return;
      }
      if (event.key === "Escape" && panel.current?.contains(event.target as Node)) {
        event.preventDefault(); event.stopPropagation(); hide(); terminal.focus(); return;
      }
      if (event.key === "Escape" || !panel.current?.contains(event.target as Node)) hide();
    };
    const outside = (event: MouseEvent) => { if (!panel.current?.contains(event.target as Node)) hide(); };
    const changed = terminal.onSelectionChange(hide);
    const scrolled = terminal.onScroll(hide);
    document.addEventListener("mouseup", mouseUp);
    document.addEventListener("mousedown", outside);
    document.addEventListener("keydown", key, true);
    document.addEventListener("contextmenu", hide);
    window.addEventListener("resize", hide);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      changed.dispose(); scrolled.dispose();
      document.removeEventListener("mouseup", mouseUp);
      document.removeEventListener("mousedown", outside);
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("contextmenu", hide);
      window.removeEventListener("resize", hide);
    };
  }, [terminal, enabled]);

  useLayoutEffect(() => {
    if (!selection) return;
    const rect = panel.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(8, Math.min(selection.x, window.innerWidth - rect.width - 8)), top: Math.max(8, Math.min(selection.y, window.innerHeight - rect.height - 8)) });
  }, [selection, aiEnabled]);

  if (!selection || !enabled) return null;
  let explainable = false;
  try { selectionLines(selection.text); explainable = true; } catch { /* Local saving has its own larger cap. */ }
  let reviewable = false;
  try { validateStagedCommand(selection.text); reviewable = true; } catch { /* Explain and save still work for multiline text. */ }
  const choose = (action: "peek" | "review" | "save" | "workflow") => {
    // Never act on text that has changed underneath the toolbar.
    if (terminal?.getSelection() === selection.text) onAction(action, selection);
    setSelection(null);
  };
  return createPortal(<div ref={panel} role="group" aria-label="Selected terminal text actions" title="F6 to focus selection actions · Escape to dismiss" className="terminal-selection-actions" style={position}
    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
    onClick={(event) => event.stopPropagation()} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}>
    {aiEnabled && explainable && <button type="button" onClick={() => choose("peek")}>Explain</button>}
    {aiEnabled && reviewable && <button type="button" title="Review this command without running it" onClick={() => choose("review")}>Review command</button>}
    <button type="button" title="Review and add this exact text to a workflow draft; nothing runs" onClick={() => choose("workflow")}>Add to workflow…</button>
    <button type="button" onClick={() => choose("save")}>Save to Vault</button>
    <span className="terminal-selection-key" aria-hidden="true">F6</span>
    <button type="button" aria-label="Dismiss selection actions" onClick={() => setSelection(null)}>×</button>
  </div>, document.body);
}
