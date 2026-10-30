import { useId } from "react";
import type { AiWorkflowProposal } from "../ai/workflowProposals";
import { requestWorkflowStepsCapture } from "./captureRequest";
import "./aiWorkflowProposal.css";

/** A proposal is inert until the user opens the existing capture review.
 * Saving, choosing a terminal, and running remain separate actions. */
export function AiWorkflowProposalCard({ proposal, disabled = false }: {
  proposal: AiWorkflowProposal;
  disabled?: boolean;
}) {
  const titleId = useId();
  return <section className="ai-workflow-proposal" aria-labelledby={titleId}>
    <header className="ai-workflow-proposal-header">
      <div><span className="ai-workflow-proposal-eyebrow">Suggested workflow</span><h4 id={titleId}>{proposal.name}</h4></div>
      <span className="ai-workflow-proposal-count">{proposal.steps.length} step{proposal.steps.length === 1 ? "" : "s"}</span>
    </header>
    {proposal.description && <p className="ai-workflow-proposal-description">{proposal.description}</p>}
    <ol className="ai-workflow-proposal-steps" aria-label="Proposed command order" tabIndex={0}>
      {proposal.steps.map((step, index) => <li key={index}>
        <span className="ai-workflow-proposal-step-number" aria-hidden="true">{index + 1}</span>
        <div>{proposal.stepTitles?.[index] && <span className="ai-workflow-proposal-step-title">{proposal.stepTitles[index]}</span>}<pre><code>{step}</code></pre></div>
      </li>)}
    </ol>
    <p className="ai-workflow-proposal-shell" title="Steps run sequentially in one POSIX sh subprocess. Directory and environment changes stay inside that subprocess; your terminal's interactive aliases and functions are not inherited.">POSIX sh · stops on failure · no interactive aliases</p>
    <footer className="ai-workflow-proposal-footer">
      <span>Draft only · review before saving or running</span>
      <button type="button" className="ai-workflow-proposal-review" disabled={disabled}
        title="Choose a new workflow or append to an existing one; nothing runs"
        onClick={() => {
          if (disabled) return;
          requestWorkflowStepsCapture(proposal.steps, "ai-code", {
            name: proposal.name,
            ...(proposal.description === undefined ? {} : { description: proposal.description }),
            ...(proposal.stepTitles === undefined ? {} : { stepTitles: proposal.stepTitles }),
          });
        }}>Review workflow…</button>
    </footer>
  </section>;
}
