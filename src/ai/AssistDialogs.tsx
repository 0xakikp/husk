import { useEffect, useState } from "react";
import { suggestCommand, explainError } from "./assist";
import {
  getActiveTerminalCwd,
  readActiveTerminal,
  runInActiveTerminal,
  typeInActiveTerminal,
} from "./terminalContext";
import { toast } from "../toast";

/** Describe a task → AI suggests a single command you can insert, run, or copy. */
export function SuggestDialog({ onClose }: { onClose: () => void }) {
  const [intent, setIntent] = useState("");
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const go = async () => {
    const q = intent.trim();
    if (!q || busy) return;
    setBusy(true);
    setErr("");
    setResult("");
    try {
      setResult(await suggestCommand(q, getActiveTerminalCwd(), readActiveTerminal()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Suggest command" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Suggest a command</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <div className="jobs-new">
            <input
              autoFocus
              value={intent}
              placeholder="Describe what you want to do…"
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void go();
                }
              }}
            />
            <button type="button" className="rb-run" onClick={() => void go()} disabled={busy} title="Suggest">
              ▶
            </button>
          </div>
          {busy ? <p className="rb-empty">Thinking…</p> : null}
          {err ? <p className="assist-err">{err}</p> : null}
          {result ? (
            <>
              <pre className="assist-cmd">{result}</pre>
              <div className="assist-actions">
                <button type="button" onClick={() => { typeInActiveTerminal(result); onClose(); }}>
                  Insert
                </button>
                <button type="button" onClick={() => { runInActiveTerminal(result); onClose(); }}>
                  Run
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(result);
                    toast({ title: "Copied command", variant: "info" });
                  }}
                >
                  Copy
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Explain a failed command + suggest a fix. */
export function ExplainDialog({
  command,
  output,
  exitCode,
  onClose,
}: {
  command: string;
  output: string;
  exitCode: number | null;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    void explainError(command, output, exitCode)
      .then((t) => alive && setText(t))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [command, output, exitCode]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Explain error" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Explain error{exitCode != null ? ` (exit ${exitCode})` : ""}</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {busy ? <p className="rb-empty">Analyzing…</p> : null}
          {err ? <p className="assist-err">{err}</p> : null}
          {text ? <div className="assist-explain">{text}</div> : null}
        </div>
      </div>
    </div>
  );
}
