import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * Environment Safety Signals.
 *
 * Detects the operational context the terminal is working against —
 * Kubernetes context, AWS profile, Docker context — and surfaces it in the
 * bottom bar, with a deliberate accent for production-looking targets.
 *
 * Detection is cached and refreshed on a modest interval plus working-
 * directory changes. It never piggybacks the 5s git poll: each source is a
 * subprocess, and a status bar has no business spawning one every few seconds.
 */

export type EnvSignals = {
  kubeContext: string | null;
  awsProfile: string | null;
  dockerContext: string | null;
  terraformWorkspace: string | null;
  checkedAt: number;
};

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

let signals: EnvSignals = {
  kubeContext: null,
  awsProfile: null,
  dockerContext: null,
  terraformWorkspace: null,
  checkedAt: 0,
};

const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

/* Protected matching is conservative and hardcoded: anything that looks like
   production gets the accent. */
const PROTECTED_RE = /prod|production|live/i;

export function isProtectedTarget(value: string | null): boolean {
  return value != null && PROTECTED_RE.test(value);
}

export type ProtectedKind = "kubernetes" | "aws" | "docker" | "terraform" | "git";

/**
 * Why a target is protected, or null when it is safe. Driven by the generic
 * production pattern so every project gets warned about obvious prod targets.
 * Git branches never warn on pattern alone — "main" is not an incident
 * waiting to happen.
 */
export function protectedReason(kind: ProtectedKind, value: string | null): string | null {
  if (!value) return null;
  if (kind !== "git" && PROTECTED_RE.test(value)) return "matches production pattern";
  return null;
}

/** Current protected targets from live environment signals. */
export function protectedTargets(): string[] {
  const env = getEnvSignals();
  const hits: string[] = [];
  if (env.kubeContext && isProtectedTarget(env.kubeContext)) hits.push(`kubernetes/${env.kubeContext}`);
  if (env.awsProfile && isProtectedTarget(env.awsProfile)) hits.push(`aws/${env.awsProfile}`);
  if (env.dockerContext && isProtectedTarget(env.dockerContext)) hits.push(`docker/${env.dockerContext}`);
  if (env.terraformWorkspace && isProtectedTarget(env.terraformWorkspace)) hits.push(`terraform/${env.terraformWorkspace}`);
  return hits;
}

/* Commands that mutate shared infrastructure. Combined with protectedReason
   by callers: a destructive command on a protected target needs an explicit
   confirmation, never a silent run. */
const ENV_DESTRUCTIVE_RE =
  /\b(?:kubectl\s+(?:apply|replace|delete|drain|cordon|scale|patch|edit|set\s+(?:image|resources|env)|rollout\s+(?:undo|restart))|helm\s+(?:install|uninstall|delete|upgrade)|aws\s+\S+\s+(?:create|update|put|delete|terminate|stop|start|reboot|deregister|attach|detach|modify)|docker\s+(?:rm|rmi|system\s+prune|volume\s+rm|container\s+rm)|terraform\s+(?:destroy|apply|import)|pnpm\s+(?:deploy)|.*\bdeploy\b.*\bprod)/i;

export function isEnvDestructive(command: string): boolean {
  return ENV_DESTRUCTIVE_RE.test(command.trim());
}

async function runProbe(
  program: string,
  args: string[],
  timeoutSecs = 3,
  cwd: string | null = null,
): Promise<string | null> {
  try {
    const out = await invoke<ShellOutput>("shell_run_command", {
      program,
      args,
      cwd,
      timeout_secs: timeoutSecs,
    });
    if (out.exit_code !== 0) return null;
    const value = out.stdout.trim();
    return value || null;
  } catch {
    /* Tool not installed is a normal result, not an error worth surfacing. */
    return null;
  }
}

async function probeKube(): Promise<string | null> {
  const ctx = await runProbe("kubectl", ["config", "current-context"]);
  if (!ctx || ctx.includes("error") || ctx.includes("not set")) return null;
  return ctx;
}

async function probeAws(): Promise<string | null> {
  /* The terminal's exported profile is what actually applies to commands, and
     only a login shell sees it. Empty means no profile is exported — in which
     case saying nothing beats claiming "default" and being wrong. */
  return runProbe("sh", ["-lc", "printf %s \"${AWS_PROFILE:-${AWS_DEFAULT_PROFILE}}\""], 4);
}

async function probeDocker(): Promise<string | null> {
  const ctx = await runProbe("docker", ["context", "show"]);
  /* The default context is the uninteresting case; only named contexts change
     what docker commands target. */
  if (!ctx || ctx === "default") return null;
  return ctx;
}

async function probeTerraform(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  const workspace = await runProbe("terraform", ["workspace", "show"], 4, cwd);
  if (!workspace || /not initialized|no configuration files|error:/i.test(workspace)) return null;
  return workspace;
}

let refreshing: Promise<void> | null = null;
let lastRefresh = 0;
let lastWorkspaceCwd: string | null = null;
const MIN_REFRESH_INTERVAL_MS = 20_000;

/**
 * Refresh all signals, throttled. `force` bypasses the throttle (explicit
 * user refresh); cwd changes and the interval tick go through it so a burst
 * of cd commands cannot spawn a burst of probes.
 */
export function refreshEnvSignals(force = false, cwd?: string | null): void {
  const now = Date.now();
  const workspaceCwd = cwd ?? lastWorkspaceCwd;
  if (!force && workspaceCwd === lastWorkspaceCwd && now - lastRefresh < MIN_REFRESH_INTERVAL_MS) return;
  if (refreshing) return;
  lastRefresh = now;
  lastWorkspaceCwd = workspaceCwd;
  refreshing = (async () => {
    const [kubeContext, awsProfile, dockerContext, terraformWorkspace] = await Promise.all([
      probeKube(),
      probeAws(),
      probeDocker(),
      probeTerraform(workspaceCwd),
    ]);
    signals = { kubeContext, awsProfile, dockerContext, terraformWorkspace, checkedAt: Date.now() };
    emit();
    refreshing = null;
  })();
}

export function getEnvSignals(): EnvSignals {
  return signals;
}

export function subscribeEnvSignals(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useEnvSignals(): EnvSignals {
  return useSyncExternalStore(subscribeEnvSignals, getEnvSignals);
}
