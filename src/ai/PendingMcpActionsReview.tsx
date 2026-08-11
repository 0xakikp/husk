import { useEffect, useState } from "react";
import { executeHuskAction } from "./actionBroker";
import { getPendingMcpActions, removePendingMcpAction, subscribePendingMcpActions, type PendingMcpAction } from "./pendingActions";
import { getPrefs } from "../settings/preferences";
import { toast } from "../toast";

function ActionCard({ action }: { action: PendingMcpAction }) {
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true);
    const prefs = getPrefs();
    const result = await executeHuskAction(action.request, {
      sessionId: action.sessionId,
      fileToolsEnabled: prefs.aiFileToolsEnabled,
      mcpToolsEnabled: prefs.aiMcpToolsEnabled,
      confirmMcpCall: true,
    });
    setBusy(false);
    if (result.state === "complete") {
      removePendingMcpAction(action.id);
      toast({ title: `${action.label} completed`, variant: "success", duration: 2400 });
    } else {
      toast({ title: `Could not run ${action.label}`, message: result.summary, variant: "error", duration: 6000 });
    }
  };
  return (
    <div className="pe-card">
      <div className="pe-card-head">
        <span className="pe-path" title={action.label}>{action.label}</span>
        <span className="pe-stat">integration action</span>
        <span className="pe-spacer" />
        <button type="button" className="pe-btn pe-btn-apply" onClick={() => void approve()} disabled={busy}>{busy ? "running…" : "approve & run"}</button>
        <button type="button" className="pe-btn" onClick={() => removePendingMcpAction(action.id)} disabled={busy}>discard</button>
      </div>
      <pre className="pe-diff">{JSON.stringify(action.request.input, null, 2)}</pre>
    </div>
  );
}

/** Generic MCP contracts cannot safely reveal mutation intent. Show any
 * non-read-only call here before it reaches the remote service. */
export function PendingMcpActionsReview({ sessionId }: { sessionId?: string }) {
  const visible = () => getPendingMcpActions().filter((action) => !sessionId || action.sessionId === sessionId || action.sessionId === undefined);
  const [actions, setActions] = useState<PendingMcpAction[]>(visible);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => subscribePendingMcpActions(() => setActions(visible())), [sessionId]);
  if (!actions.length) return null;
  if (!expanded) {
    return <div className="pe-dock"><span className="pe-dock-marker" aria-hidden="true">●</span><span>{actions.length} integration action{actions.length === 1 ? "" : "s"}</span><span className="pe-dock-note">approval required</span><span className="pe-spacer" /><button type="button" className="pe-btn pe-btn-apply" onClick={() => setExpanded(true)}>review</button><button type="button" className="pe-btn" onClick={() => actions.forEach((action) => removePendingMcpAction(action.id))}>discard all</button></div>;
  }
  return <div className="pe-wrap"><div className="pe-head"><span>{actions.length} integration action{actions.length === 1 ? "" : "s"} — approval required</span><span className="pe-spacer" /><button type="button" className="pe-btn" onClick={() => setExpanded(false)}>collapse</button><button type="button" className="pe-btn" onClick={() => { actions.forEach((action) => removePendingMcpAction(action.id)); setExpanded(false); }}>discard all</button></div>{actions.map((action) => <ActionCard key={action.id} action={action} />)}</div>;
}
