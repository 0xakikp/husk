import { useSyncExternalStore } from "react";

/** A command has to run long enough before it earns persistent UI. */
export const MIN_TASK_VISIBLE_MS = 3_000;

export type TaskRecord = {
  leafId: number;
  command: string;
  cwd: string;
  startedAt: number;
  completedAt: number | null;
  exitCode: number | null;
};

const tasks = new Map<number, TaskRecord>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const listener of subscribers) listener();
}

/** Navigation and shell housekeeping should never look like background work. */
export function isTrackableTask(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) return false;
  return !/^(?:cd|ls|pwd|clear|history|which|echo|cat|head|tail|date|whoami)(?:\s|$)/i.test(normalized);
}

export function startTask(
  leafId: number,
  fields: { command: string; cwd: string; at?: number },
): void {
  if (!isTrackableTask(fields.command)) {
    clearTask(leafId);
    return;
  }
  tasks.set(leafId, {
    leafId,
    command: fields.command,
    cwd: fields.cwd,
    startedAt: fields.at ?? Date.now(),
    completedAt: null,
    exitCode: null,
  });
  emit();
}

/** Keep only successful long-task completions here. Failures have the stronger
 * Command Failure Assistant instead of competing for the same space. */
export function completeTask(
  leafId: number,
  fields: { command: string; cwd: string; exitCode: number | null; at?: number },
): void {
  const existing = tasks.get(leafId);
  const completedAt = fields.at ?? Date.now();
  const startedAt = existing?.startedAt ?? completedAt;
  const command = fields.command || existing?.command || "";

  if (
    fields.exitCode !== 0 ||
    !isTrackableTask(command) ||
    completedAt - startedAt < MIN_TASK_VISIBLE_MS
  ) {
    clearTask(leafId);
    return;
  }

  tasks.set(leafId, {
    leafId,
    command,
    cwd: fields.cwd || existing?.cwd || "",
    startedAt,
    completedAt,
    exitCode: fields.exitCode,
  });
  emit();
}

export function clearTask(leafId: number): void {
  if (tasks.delete(leafId)) emit();
}

export function getTask(leafId: number): TaskRecord | null {
  return tasks.get(leafId) ?? null;
}

export function subscribeTasks(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useTask(leafId: number | null): TaskRecord | null {
  return useSyncExternalStore(
    subscribeTasks,
    () => (leafId == null ? null : getTask(leafId)),
  );
}
