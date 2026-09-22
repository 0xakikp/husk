import { useEffect, useRef, useState } from "react";
import { LOG_HIGHLIGHTS_SYSTEM, logHighlightsPrompt, parseLogHighlights, type LogHighlight, type LogHighlightSnapshot } from "../ai/logHighlights";
import { requestScreenAssist } from "../ai/screenAssist";
import "./TerminalLogs.css";

export function LogHighlightsPanel({ snapshot, onClose }: { snapshot: LogHighlightSnapshot; onClose: () => void }) {
  const [findings, setFindings] = useState<LogHighlight[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const evidenceRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { requestRef.current?.abort(); }, []);
  useEffect(() => { if (focusedLine != null) evidenceRef.current?.querySelector<HTMLElement>(`[data-highlight-line="${focusedLine}"]`)?.scrollIntoView?.({ block: "nearest" }); }, [focusedLine]);

  const stop = () => { requestRef.current?.abort(); requestRef.current = null; setBusy(false); };
  async function analyze() {
    if (requestRef.current || !snapshot.lines.length) return;
    const controller = new AbortController(); requestRef.current = controller;
    setBusy(true); setError(""); setFindings(null);
    try {
      const raw = await requestScreenAssist({ system: LOG_HIGHLIGHTS_SYSTEM, prompt: logHighlightsPrompt(snapshot), signal: controller.signal });
      if (!controller.signal.aborted && requestRef.current === controller) setFindings(parseLogHighlights(raw, snapshot));
    } catch (cause) {
      if (!controller.signal.aborted && requestRef.current === controller) setError(cause instanceof Error ? cause.message : "Could not highlight these logs.");
    } finally { if (requestRef.current === controller) { requestRef.current = null; setBusy(false); } }
  }
  return <section className="terminal-log-highlights" aria-label="Log highlights" onKeyDown={(event) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stop(); onClose(); }
  }}>
    <div className="terminal-log-highlights-heading"><strong>HIGHLIGHTS</strong><span>{snapshot.lines.length} captured lines</span><button type="button" className="terminal-logs-close" onClick={() => { stop(); onClose(); }} aria-label="Close highlights">×</button></div>
    <p>{snapshot.source}. This snapshot stays fixed as live logs continue.{snapshot.omitted > 0 ? ` ${snapshot.omitted} lines omitted by the 120-line / 16 KB limit.` : ""}</p>
    <p>Only the captured lines below are sent to your selected AI provider when you choose Analyze.</p>
    <button type="button" className="terminal-logs-action" disabled={busy || !snapshot.lines.length} onClick={() => void analyze()}>{busy ? "Analyzing…" : findings ? "Analyze again" : "Analyze"}</button>
    {busy && <button type="button" className="terminal-logs-action" onClick={stop}>Stop</button>}
    {error && <p role="alert">{error}</p>}
    {findings?.length === 0 && <p>No useful highlights were found in this sample.</p>}
    {!!findings?.length && <ol aria-label="AI log findings">{findings.map((finding, index) => <li key={index}>{finding.summary}<span className="terminal-log-evidence-links">{finding.lineIds.map((id) => <button type="button" className="terminal-log-evidence-link" key={id} onClick={() => setFocusedLine(id)}>L{id}</button>)}</span></li>)}</ol>}
    <div ref={evidenceRef} className="terminal-log-evidence" aria-label="Captured log evidence">{snapshot.lines.map((line) => <div key={line.id} tabIndex={-1} data-highlight-line={line.id} className={`terminal-log-evidence-row${focusedLine === line.id ? " selected" : ""}`}><span>L{line.id}</span><code>{line.text}</code></div>)}</div>
  </section>;
}
