import { useRef, useState } from "react";
import { CfgAct, CfgBool, CfgComment, CfgEnum, CfgRow } from "../config/controls";
import { getPrefs, setPrefs, usePrefs } from "../preferences";

/** Saving output is explicit consent, separate from reopening the pane layout.
 * Loading settings alone never opens the terminal-output archive. */
export function TerminalHistorySettings() {
  const prefs = usePrefs();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const deleting = useRef(false);
  const retentionOptions = [...new Set([1, 7, 30, prefs.terminalScrollbackRetentionDays])].sort((a, b) => a - b);

  const deleteHistory = async () => {
    if (deleting.current) return;
    deleting.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const { scrollbackArchive } = await import("../../terminal/scrollbackArchive");
      await scrollbackArchive.clearAll();
      setConfirmDelete(false);
      setStatus("Saved terminal history deleted. Live terminal output and shell history were not cleared. New output can still be saved while this setting is on.");
    } catch {
      setError(getPrefs().terminalRestoreScrollback
        ? "Could not delete saved terminal history. Nothing has been confirmed deleted; try again."
        : "Output recording is off, but saved history could not be deleted. Try Delete saved terminal history again.");
    } finally {
      deleting.current = false;
      setBusy(false);
    }
  };

  return <>
    <CfgRow name="restoreTerminalHistory" searchId="terminalRestoreScrollback"
      comment="Opt in to saving current and future terminal output locally between launches. Restores readable text only; shells start fresh and commands are never replayed. Turning this off deletes saved terminal history.">
      <CfgBool value={prefs.terminalRestoreScrollback} onChange={(terminalRestoreScrollback) => {
        setPrefs({ terminalRestoreScrollback });
        setStatus("");
        setError("");
        setConfirmDelete(false);
        if (!terminalRestoreScrollback) void deleteHistory();
      }} />
    </CfgRow>
    <CfgComment>Saved output may contain credentials or other sensitive data. It is stored as plain text, not encrypted by Husk.</CfgComment>
    <CfgComment>Up to 10,000 rows or 1 MiB of output per pane, within a 20 MiB total limit. Oldest saved output is removed when limits are reached.</CfgComment>
    {prefs.terminalRestoreScrollback && !prefs.sessionRestoreEnabled && <CfgComment>
      <span role="status">Output recording is on, but restoring it at launch also requires Restore session. Your session-restore preference has not been changed.</span>
    </CfgComment>}
    <CfgRow name="terminalHistoryRetention" searchId="terminalScrollbackRetentionDays"
      comment="Expire inactive snapshots this many days after their last save. Checked when history is accessed and periodically while Husk is open. Live terminal scrollback is unchanged.">
      <CfgEnum<number> value={prefs.terminalScrollbackRetentionDays}
        onChange={(terminalScrollbackRetentionDays) => setPrefs({ terminalScrollbackRetentionDays })}
        options={retentionOptions.map((value) => ({ value, label: `${value} day${value === 1 ? "" : "s"}` }))} />
    </CfgRow>
    <CfgRow name="savedTerminalHistory" searchId="deleteTerminalHistory"
      comment={confirmDelete ? "Delete all saved terminal history on this device? This cannot be undone. Live terminal output and shell history are not cleared." : "Delete the saved output archive without closing terminals or changing your shell's command history."}>
      {confirmDelete ? <>
        <CfgAct danger disabled={busy} onClick={() => void deleteHistory()}>{busy ? "deleting…" : "confirm delete history"}</CfgAct>{" "}
        <CfgAct disabled={busy} onClick={() => { setConfirmDelete(false); setError(""); }}>cancel</CfgAct>
      </> : <CfgAct danger onClick={() => { setConfirmDelete(true); setStatus(""); setError(""); }}>delete saved terminal history</CfgAct>}
    </CfgRow>
    {busy && <CfgComment><span role="status">Deleting saved terminal history…</span></CfgComment>}
    {status && <CfgComment><span role="status">{status}</span></CfgComment>}
    {error && <CfgComment><span role="alert">{error}</span></CfgComment>}
  </>;
}
