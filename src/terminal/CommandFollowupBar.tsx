import { useEffect, useState } from "react";
import type { CommandFollowup } from "../ai/commandFollowup";
import "./CommandFollowupBar.css";

export function CommandFollowupBar({ enabled, state, busy, onToggle, onStop, onAnalyze, onInterrupt }: {
  enabled: boolean;
  state?: CommandFollowup;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onStop: () => void;
  onAnalyze: () => void;
  onInterrupt: () => void;
}) {
  const [confirmInterrupt, setConfirmInterrupt] = useState(false);
  useEffect(() => setConfirmInterrupt(false), [state?.id, state?.completed]);
  return <div className="composer-followup" aria-label="Command follow-up">
    <div className="composer-followup-row">
      <label title="After a command you run from this chat finishes, send its checked output to your selected AI model for analysis. This never runs the next command.">
        <input type="checkbox" checked={enabled} onChange={(event) => onToggle(event.target.checked)} />
        Auto follow-up
      </label>
      <span>Run → result → suggestion</span>
    </div>
    {state && state.phase !== "done" && <>
      <p role="status">{state.note}</p>
      <div className="composer-followup-row">
        {(state.phase === "waiting" || state.phase === "ready" || state.phase === "analyzing") && <button type="button" onClick={onStop}>Stop follow-up</button>}
        {state.phase === "paused" && state.result && <button type="button" disabled={busy} onClick={onAnalyze} title="Explain this saved result once. Does not resume Task or run another command.">Analyze result</button>}
        {!state.completed && <button type="button" onClick={() => setConfirmInterrupt((value) => !value)}>Interrupt command…</button>}
      </div>
      {confirmInterrupt && !state.completed && <div className="composer-interrupt-review">
        <p>Send Ctrl+C to this command’s original terminal? This may stop its foreground job. It cannot undo changes, and some programs ignore it.</p>
        <button type="button" onClick={() => setConfirmInterrupt(false)}>Cancel</button>
        <button type="button" onClick={() => { setConfirmInterrupt(false); onInterrupt(); }}>Send Ctrl+C</button>
      </div>}
    </>}
  </div>;
}
