import { useEffect, useId, useRef, useState } from "react";
import type { TerminalSessionStatus } from "./sessionLifecycle";
import "./TerminalSessionNotice.css";

const titles: Record<TerminalSessionStatus["state"], string> = {
  starting: "Starting shell…",
  ready: "",
  "slow-start": "Shell is taking longer to start",
  exited: "Shell exited",
  disconnected: "Terminal disconnected",
  unresponsive: "Terminal connection is not responding",
  error: "Could not connect to the shell",
};

/** Non-modal connection chrome. Checking never types into or restarts a shell. */
export function TerminalSessionNotice({ status, onCheck, onRestart }: {
  status: TerminalSessionStatus;
  onCheck: () => Promise<void>;
  onRestart: () => Promise<void>;
}) {
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [pending, setPending] = useState<"check" | "restart" | null>(null);
  const [error, setError] = useState("");
  const mounted = useRef(true);
  const pendingRef = useRef(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const restartRef = useRef<HTMLButtonElement>(null);
  const warningId = useId();

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    setConfirmRestart(false);
    setError("");
  }, [status.state]);
  useEffect(() => { if (confirmRestart) cancelRef.current?.focus(); }, [confirmRestart]);

  async function run(action: "check" | "restart") {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(action);
    setError("");
    if (action === "restart") setConfirmRestart(false);
    try {
      await (action === "check" ? onCheck() : onRestart());
    } catch (cause) {
      if (mounted.current) setError((cause instanceof Error ? cause.message : String(cause)).slice(0, 800));
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  }

  function cancel() {
    setConfirmRestart(false);
    restartRef.current?.focus();
  }

  if (status.state === "ready") return null;
  const recoverable = status.state !== "starting";
  return <section
    className="terminal-session-notice"
    aria-label="Terminal connection status"
    onMouseDown={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onContextMenu={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && confirmRestart) { event.preventDefault(); cancel(); }
    }}
  >
    <div className="terminal-session-notice-summary" role="status" aria-live="polite">
      <strong>{titles[status.state]}</strong>
      {status.message && <span>{status.message}</span>}
    </div>
    {recoverable && <div className="terminal-session-notice-actions">
      <button type="button" disabled={pending !== null} onClick={() => void run("check")}>
        {pending === "check" ? "Checking…" : "Check again"}
      </button>
      <button ref={restartRef} type="button" disabled={pending !== null}
        aria-expanded={confirmRestart} onClick={() => setConfirmRestart(true)}>
        {pending === "restart" ? "Restarting…" : "Restart shell…"}
      </button>
    </div>}
    {confirmRestart && <div className="terminal-session-notice-confirm" role="group" aria-labelledby={warningId}>
      <p id={warningId}>Restart this shell? This terminates the existing shell and may stop its running jobs. Terminal scrollback is kept; commands are not replayed.</p>
      <div className="terminal-session-notice-actions">
        <button ref={cancelRef} type="button" onClick={cancel}>Cancel</button>
        <button type="button" className="terminal-session-restart-confirm" disabled={pending !== null} onClick={() => void run("restart")}>Restart shell</button>
      </div>
    </div>}
    {error && <p className="terminal-session-notice-error" role="alert">{error}</p>}
  </section>;
}
