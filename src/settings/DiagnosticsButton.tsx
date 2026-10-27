import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Diagnostics are generated and copied only on explicit request. */
export function DiagnosticsButton() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  const copy = async () => {
    if (busy) return;
    setBusy(true); setStatus(""); setFailed(false);
    try {
      const summary = await invoke<string>("diagnostics_snapshot");
      await writeText(summary);
      setStatus("Copied build details and the latest native panic record, if any. No terminal content is included. OS crashes and hangs still need the affected machine’s macOS report.");
    } catch {
      setFailed(true);
      setStatus("Could not copy diagnostics. Please try again.");
    } finally { setBusy(false); }
  };
  return <div className="about-diagnostics">
    <button type="button" className="about-text-action" disabled={busy} onClick={() => void copy()}
      title="Copy build details and content-free native panic metadata for troubleshooting">
      {busy ? "copying diagnostics…" : "copy diagnostics"}
    </button>
    {status && <small role={failed ? "alert" : "status"}>{status}</small>}
  </div>;
}
