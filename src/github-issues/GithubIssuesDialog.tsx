import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";

const ACTIONS = [
  { id: "issues", label: "List issues", cmd: "gh issue list" },
  { id: "issue-create", label: "Create issue", cmd: "gh issue create" },
  { id: "prs", label: "List pull requests", cmd: "gh pr list" },
  { id: "pr-status", label: "PR status", cmd: "gh pr status" },
];

export function GithubIssuesDialog({ onClose }: { onClose: () => void }) {
  const run = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Running: ${cmd}`, variant: "info" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="GitHub" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>GitHub</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="rb-empty" style={{ margin: 0 }}>
            Runs the GitHub CLI (<code>gh</code>) in the active terminal's repository.
          </p>
          <div className="rb-list">
            {ACTIONS.map((a) => (
              <div key={a.id} className="rb-item">
                <div className="rb-meta">
                  <span className="rb-name">{a.label}</span>
                  <span className="rb-steps">{a.cmd}</span>
                </div>
                <button type="button" className="rb-run" title="Run" onClick={() => run(a.cmd)}>
                  ▶
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
