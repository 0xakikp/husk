import { useSyncExternalStore } from "react";

import { shq } from "../lib/shellQuote";
import { isProtectedTarget, isStatusToolMutation } from "./envSignals";
import { detectStatusToolSignals } from "./statusBarTools";

export type EnvironmentKind = "kubernetes" | "aws" | "terraform" | "docker";

export type EnvironmentTarget = {
  kind: EnvironmentKind;
  value: string;
  inspectCommand: string;
};

export type EnvironmentWarningRecord = {
  leafId: number;
  command: string;
  cwd: string;
  targets: EnvironmentTarget[];
  at: number;
};

const warnings = new Map<number, EnvironmentWarningRecord>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const listener of subscribers) listener();
}

function target(kind: EnvironmentKind, value: string): EnvironmentTarget {
  switch (kind) {
    case "kubernetes":
      return { kind, value, inspectCommand: `kubectl config get-contexts ${shq(value)}` };
    case "aws":
      return { kind, value, inspectCommand: `aws --profile ${shq(value)} configure list` };
    case "terraform":
      return { kind, value, inspectCommand: `TF_WORKSPACE=${shq(value)} terraform workspace show` };
    case "docker":
      return { kind, value, inspectCommand: `docker context inspect ${shq(value)}` };
  }
}

/**
 * The post-submission warning names only a target explicit in that command.
 * App-local defaults must not be attributed to a terminal or an SSH session.
 * Unknown targets still require approval in the AI command execution gate.
 */
export function protectedTargetsForCommand(command: string): EnvironmentTarget[] {
  const targets: EnvironmentTarget[] = [];
  for (const signal of detectStatusToolSignals(command)) {
    if (!signal.override || !isProtectedTarget(signal.override.value) || !isStatusToolMutation(signal)) continue;
    const value = signal.override.value;
    if (targets.some((item) => item.kind === signal.tool && item.value === value)) continue;
    targets.push(target(signal.tool, value));
  }
  return targets;
}

export function recordEnvironmentWarning(
  leafId: number,
  fields: { command: string; cwd: string; at?: number },
): void {
  const targets = protectedTargetsForCommand(fields.command);
  if (targets.length === 0) {
    clearEnvironmentWarning(leafId);
    return;
  }
  warnings.set(leafId, {
    leafId,
    command: fields.command,
    cwd: fields.cwd,
    targets,
    at: fields.at ?? Date.now(),
  });
  emit();
}

export function clearEnvironmentWarning(leafId: number): void {
  if (warnings.delete(leafId)) emit();
}

export function getEnvironmentWarning(leafId: number): EnvironmentWarningRecord | null {
  return warnings.get(leafId) ?? null;
}

export function subscribeEnvironmentWarnings(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useEnvironmentWarning(leafId: number | null): EnvironmentWarningRecord | null {
  return useSyncExternalStore(
    subscribeEnvironmentWarnings,
    () => (leafId == null ? null : getEnvironmentWarning(leafId)),
  );
}
