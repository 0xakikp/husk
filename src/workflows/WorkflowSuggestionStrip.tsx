import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, SparklesIcon, WorkflowCircle01Icon } from "@hugeicons/core-free-icons";

import { stageWorkflowDraft, workflowDraftFromSuggestion } from "./draftStore";
import {
  dismissWorkflowSuggestion,
  useWorkflowSuggestion,
} from "./suggestions";
import { useWorkspaceRoot } from "../workspace/store";

function routineLabel(steps: string[]): string {
  const names = steps.map((step) => step.trim().split(/\s+/).slice(0, 2).join(" "));
  const label = names.join(" → ");
  return label.length > 62 ? `${label.slice(0, 61)}…` : label;
}

export function WorkflowSuggestionStrip({ leafId }: { leafId: number | null }) {
  const suggestion = useWorkflowSuggestion(leafId);
  const workspaceRoot = useWorkspaceRoot();
  if (!suggestion || leafId == null || suggestion.workspaceRoot !== workspaceRoot) return null;
  const evolving = suggestion.kind === "evolution";
  const addedCount = evolving ? suggestion.steps.length - suggestion.originalSteps.length : 0;

  return (
    <div className="flex min-h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-primary/25 bg-background/55 px-2.5 font-mono text-[10.5px]">
      <HugeiconsIcon icon={SparklesIcon} size={11} strokeWidth={1.75} className="shrink-0 text-primary" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-primary/90">
        {evolving ? "workflow update" : "routine"}
      </span>
      <span className="min-w-0 truncate text-muted-foreground" title={suggestion.steps.join("\n")}>
        {evolving
          ? `${suggestion.targetWorkflowName} · +${addedCount} step${addedCount === 1 ? "" : "s"} · seen ${suggestion.occurrences}×`
          : `seen ${suggestion.occurrences}× · ${routineLabel(suggestion.steps)}`}
      </span>
      <div className="min-w-2 flex-1" />
      <button
        type="button"
        onClick={() => stageWorkflowDraft(workflowDraftFromSuggestion(suggestion))}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/10"
        title={evolving ? "Compare the saved workflow with the proposed update" : "Review every step before saving this workflow"}
      >
        <HugeiconsIcon icon={WorkflowCircle01Icon} size={10} strokeWidth={1.75} />
        {evolving ? "Review update" : "Review workflow"}
      </button>
      <button
        type="button"
        onClick={() => dismissWorkflowSuggestion(leafId)}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Hide this suggestion for now"
      >
        not now
      </button>
      <button
        type="button"
        onClick={() => dismissWorkflowSuggestion(leafId, true)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Never suggest this exact routine again"
        aria-label="Ignore this routine"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
