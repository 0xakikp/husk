import { useState } from "react";
import {
  getPendingEdits,
  removePendingEdit,
  applyPendingEdit,
  getAppliedEdits,
  subscribePendingEdits,
  undoAppliedEdit,
  type AppliedEdit,
  type PendingEdit,
} from "./pendingEdits";
import { toast } from "../toast";
import { useReviewCancellation, useSessionReviewQueue } from "./reviewQueue";

/** Lines of an edit shown before collapsing. A full-file overwrite arrives as one
 *  edit whose `search` is the entire previous file, so this must be bounded. */
const MAX_LINES = 6;

function splitCapped(text: string, expanded: boolean): { lines: string[]; hidden: number } {
  const all = text.length === 0 ? [] : text.split("\n");
  if (expanded || all.length <= MAX_LINES) return { lines: all, hidden: 0 };
  return { lines: all.slice(0, MAX_LINES), hidden: all.length - MAX_LINES };
}

function EditCard({ edit }: { edit: PendingEdit }) {
  const [busy, setBusy] = useState(false);
  const [fullDiff, setFullDiff] = useState(false);
  const cancellation = useReviewCancellation();
  const isCreate = edit.operation === "create";
  const before = splitCapped(isCreate ? "" : edit.search, fullDiff);
  const after = splitCapped(edit.replace, fullDiff);
  const name = edit.path.split("/").pop() || edit.path;
  const removed = isCreate ? 0 : edit.search ? edit.search.split("\n").length : 0;
  const added = edit.replace ? edit.replace.split("\n").length : 0;

  const apply = async () => {
    setBusy(true);
    const res = await applyPendingEdit(edit, { signal: cancellation.current.signal });
    setBusy(false);
    if (res.ok) {
      removePendingEdit(edit.id);
      toast({ title: `Applied to ${name}`, variant: "success", duration: 2000 });
    } else {
      // Kept in the queue so it can be inspected or retried.
      toast({ title: `Could not apply to ${name}`, message: res.reason, variant: "error", duration: 6000 });
    }
  };

  return (
    <div className="pe-card">
      <div className="pe-card-head">
        <span className="pe-path" title={edit.path}>
          {name}
        </span>
        {edit.remoteHost && <span className="pe-stat">SSH · {edit.remoteHost}</span>}
        {isCreate && <span className="pe-stat">new file</span>}
        {!isCreate && <span className="pe-stat pe-del">−{removed}</span>}
        <span className="pe-stat pe-add">+{added}</span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn pe-btn-apply" onClick={apply} disabled={busy}>
          {busy ? "applying…" : "apply"}
        </button>
        <button
          type="button"
          className="pe-btn"
          onClick={() => removePendingEdit(edit.id)}
          disabled={busy}
        >
          discard
        </button>
      </div>
      <pre className="pe-diff">
        {before.lines.map((l, i) => (
          <div key={`d${i}`} className="pe-line pe-del">
            <span className="pe-sign">-</span>
            {l}
          </div>
        ))}
        {before.hidden > 0 && <div className="pe-more">… {before.hidden} more removed</div>}
        {after.lines.map((l, i) => (
          <div key={`a${i}`} className="pe-line pe-add">
            <span className="pe-sign">+</span>
            {l}
          </div>
        ))}
        {after.hidden > 0 && <div className="pe-more">… {after.hidden} more added</div>}
      </pre>
      {(fullDiff || before.hidden > 0 || after.hidden > 0) && (
        <button type="button" className="pe-btn" onClick={() => setFullDiff((value) => !value)} aria-expanded={fullDiff}>
          {fullDiff ? "show fewer lines" : "show complete diff"}
        </button>
      )}
    </div>
  );
}

function AppliedEditCard({ edit }: { edit: AppliedEdit }) {
  const [busy, setBusy] = useState(false);
  const [fullDiff, setFullDiff] = useState(false);
  const isCreate = edit.operation === "create";
  const before = splitCapped(edit.before ?? "", fullDiff);
  const after = splitCapped(edit.after, fullDiff);
  const name = edit.path.split("/").pop() || edit.path;

  const undo = async () => {
    setBusy(true);
    const result = await undoAppliedEdit(edit);
    setBusy(false);
    if (result.ok) {
      toast({ title: `Undid ${name}`, variant: "success", duration: 2200 });
    } else {
      toast({ title: `Could not undo ${name}`, message: result.reason, variant: "error", duration: 6000 });
    }
  };

  return (
    <div className="pe-card pe-applied-card">
      <div className="pe-card-head">
        <span className="pe-path" title={edit.path}>{name}</span>
        {edit.remoteHost && <span className="pe-stat">SSH · {edit.remoteHost}</span>}
        <span className="pe-stat pe-applied-label">{isCreate ? "created" : "updated"}</span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn" onClick={undo} disabled={busy}>
          {busy ? "undoing…" : "undo"}
        </button>
      </div>
      <pre className="pe-diff">
        {!isCreate && before.lines.map((line, index) => (
          <div key={`d${index}`} className="pe-line pe-del"><span className="pe-sign">-</span>{line}</div>
        ))}
        {!isCreate && before.hidden > 0 && <div className="pe-more">… {before.hidden} more removed</div>}
        {after.lines.map((line, index) => (
          <div key={`a${index}`} className="pe-line pe-add"><span className="pe-sign">+</span>{line}</div>
        ))}
        {after.hidden > 0 && <div className="pe-more">… {after.hidden} more added</div>}
      </pre>
      {(fullDiff || before.hidden > 0 || after.hidden > 0) && (
        <button type="button" className="pe-btn" onClick={() => setFullDiff((value) => !value)} aria-expanded={fullDiff}>
          {fullDiff ? "show fewer lines" : "show complete diff"}
        </button>
      )}
    </div>
  );
}

/** In-memory activity for any approved workspace change. It is intentionally
 * close to the composer, where the user can inspect and safely undo it. */
export function AppliedEditsActivity({ sessionId }: { sessionId?: string }) {
  return <SessionAppliedEditsActivity key={sessionId ?? "all"} sessionId={sessionId} />;
}

function SessionAppliedEditsActivity({ sessionId }: { sessionId?: string }) {
  const edits = useSessionReviewQueue(getAppliedEdits, subscribePendingEdits, sessionId);
  const [expanded, setExpanded] = useState(false);
  const [undoingLatest, setUndoingLatest] = useState(false);

  if (edits.length === 0) return null;
  const newest = edits[edits.length - 1];

  const undoLatest = async () => {
    setUndoingLatest(true);
    const result = await undoAppliedEdit(newest);
    setUndoingLatest(false);
    const name = newest.path.split("/").pop() || newest.path;
    if (result.ok) toast({ title: `Undid ${name}`, variant: "success", duration: 2200 });
    else toast({ title: `Could not undo ${name}`, message: result.reason, variant: "error", duration: 6000 });
  };

  return (
    <div className="pe-applied-wrap">
      <div className="pe-applied-dock">
        <span className="pe-dock-marker" aria-hidden="true">●</span>
        <span>{edits.length} applied workspace change{edits.length === 1 ? "" : "s"}</span>
        <span className="pe-dock-note">undo is available while unchanged</span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn" onClick={() => setExpanded((value) => !value)}>
          {expanded ? "hide diff" : "show diff"}
        </button>
        <button type="button" className="pe-btn" onClick={() => void undoLatest()} disabled={undoingLatest}>
          {undoingLatest ? "undoing…" : "undo latest"}
        </button>
      </div>
      {expanded && edits.slice().reverse().map((edit) => <AppliedEditCard key={edit.id} edit={edit} />)}
    </div>
  );
}

/**
 * Review pane for edits the AI has proposed.
 *
 * Until this existed, accept/reject lived only in the command palette and neither
 * showed what was about to change — so edits were approved blind. That mattered
 * more once accepting actually started writing to disk.
 */
export function PendingEditsReview({ sessionId }: { sessionId?: string }) {
  return <SessionPendingEditsReview key={sessionId ?? "all"} sessionId={sessionId} />;
}

function SessionPendingEditsReview({ sessionId }: { sessionId?: string }) {
  const edits = useSessionReviewQueue(getPendingEdits, subscribePendingEdits, sessionId);
  const [expanded, setExpanded] = useState(false);
  const [busyAll, setBusyAll] = useState(false);
  const cancellation = useReviewCancellation();

  if (edits.length === 0) return null;

  const applyAll = async () => {
    setBusyAll(true);
    let applied = 0;
    const failures: string[] = [];
    for (const e of edits) {
      if (cancellation.current.signal.aborted) break;
      const res = await applyPendingEdit(e, { signal: cancellation.current.signal });
      if (res.ok) {
        applied += 1;
        removePendingEdit(e.id);
      } else {
        failures.push(`${res.path.split("/").pop()}: ${res.reason}`);
      }
    }
    setBusyAll(false);
    if (applied > 0) toast({ title: `Applied ${applied} edit${applied > 1 ? "s" : ""}`, variant: "success", duration: 2500 });
    if (failures.length > 0) {
      toast({ title: `${failures.length} could not be applied`, message: failures.join("\n"), variant: "error", duration: 6000 });
    }
  };

  const discardAll = () => {
    edits.forEach((edit) => removePendingEdit(edit.id));
    setExpanded(false);
  };

  if (!expanded) {
    return (
      <div className="pe-dock">
        <span className="pe-dock-marker" aria-hidden="true">●</span>
        <span>
          {edits.length} proposed edit{edits.length > 1 ? "s" : ""}
        </span>
        <span className="pe-dock-note">review before applying</span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn pe-btn-apply" onClick={() => setExpanded(true)}>
          review
        </button>
        <button type="button" className="pe-btn" onClick={discardAll}>
          discard all
        </button>
      </div>
    );
  }

  return (
    <div className="pe-wrap">
      <div className="pe-head">
        <span>
          {edits.length} proposed edit{edits.length > 1 ? "s" : ""} — review before applying
        </span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn" onClick={() => setExpanded(false)} disabled={busyAll}>
          collapse
        </button>
        <button type="button" className="pe-btn pe-btn-apply" onClick={applyAll} disabled={busyAll}>
          {busyAll ? "applying…" : "apply all"}
        </button>
        <button
          type="button"
          className="pe-btn"
          onClick={discardAll}
          disabled={busyAll}
        >
          discard all
        </button>
      </div>
      {edits.map((e) => (
        <EditCard key={e.id} edit={e} />
      ))}
    </div>
  );
}
