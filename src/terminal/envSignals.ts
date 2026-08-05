import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getProjectProfile } from "../project/profile";

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
  checkedAt: number;
};

type ShellOutput = { stdout: string; stderr: string; exit_code: number | null };

let signals: EnvSignals = {
  kubeContext: null,
  awsProfile: null,
  dockerContext: null,
  checkedAt: 0,
};

const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

/* Until Project Profiles land (Release 2), protected matching is conservative
   and hardcoded: anything that looks like production gets the accent. */
const PROTECTED_RE = /prod|production|live/i;

export function isProtectedTarget(value: string | null): boolean {
  return value != null && PROTECTED_RE.test(value);
}

/** Supports exact names and simple "release/*" style globs. */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (!pattern.includes("*")) return false;
  const re = new RegExp(`^${pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(value);
}

export type ProtectedKind = "kubernetes" | "aws" | "docker" | "git";

/**
 * Why a target is protected, or null when it is safe. A project profile's
 * [safety] lists win first; the generic production pattern is the fallback so
 * even profile-less projects get warned about obvious prod targets. Git
 * branches only warn when the profile lists them — "main" alone is not an
 * incident waiting to happen.
 */
export function protectedReason(kind: ProtectedKind, value: string | null): string | null {
  if (!value) return null;
  const safety = getProjectProfile()?.safety;
  const listed =
    kind === "kubernetes"
      ? (safety?.protected_kubernetes_contexts ?? [])
      : kind === "aws"
        ? (safety?.protected_aws_profiles ?? [])
        : kind === "git"
          ? (safety?.protected_git_branches ?? [])
          : [];
  if (listed.some((p) => matchesPattern(p, value))) return "protected by project profile";
  if (kind !== "git" && PROTECTED_RE.test(value)) return "matches production pattern";
  return null;
}

/* Commands that mutate shared infrastructure. Combined with protectedReason
   by callers: a destructive command on a protected target needs an explicit
   confirmation, never a silent run. */
const ENV_DESTRUCTIVE_RE =
  /\b(?:kubectl\s+(?:delete|drain|cordon|scale|rollout\s+undo)|helm\s+(?:uninstall|delete|upgrade)|aws\s+\S+\s+(?:delete|terminate|stop|reboot|deregister)|docker\s+(?:rm|rmi|system\s+prune|volume\s+rm|container\s+rm)|terraform\s+(?:destroy|apply)|pnpm\s+(?:deploy)|.*\bdeploy\b.*\bprod)/i;

export function isEnvDestructive(command: string): boolean {
  return ENV_DESTRUCTIVE_RE.test(command.trim());
}

async function runProbe(program: string, args: string[], timeoutSecs = 3): Promise<string | null> {
  try {
    const out = await invoke<ShellOutput>("shell_run_command", {
      program,
      args,
      cwd: null,
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

let refreshing: Promise<void> | null = null;
let lastRefresh = 0;
const MIN_REFRESH_INTERVAL_MS = 20_000;

/**
 * Refresh all signals, throttled. `force` bypasses the throttle (explicit
 * user refresh); cwd changes and the interval tick go through it so a burst
 * of cd commands cannot spawn a burst of probes.
 */
export function refreshEnvSignals(force = false): void {
  const now = Date.now();
  if (!force && now - lastRefresh < MIN_REFRESH_INTERVAL_MS) return;
  if (refreshing) return;
  lastRefresh = now;
  refreshing = (async () => {
    const [kubeContext, awsProfile, dockerContext] = await Promise.all([
      probeKube(),
      probeAws(),
      probeDocker(),
    ]);
    signals = { kubeContext, awsProfile, dockerContext, checkedAt: Date.now() };
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
