import { getPendingMcpActions, removePendingMcpAction, subscribePendingMcpActions, type PendingMcpAction } from "./pendingActions";
import { runPendingMcpAction } from "./pendingMcpExecution";
import { toast } from "../toast";
import { useSessionReviewQueue } from "./reviewQueue";
import { useReviewNavigation } from "./reviewNavigation";

function ActionCard({ action }: { action: PendingMcpAction }) {
  const status = action.status ?? "pending";
  const busy = status === "running";
  const approve = async () => {
    const result = await runPendingMcpAction(action.id);
    if (!result) return;
    if (result.state === "complete") {
      toast({ title: `${action.label} completed`, variant: "success", duration: 2400 });
    } else {
      toast({ title: `Review ${action.label} result`, message: result.summary, variant: "error", duration: 6000 });
    }
  };
  return (
    <div className="pe-card" tabIndex={-1} data-review-item={action.id} data-review-kind="integration" data-review-session={action.sessionId}>
      <div className="pe-card-head">
        <span className="pe-path" title={action.label}>{action.label}</span>
        <span className="pe-stat">{status === "settled" ? action.outcome?.state === "complete" ? "completed" : "inspect result" : busy ? "running" : "integration action"}</span>
        <span className="pe-spacer" />
        {status !== "settled" && <button type="button" className="pe-btn pe-btn-apply" onClick={() => void approve()} disabled={busy}>{busy ? "running…" : "approve & run"}</button>}
        <button type="button" className="pe-btn" onClick={() => removePendingMcpAction(action.id)} disabled={busy}>{status === "settled" ? "dismiss" : "discard"}</button>
      </div>
      <pre className="pe-diff">{JSON.stringify(action.request.input, null, 2)}</pre>
      {busy && <p className="pe-dock-note">Submitted. Closing this review does not cancel the integration operation.</p>}
      {action.outcome && <>
        <p className="pe-dock-note">{action.receiptSaved ? "Result added to the original chat." : "Result kept here; the original conversation is unavailable or could not be updated."} No automatic AI follow-up.</p>
        <pre className="pe-diff">{action.outcome.summary}{action.outcome.result ? `\n\n${action.outcome.result}` : ""}</pre>
        {action.outcome.state === "error" && <p className="pe-dock-note">Inspect the integration before requesting another attempt; an operation may have completed even if its result was not confirmed.</p>}
      </>}
    </div>
  );
}

/** Generic MCP contracts cannot safely reveal mutation intent. Show any
 * non-read-only call here before it reaches the remote service. */
export function PendingMcpActionsReview({ sessionId }: { sessionId?: string }) {
  return <SessionPendingMcpActionsReview key={sessionId ?? "all"} sessionId={sessionId} />;
}

function SessionPendingMcpActionsReview({ sessionId }: { sessionId?: string }) {
  const actions = useSessionReviewQueue(getPendingMcpActions, subscribePendingMcpActions, sessionId);
  const { reviewRef, expanded, setExpanded } = useReviewNavigation(sessionId, "integration", actions.map((action) => action.id));
  if (!actions.length) return null;
  const awaiting = actions.filter((action) => (action.status ?? "pending") === "pending").length;
  const running = actions.filter((action) => action.status === "running").length;
  const settled = actions.length - awaiting - running;
  const note = [awaiting ? `${awaiting} approval required` : "", running ? `${running} running` : "", settled ? `${settled} result${settled === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  const discardable = actions.some((action) => action.status !== "running");
  if (!expanded) {
    return <div ref={reviewRef} className="pe-dock"><span className="pe-dock-marker" aria-hidden="true">●</span><span>{actions.length} integration action{actions.length === 1 ? "" : "s"}</span><span className="pe-dock-note">{note}</span><span className="pe-spacer" /><button type="button" className="pe-btn pe-btn-apply" onClick={() => setExpanded(true)}>review</button><button type="button" className="pe-btn" disabled={!discardable} onClick={() => actions.forEach((action) => removePendingMcpAction(action.id))}>discard all</button></div>;
  }
  return <div ref={reviewRef} className="pe-wrap"><div className="pe-head"><span>{actions.length} integration action{actions.length === 1 ? "" : "s"} — {note}</span><span className="pe-spacer" /><button type="button" className="pe-btn" onClick={() => setExpanded(false)}>collapse</button><button type="button" className="pe-btn" disabled={!discardable} onClick={() => { actions.forEach((action) => removePendingMcpAction(action.id)); setExpanded(false); }}>discard all</button></div>{actions.map((action) => <ActionCard key={action.id} action={action} />)}</div>;
}
