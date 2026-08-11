import { useSyncExternalStore } from "react";

export type GitAction =
  | "committed"
  | "merged"
  | "rebased"
  | "synced"
  | "pushed"
  | "switched branch"
  | "updated files";

export type GitActivityRecord = {
  leafId: number;
  command: string;
  cwd: string;
  action: GitAction;
  at: number;
};

const activities = new Map<number, GitActivityRecord>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const listener of subscribers) listener();
}

export function gitActionFor(command: string): GitAction | null {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!/(?:^|\s)git\s+/i.test(normalized)) return null;
  if (/\bgit\s+commit\b/i.test(normalized)) return "committed";
  if (/\bgit\s+merge\b/i.test(normalized)) return "merged";
  if (/\bgit\s+rebase\b/i.test(normalized)) return "rebased";
  if (/\bgit\s+(?:pull|fetch)\b/i.test(normalized)) return "synced";
  if (/\bgit\s+push\b/i.test(normalized)) return "pushed";
  if (/\bgit\s+(?:switch|checkout)\b/i.test(normalized)) return "switched branch";
  if (/\bgit\s+(?:add|restore|reset|rm|mv)\b/i.test(normalized)) return "updated files";
  return null;
}

export function recordGitActivity(
  leafId: number,
  fields: { command: string; cwd: string; exitCode: number | null; at?: number },
): void {
  const action = fields.exitCode === 0 ? gitActionFor(fields.command) : null;
  if (!action) return;
  activities.set(leafId, {
    leafId,
    command: fields.command,
    cwd: fields.cwd,
    action,
    at: fields.at ?? Date.now(),
  });
  emit();
}

export function clearGitActivity(leafId: number): void {
  if (activities.delete(leafId)) emit();
}

export function getGitActivity(leafId: number): GitActivityRecord | null {
  return activities.get(leafId) ?? null;
}

export function subscribeGitActivity(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useGitActivity(leafId: number | null): GitActivityRecord | null {
  return useSyncExternalStore(
    subscribeGitActivity,
    () => (leafId == null ? null : getGitActivity(leafId)),
  );
}
