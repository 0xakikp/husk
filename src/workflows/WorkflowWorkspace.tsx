import { useEffect, useRef, type ReactNode } from "react";
import { resumeWorkflowEditor, useWorkflowEditorSession } from "./editorSession";
import { CompactButton } from "../components/compact-form";
import "./workflowUi.css";

/** Draft navigation only. Editing occupies the existing rail, never a new column. */
export function WorkflowWorkspace({ children, editorVisible, onRevealEditor }: { children: ReactNode; editorVisible: boolean; onRevealEditor: () => void }) {
  const session = useWorkflowEditorSession();
  const revealRequest = session ? `${session.key}:${session.revealRevision}` : null;
  const handledReveal = useRef<string | null>(null);
  useEffect(() => {
    if (handledReveal.current === revealRequest) return;
    handledReveal.current = revealRequest;
    if (revealRequest && !session?.collapsed) onRevealEditor();
  }, [revealRequest, session?.collapsed, onRevealEditor]);
  return <div className="workflow-workspace">
    <div className="workflow-workspace-source">
      {session && (session.collapsed || !editorVisible) && <div className="workflow-draft-bar" aria-label="Unsaved workflow draft">
        <span className="workflow-draft-bar-label">Workflow draft</span>
        <span className="workflow-draft-bar-name" title={session.workflow.name || "Untitled"}>{session.workflow.name || "Untitled"}</span>
        <CompactButton compact variant="ghost" className="workflow-draft-resume" aria-label="Resume workflow draft" onClick={resumeWorkflowEditor} title="Resume the unsaved workflow draft">Resume</CompactButton>
      </div>}
      <div className="workflow-workspace-content">{children}</div>
    </div>
  </div>;
}
