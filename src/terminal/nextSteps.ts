import { useSyncExternalStore } from "react";

import { scanForSecrets } from "../ai/contextItems";

/** A local, reviewable command that follows a completed workflow. */
export type LocalNextStep = {
  id: string;
  label: string;
  command: string;
};

export type NextStepRecord = {
  leafId: number;
  command: string;
  output: string;
  exitCode: number;
  cwd: string;
  at: number;
  local: LocalNextStep[];
  sensitive: boolean;
};

type NextStepEntry = { record: NextStepRecord; collapsed: boolean };

const entries = new Map<number, NextStepEntry>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const subscriber of subscribers) subscriber();
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\\"'\\\"'")}'`;
}

function namespaceFlag(command: string): string {
  const match = command.match(/(?:^|\s)(?:-n|--namespace)(?:\s+|=)([^\s]+)/);
  return match?.[1] ? ` -n ${shellQuote(match[1])}` : "";
}

function kubernetesWorkload(output: string): { kind: string; name: string } | null {
  const match = output.match(/\b(deployment|statefulset|daemonset)(?:\.apps)?\/([^\s]+)/i);
  return match ? { kind: match[1].toLowerCase(), name: match[2] } : null;
}

function packageManager(command: string): "pnpm" | "npm" | "yarn" | "bun" | null {
  const first = command.trim().split(/\s+/)[0];
  return first === "pnpm" || first === "npm" || first === "yarn" || first === "bun" ? first : null;
}

/**
 * Deterministic suggestions for common workflows. These are intentionally
 * conservative: they stage a verification/inspection command, never a deploy,
 * rollback, delete, or other side effect.
 */
export function localNextSteps(command: string, output: string): LocalNextStep[] {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const namespace = namespaceFlag(normalized);

  if (/\bkubectl\s+(?:apply|replace|set\s+(?:image|resources|env)|rollout\s+restart)\b/i.test(normalized)) {
    const workload = kubernetesWorkload(output);
    const rollout = workload
      ? `kubectl rollout status ${workload.kind}/${shellQuote(workload.name)}${namespace}`
      : `kubectl get pods${namespace}`;
    return [
      { id: "k8s-rollout", label: workload ? "check rollout" : "check pods", command: rollout },
      { id: "k8s-events", label: "recent events", command: `kubectl get events${namespace} --sort-by=.lastTimestamp | tail -20` },
    ];
  }

  if (/\bkubectl\s+rollout\s+(?:status|history|undo)\b/i.test(normalized)) {
    return [{ id: "k8s-pods", label: "check pods", command: `kubectl get pods${namespace}` }];
  }

  if (/\bterraform\s+init\b/i.test(normalized)) {
    return [
      { id: "terraform-validate", label: "validate", command: "terraform validate" },
      { id: "terraform-plan", label: "review plan", command: "terraform plan" },
    ];
  }

  if (/\bterraform\s+(?:apply|destroy)\b/i.test(normalized)) {
    return [
      { id: "terraform-output", label: "inspect outputs", command: "terraform output" },
      { id: "terraform-state", label: "list state", command: "terraform state list" },
    ];
  }

  if (/\bgit\s+(?:merge|rebase|cherry-pick)\b/i.test(normalized)) {
    return [
      { id: "git-status", label: "check status", command: "git status --short" },
      { id: "git-log", label: "inspect recent commits", command: "git log --oneline -5" },
    ];
  }

  if (/\bgit\s+commit\b/i.test(normalized)) {
    return [
      { id: "git-status", label: "check status", command: "git status --short" },
      { id: "git-push", label: "review push", command: "git push --dry-run" },
    ];
  }

  const manager = packageManager(normalized);
  if (manager && /\s+(?:install|i|add)\b/i.test(normalized)) {
    return [
      { id: "package-test", label: "run tests", command: `${manager} test` },
      { id: "package-outdated", label: "check outdated", command: `${manager} outdated` },
    ];
  }

  if (/\b(?:pnpm|npm|yarn|bun)\s+(?:test|run\s+test)\b/i.test(normalized)) {
    return [{ id: "git-status", label: "check changes", command: "git status --short" }];
  }

  if (/\bdocker\s+compose\s+(?:up|restart)\b/i.test(normalized)) {
    return [
      { id: "compose-ps", label: "check services", command: "docker compose ps" },
      { id: "compose-logs", label: "inspect logs", command: "docker compose logs --tail=100" },
    ];
  }

  if (/\bdocker\s+build\b/i.test(normalized)) {
    return [{ id: "docker-images", label: "inspect image", command: "docker images | head -10" }];
  }

  return [];
}

/** Avoid interrupting the shell after navigation and other no-op commands. */
export function isMeaningfulCompletedCommand(command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (normalized.length < 3) return false;
  return !/^(?:cd|ls|pwd|clear|history|which|echo|cat|head|tail|date|whoami)(?:\s|$)/i.test(normalized);
}

export function recordNextSteps(
  leafId: number,
  fields: { command: string; output: string; exitCode: number; cwd: string; at?: number },
): void {
  if (fields.exitCode !== 0 || !isMeaningfulCompletedCommand(fields.command)) {
    clearNextSteps(leafId);
    return;
  }
  entries.set(leafId, {
    record: {
      leafId,
      command: fields.command,
      output: fields.output,
      exitCode: fields.exitCode,
      cwd: fields.cwd,
      at: fields.at ?? Date.now(),
      local: localNextSteps(fields.command, fields.output),
      sensitive: scanForSecrets(fields.command, fields.output).length > 0,
    },
    collapsed: false,
  });
  emit();
}

export function clearNextSteps(leafId: number): void {
  if (entries.delete(leafId)) emit();
}

export function collapseNextSteps(leafId: number): void {
  const entry = entries.get(leafId);
  if (!entry || entry.collapsed) return;
  entries.set(leafId, { ...entry, collapsed: true });
  emit();
}

export function dismissNextSteps(leafId: number): void {
  clearNextSteps(leafId);
}

export function getNextSteps(leafId: number): NextStepEntry | null {
  return entries.get(leafId) ?? null;
}

export function subscribeNextSteps(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useNextSteps(leafId: number | null): NextStepEntry | null {
  return useSyncExternalStore(
    subscribeNextSteps,
    () => (leafId == null ? null : getNextSteps(leafId)),
  );
}
