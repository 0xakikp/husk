import { useSyncExternalStore } from "react";

import type { WorkflowSuggestion } from "./suggestions";

export type WorkflowDraft = {
  name: string;
  description: string;
  steps: string[];
  stopOnError: boolean;
  source: "suggestion" | "timeline" | "recent";
  fingerprint?: string;
  occurrences?: number;
};

let draft: WorkflowDraft | null = null;
const subscribers = new Set<() => void>();

function emit() {
  for (const subscriber of subscribers) subscriber();
}

export function workflowDraftFromSuggestion(suggestion: WorkflowSuggestion): WorkflowDraft {
  const first = suggestion.steps[0]?.split(/\s+/).slice(0, 2).join(" ") || "routine";
  return {
    name: `${first} workflow`,
    description: `Created from a routine Husk noticed ${suggestion.occurrences} times in this workspace.`,
    steps: suggestion.steps,
    stopOnError: true,
    source: "suggestion",
    fingerprint: suggestion.fingerprint,
    occurrences: suggestion.occurrences,
  };
}

export function stageWorkflowDraft(next: WorkflowDraft): void {
  draft = next;
  emit();
  window.dispatchEvent(new CustomEvent("husk:open-workflow-draft"));
}

export function clearWorkflowDraft(): void {
  if (!draft) return;
  draft = null;
  emit();
}

export function getWorkflowDraft(): WorkflowDraft | null {
  return draft;
}

export function useWorkflowDraft(): WorkflowDraft | null {
  return useSyncExternalStore(
    (subscriber) => {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    getWorkflowDraft,
    () => null,
  );
}
