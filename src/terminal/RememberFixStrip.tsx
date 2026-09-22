import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "../toast";
import { fixMemoryStore, MAX_FIX_MEMORY_BYTES, MAX_REMEMBERED_FIXES, type FixCandidate, type FixMemoryStore, type RememberedFix } from "./fixMemory";
import { closeSavedFixes, useSavedFixesView } from "./savedFixesView";
import "./RememberFixStrip.css";

type LibraryRequest = { leafId: number; id: number };

export function RememberFixStrip({ leafId, store = fixMemoryStore, onClose }: { leafId: number; store?: FixMemoryStore; onClose?: () => void }) {
  const snapshot = useSyncExternalStore(store.subscribe, () => store.getSnapshot(leafId));
  const saved = useSyncExternalStore(store.subscribe, store.getSaved);
  const libraryRequest = useSavedFixesView(leafId);
  const activeRequestEffect = useRef<LibraryRequest | null>(null);
  useEffect(() => {
    if (!libraryRequest) return;
    const ticket = { leafId, id: libraryRequest.id };
    activeRequestEffect.current = ticket;
    return () => {
      // A StrictMode effect replay must not close the library it just opened.
      // On actual unmount/leaf change close only the request we owned, never a
      // newer right-click request created during the same render cycle.
      queueMicrotask(() => {
        const active = activeRequestEffect.current;
        if (active !== ticket && active?.leafId === ticket.leafId && active.id === ticket.id) return;
        closeSavedFixes(ticket.leafId, ticket.id);
      });
    };
  }, [leafId, libraryRequest?.id]);
  const candidate = snapshot?.candidate ?? null;
  const matches = snapshot?.matches ?? [];
  if (!candidate && !matches.length && !libraryRequest) return null;
  // A newly captured failure must not remount an explicitly opened library
  // and steal focus from a user who has returned to typing in the terminal.
  return <FixMemoryContent key={libraryRequest ? `${leafId}:library` : `${leafId}:${snapshot?.failure?.at ?? "suggestion"}`} leafId={leafId} store={store} candidate={candidate} matches={matches} saved={saved} libraryRequest={libraryRequest} onClose={onClose} />;
}

function FixMemoryContent({ leafId, store, candidate, matches, saved, libraryRequest, onClose }: {
  leafId: number; store: FixMemoryStore; candidate: FixCandidate | null; matches: RememberedFix[]; saved: RememberedFix[];
  libraryRequest: LibraryRequest | null; onClose?: () => void;
}) {
  const [currentExpanded, setCurrentExpanded] = useState(false);
  const view = libraryRequest ? "library" : currentExpanded ? "current" : null;
  const bodyId = useId();
  const currentTrigger = useRef<HTMLButtonElement>(null);
  const closeTrigger = useRef<HTMLButtonElement>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [title, setTitle] = useState(candidate ? `Fix: ${candidate.failure.command.slice(0, 40)}` : "");
  const [summary, setSummary] = useState("");
  const [steps, setSteps] = useState(candidate?.steps.map((step) => step.id) ?? []);
  const [includeError, setIncludeError] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useLayoutEffect(() => {
    if (!libraryRequest) return;
    // The terminal menu has gone away. Focus a harmless close control, never
    // a saved command's Copy/Delete action, so Escape and Tab work immediately.
    setCurrentExpanded(false); setError(""); setNotice(""); setDeleteId(null);
    closeTrigger.current?.focus();
  }, [libraryRequest?.id]);
  useEffect(() => {
    if (!candidate) return;
    setTitle(`Fix: ${candidate.failure.command.slice(0, 40)}`); setSummary("");
    setSteps(candidate.steps.map((step) => step.id)); setIncludeError(false); setConfirmed(false);
    setError(""); setNotice(""); setDeleteId(null); setCurrentExpanded(false);
  }, [candidate]);
  const close = () => {
    setCurrentExpanded(false); setError(""); setNotice(""); setDeleteId(null);
    if (libraryRequest) {
      closeSavedFixes(leafId, libraryRequest.id);
      onClose?.();
    } else {
      // Closing a candidate review is different from dismissing its suggestion.
      currentTrigger.current?.focus();
    }
  };
  const toggleCurrent = () => {
    if (view === "current") { close(); return; }
    setCurrentExpanded(true); setError(""); setNotice(""); setDeleteId(null);
  };
  const save = () => {
    if (!candidate) return;
    setError("");
    try {
      store.save(leafId, candidate.id, { title, summary, stepIds: steps, includeError, confirmed });
      setCurrentExpanded(false);
      toast({ title: "Fix saved locally", message: "Right-click the terminal and choose Saved fixes… to view or delete it.", variant: "success" });
      onClose?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save this fix."); }
  };
  const remove = (id: string) => {
    setError("");
    try { store.delete(id); setDeleteId(null); setNotice("Fix deleted from local memory. Terminal files and commands were not changed."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete this fix."); }
  };
  const copy = (command: string) => {
    setError("");
    void writeText(command).then(() => setNotice("Command copied without a newline. Review the target before pasting."))
      .catch(() => setError("Could not copy the command."));
  };
  const entries = view === "library" ? saved : matches;
  return <section className={`remember-fix${view ? "" : " remember-fix--collapsed"}`} aria-label="Remembered terminal fixes" onKeyDown={(event) => {
    event.stopPropagation();
    if (event.key === "Escape" && view) { event.preventDefault(); close(); }
  }}>
    <div className="remember-fix__strip">
      {view === "library" ? <span className="remember-fix__library-title">Saved fixes · {saved.length}</span> : (candidate || matches.length > 0) && <button ref={currentTrigger} type="button" aria-expanded={view === "current"} aria-controls={view === "current" ? bodyId : undefined} onClick={toggleCurrent}>
        <span aria-hidden="true">{matches.length ? "↶" : "⌑"}</span> {candidate ? "Remember this fix" : "Previous fix found"}
      </button>}
      {candidate && view !== "library" && <span className="remember-fix__hint" title={candidate.failure.command}>Verification succeeded</span>}
      {view ? <button ref={closeTrigger} type="button" className="remember-fix__dismiss" aria-label="Close saved fixes panel" title="Close panel (Escape) · keeps saved fixes" onClick={close}>×</button>
        : (candidate || matches.length > 0) && <button type="button" className="remember-fix__dismiss" aria-label="Dismiss fix suggestion" title="Dismiss this suggestion" onClick={() => { store.dismiss(leafId); onClose?.(); }}>×</button>}
    </div>
    {view && <div id={bodyId} className="remember-fix__body" role="region" aria-label="Saved fixes panel">
      <p className="remember-fix__notice">Local memory only. Nothing is sent to AI, staged, or executed.</p>
      <details className="remember-fix__storage">
        <summary>Storage &amp; retention</summary>
        <p>Saved in Husk’s local app storage on this device, not in Vault, your project folder or the remote host. Fixes are not synced between devices or sent to AI.</p>
        <p>No automatic expiry. Saved fixes survive app restarts until you delete them or clear Husk’s app data. Closing this panel does not delete anything.</p>
        <p>{saved.length} of {MAX_REMEMBERED_FIXES} fixes saved · {MAX_FIX_MEMORY_BYTES / 1024} KB total limit. When full, new saves are blocked; older fixes are not automatically removed.</p>
        <p>Stored: title, notes, selected commands, directory/host, timestamps and an error fingerprint. The error excerpt is optional. Successful command output is never saved.</p>
      </details>
      {view === "current" && candidate ? <>
        <p className="remember-fix__meta">{candidate.remoteHost ? `SSH ${candidate.remoteHost}` : "Local shell"} · {candidate.cwd}</p>
        <p className="remember-fix__notice">The failed command later exited 0. Confirm the issue was actually fixed; success alone does not prove why.</p>
        <label className="remember-fix__field">Title<input aria-label="Fix title" value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="remember-fix__field">What resolved it? <span>(optional)</span><textarea aria-label="Fix notes" value={summary} maxLength={2048} rows={2} placeholder="What changed, and anything to check before reusing this fix" onChange={(event) => setSummary(event.target.value)} /></label>
        <details className="remember-fix__error-source"><summary>Original error · captured excerpt, up to 8 lines / 2 KB</summary><pre>{candidate.failure.excerpt}</pre></details>
        <label className="remember-fix__check"><input type="checkbox" checked={includeError} onChange={(event) => setIncludeError(event.target.checked)} />Save this error excerpt too (off by default)</label>
        <p className="remember-fix__notice">Choose the exact commands to remember. No successful command output is saved.</p>
        {candidate.omitted > 0 && <p className="remember-fix__warning">{candidate.omitted} earlier successful step(s) are outside the six-command capture limit. This is not a complete replay.</p>}
        <ol className="remember-fix__steps">{candidate.steps.map((step) => <li key={step.id}>
          <label><input type="checkbox" aria-label={`Remember command: ${step.command}`} checked={steps.includes(step.id)} disabled={step.verification} onChange={(event) => setSteps((current) => event.target.checked ? [...current, step.id] : current.filter((id) => id !== step.id))} /><code>{step.command}</code></label>
          {step.verification && <span className="remember-fix__meta">successful verification · kept</span>}
        </li>)}</ol>
        <label className="remember-fix__check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />These selected steps resolved the issue.</label>
        <div className="remember-fix__actions"><button type="button" disabled={!confirmed || !title.trim()} onClick={save}>Save fix locally</button><button type="button" onClick={close}>Cancel</button></div>
      </> : <>
        <p className="remember-fix__notice">{view === "current" ? "A past fix matched this command, error, directory and host. It may not apply now—review the commands and environment before reuse." : "Your explicitly saved fixes, newest first. Deleting a fix only removes its local record."}</p>
        {entries.map((fix) => <article className="remember-fix__entry" key={fix.id}>
          <strong>{fix.title}</strong>
          <p className="remember-fix__meta">{fix.remoteHost ? `SSH ${fix.remoteHost}` : "Local shell"} · {fix.cwd}</p>
          <p className="remember-fix__meta">Resolved {new Date(fix.resolvedAt).toLocaleString()} · Saved {new Date(fix.savedAt).toLocaleString()}</p>
          {fix.summary && <p className="remember-fix__summary">{fix.summary}</p>}
          <ol className="remember-fix__saved-commands">{fix.commands.map((command, index) => <li key={`${index}:${command}`}><code>{command}</code><button type="button" aria-label={`Copy command ${index + 1}`} onClick={() => copy(command)}>Copy</button></li>)}</ol>
          {fix.errorExcerpt && <details className="remember-fix__error-source"><summary>Saved error excerpt</summary><pre>{fix.errorExcerpt}</pre></details>}
          {deleteId === fix.id ? <div className="remember-fix__actions"><span>Delete this saved fix?</span><button type="button" onClick={() => remove(fix.id)}>Delete fix</button><button type="button" onClick={() => setDeleteId(null)}>Cancel deletion</button></div> : <button type="button" onClick={() => setDeleteId(fix.id)}>Delete</button>}
        </article>)}
        {!entries.length && <p className="remember-fix__notice">No saved fixes.</p>}
      </>}
      {error && <p role="alert" className="remember-fix__warning">{error}</p>}
      {notice && <p role="status" className="remember-fix__notice">{notice}</p>}
    </div>}
  </section>;
}
