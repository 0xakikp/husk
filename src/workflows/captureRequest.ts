import { useSyncExternalStore } from "react";
import { bytes } from "./schema";

export type WorkflowCaptureSource = "terminal-selection" | "ai-code";
export type WorkflowCaptureDetails = {
  name?: string;
  description?: string;
  stepTitles?: readonly string[];
  selectedIndices?: readonly number[];
};
export type WorkflowCaptureRequest = {
  id: number;
  text: string;
  source: WorkflowCaptureSource;
  steps?: string[];
  name?: string;
  description?: string;
  stepTitles?: string[];
  selectedIndices?: number[];
};
let sequence = 0;
let requested: WorkflowCaptureRequest | null = null;
const subscribers = new Set<() => void>();
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };

/** Capture is local and inert. Preserve the source exactly for an explicit review. */
export function requestWorkflowCapture(text: string, source: WorkflowCaptureSource) {
  requested = { id: ++sequence, text, source };
  subscribers.forEach((fn) => fn());
}
/** Boundaries are authored explicitly, never inferred by splitting shell text. */
export function requestWorkflowStepsCapture(steps: readonly string[], source: WorkflowCaptureSource, details: WorkflowCaptureDetails = {}) {
  requested = {
    id: ++sequence, text: steps.join("\n\n"), source, steps: [...steps],
    ...(details.name !== undefined ? { name: details.name } : {}),
    ...(details.description !== undefined ? { description: details.description } : {}),
    ...(details.stepTitles !== undefined ? { stepTitles: [...details.stepTitles] } : {}),
    ...(details.selectedIndices !== undefined ? { selectedIndices: [...details.selectedIndices] } : {}),
  };
  subscribers.forEach((fn) => fn());
}
export function getWorkflowCaptureRequest() { return requested; }
export function clearWorkflowCaptureRequest(expectedId?: number) {
  if (expectedId !== undefined && requested?.id !== expectedId) return;
  requested = null;
  subscribers.forEach((fn) => fn());
}
export function useWorkflowCaptureRequest() { return useSyncExternalStore(subscribe, getWorkflowCaptureRequest, () => null); }
export function isWorkflowShellLanguage(language: string) { return /^(sh|bash|zsh|shell)$/i.test(language.trim()); }
export function workflowCaptureError(text: string): string | null {
  if (!text.trim()) return "Select a command to add to a workflow.";
  if (bytes(text) > 8000) return "A workflow step supports at most 8,000 UTF-8 bytes. Select a smaller command; no text has been truncated.";
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)) return "This selection contains control characters. Select plain command text; no characters have been removed.";
  return null;
}
export function workflowCaptureStepsError(steps: readonly string[], stepTitles?: readonly string[]): string | null {
  if (!Array.isArray(steps) || !steps.length) return "Select at least one command to add to a workflow.";
  if (steps.length > 100) return "A workflow can contain at most 100 steps. Select fewer commands; nothing has been truncated.";
  for (let index = 0; index < steps.length; index++) {
    if (typeof steps[index] !== "string") return `Step ${index + 1} must be command text.`;
    const error = workflowCaptureError(steps[index]);
    if (error) return `Step ${index + 1}: ${error}`;
  }
  if (stepTitles !== undefined) {
    if (!Array.isArray(stepTitles) || stepTitles.length !== steps.length) return "Step titles must match the number of commands.";
    if (stepTitles.some((title) => typeof title !== "string" || bytes(title) > 160 || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(title))) return "Step titles must be single-line text of at most 160 UTF-8 bytes, without control characters.";
  }
  return null;
}
