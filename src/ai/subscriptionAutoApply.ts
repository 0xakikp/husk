import { useSyncExternalStore } from "react";
import { normalizeWorkspacePath } from "./workspaceScope";

/* Intentionally memory-only. Auto-apply is powerful enough that closing Husk,
 * switching folders, or starting a fresh process must require fresh consent. */
const enabledScopes = new Map<string, string>();
const subscribers = new Set<() => void>();

function emit(): void {
  subscribers.forEach((listener) => listener());
}

export function isSubscriptionAutoApplyEnabled(sessionId: string, workspaceRoot: string | null | undefined): boolean {
  const root = normalizeWorkspacePath(workspaceRoot);
  return Boolean(root && enabledScopes.get(sessionId) === root);
}

export function setSubscriptionAutoApply(
  sessionId: string,
  workspaceRoot: string | null | undefined,
  enabled: boolean,
): void {
  const root = normalizeWorkspacePath(workspaceRoot);
  if (enabled && root) enabledScopes.set(sessionId, root);
  else enabledScopes.delete(sessionId);
  emit();
}

export function clearSubscriptionAutoApply(sessionId: string): void {
  if (!enabledScopes.delete(sessionId)) return;
  emit();
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useSubscriptionAutoApply(sessionId: string, workspaceRoot: string | null | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isSubscriptionAutoApplyEnabled(sessionId, workspaceRoot),
  );
}
