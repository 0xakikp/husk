import { useSyncExternalStore } from "react";

import { scanForSecrets } from "../ai/contextItems";

export type SensitiveOutputRecord = {
  leafId: number;
  command: string;
  reasons: string[];
  at: number;
};

const records = new Map<number, SensitiveOutputRecord>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const listener of subscribers) listener();
}

/** This intentionally stores only the reasons — never the sensitive text. */
export function recordSensitiveOutput(
  leafId: number,
  fields: { command: string; output: string; at?: number },
): void {
  const reasons = scanForSecrets(fields.command, fields.output);
  if (reasons.length === 0) return;
  records.set(leafId, {
    leafId,
    command: fields.command,
    reasons,
    at: fields.at ?? Date.now(),
  });
  emit();
}

export function clearSensitiveOutput(leafId: number): void {
  if (records.delete(leafId)) emit();
}

export function getSensitiveOutput(leafId: number): SensitiveOutputRecord | null {
  return records.get(leafId) ?? null;
}

export function subscribeSensitiveOutput(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useSensitiveOutput(leafId: number | null): SensitiveOutputRecord | null {
  return useSyncExternalStore(
    subscribeSensitiveOutput,
    () => (leafId == null ? null : getSensitiveOutput(leafId)),
  );
}
