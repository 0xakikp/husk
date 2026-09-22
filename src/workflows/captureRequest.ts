import { useSyncExternalStore } from "react";
import { bytes } from "./schema";

export type WorkflowCaptureSource = "terminal-selection" | "ai-code";
export type WorkflowCaptureRequest = { id: number; text: string; source: WorkflowCaptureSource };
let sequence = 0;
let requested: WorkflowCaptureRequest | null = null;
const subscribers = new Set<() => void>();
const subscribe = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };

/** Capture is local and inert. Preserve the source exactly for an explicit review. */
export function requestWorkflowCapture(text: string, source: WorkflowCaptureSource) {
  requested = { id: ++sequence, text, source };
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
