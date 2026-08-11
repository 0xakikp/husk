import { useSyncExternalStore } from "react";

import { type EnvSignals, isProtectedTarget } from "./envSignals";

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

const KUBERNETES_MUTATION_RE =
  /\b(?:kubectl\s+(?:apply|replace|delete|patch|edit|scale|set\s+(?:image|resources|env)|rollout\s+(?:restart|undo))|helm\s+(?:install|upgrade|uninstall|delete))\b/i;
const AWS_MUTATION_RE =
  /\baws\s+\S+\s+(?:create|update|put|delete|terminate|stop|start|reboot|attach|detach|modify|set)-?\S*/i;
const TERRAFORM_MUTATION_RE = /\bterraform\s+(?:apply|destroy|import)\b/i;
const DOCKER_MUTATION_RE = /\bdocker\s+(?:rm|rmi|system\s+prune|volume\s+rm|container\s+rm)\b/i;
const DEPLOY_SCRIPT_RE = /\b(?:deploy|release|ship)\b/i;

function target(kind: EnvironmentKind, value: string): EnvironmentTarget {
  switch (kind) {
    case "kubernetes":
      return { kind, value, inspectCommand: "kubectl config current-context" };
    case "aws":
      return { kind, value, inspectCommand: "aws configure list" };
    case "terraform":
      return { kind, value, inspectCommand: "terraform workspace show" };
    case "docker":
      return { kind, value, inspectCommand: "docker context show" };
  }
}

/**
 * A warning is deliberately command-aware. Seeing a production context in the
 * status bar is useful context; an interrupting warning is earned only when a
 * command is likely to change that target.
 */
export function protectedTargetsForCommand(command: string, env: EnvSignals): EnvironmentTarget[] {
  const normalized = command.trim().replace(/\s+/g, " ");
  if (!normalized) return [];
  const targets: EnvironmentTarget[] = [];
  const deployScript = DEPLOY_SCRIPT_RE.test(normalized);

  if (env.kubeContext && isProtectedTarget(env.kubeContext) && (KUBERNETES_MUTATION_RE.test(normalized) || deployScript)) {
    targets.push(target("kubernetes", env.kubeContext));
  }
  if (env.awsProfile && isProtectedTarget(env.awsProfile) && (AWS_MUTATION_RE.test(normalized) || TERRAFORM_MUTATION_RE.test(normalized) || deployScript)) {
    targets.push(target("aws", env.awsProfile));
  }
  if (env.terraformWorkspace && isProtectedTarget(env.terraformWorkspace) && (TERRAFORM_MUTATION_RE.test(normalized) || deployScript)) {
    targets.push(target("terraform", env.terraformWorkspace));
  }
  if (env.dockerContext && isProtectedTarget(env.dockerContext) && (DOCKER_MUTATION_RE.test(normalized) || deployScript)) {
    targets.push(target("docker", env.dockerContext));
  }

  return targets;
}

export function recordEnvironmentWarning(
  leafId: number,
  fields: { command: string; cwd: string; env: EnvSignals; at?: number },
): void {
  const targets = protectedTargetsForCommand(fields.command, fields.env);
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
