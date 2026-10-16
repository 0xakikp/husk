import { detectStatusToolSignals, type StatusToolSignal } from "./statusBarTools";

/* Safety uses command evidence, not app-wide subprocess defaults: the app's
   environment is not the selected shell's environment, especially over SSH. */
const PROTECTED_RE = /prod|production|live/i;

export function isProtectedTarget(value: string | null): boolean {
  return value != null && PROTECTED_RE.test(value);
}

export type ProtectedKind = "kubernetes" | "aws" | "docker" | "terraform" | "git";

export function protectedReason(kind: ProtectedKind, value: string | null): string | null {
  if (!value) return null;
  if (kind !== "git" && PROTECTED_RE.test(value)) return "matches production pattern";
  return null;
}

/** Explicit command overrides and the caller's observed SSH host only. An
 * empty list means the target is unverified, never that it is safe. */
export function protectedTargets(command: string, sshHost: string | null = null): string[] {
  const hits = detectStatusToolSignals(command).flatMap((signal) =>
    signal.override && isProtectedTarget(signal.override.value)
      ? [`${signal.tool}/${signal.override.value}`]
      : [],
  );
  if (isProtectedTarget(sshHost)) hits.push(`SSH/${sshHost}`);
  return [...new Set(hits)];
}

/* Retain the existing conservative checks, including deployment scripts.
   Parsed argv below additionally covers global options before the action. */
const ENV_DESTRUCTIVE_RE =
  /\b(?:kubectl\s+(?:apply|replace|delete|drain|cordon|scale|patch|edit|set\s+(?:image|resources|env)|rollout\s+(?:undo|restart))|helm\s+(?:install|uninstall|delete|upgrade)|aws\s+\S+\s+(?:create|update|put|delete|terminate|stop|start|reboot|deregister|attach|detach|modify)|docker\s+(?:rm|rmi|system\s+prune|volume\s+rm|container\s+rm)|terraform\s+(?:destroy|apply|import)|pnpm\s+(?:deploy)|.*\bdeploy\b.*\bprod)/i;

const VALUE_FLAGS = new Set([
  "--context", "--kube-context", "--kubeconfig", "--namespace", "-n",
  "--cluster", "--user", "--server", "-s", "--token", "--as", "--as-group",
  "--certificate-authority", "--client-certificate", "--client-key", "--request-timeout",
  "--profile", "--region", "--endpoint-url", "--output", "--query", "--ca-bundle",
  "--cli-read-timeout", "--cli-connect-timeout", "--cli-binary-format", "--color",
  "--host", "-H", "-c", "--config", "--log-level", "-l", "--tlscacert", "--tlscert", "--tlskey",
  "--kube-apiserver", "--kube-token", "--kube-as-user", "--kube-as-group", "--kube-ca-file",
  "--registry-config", "--repository-config", "--repository-cache", "--burst-limit", "--qps",
  "-chdir",
]);

function positionalArgs(args: readonly string[]): string[] {
  const result: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--") return [...result, ...args.slice(index + 1)];
    if (arg.startsWith("-")) {
      if (VALUE_FLAGS.has(arg)) index++;
      continue;
    }
    result.push(arg);
  }
  return result;
}

/** This is a conservative approval check, not a shell-execution allowlist. */
export function isStatusToolMutation(signal: StatusToolSignal): boolean {
  const [action = "", subcommand = ""] = positionalArgs(signal.args);
  switch (signal.executable) {
    case "kubectl":
      return /^(apply|create|replace|delete|drain|cordon|uncordon|scale|patch|edit|taint|label|annotate)$/.test(action)
        || action === "set" && /^(image|resources|env|selector|subject|serviceaccount)$/.test(subcommand)
        || action === "rollout" && /^(undo|restart)$/.test(subcommand);
    case "helm":
      return /^(install|uninstall|delete|upgrade|rollback)$/.test(action);
    case "aws":
      return /^(create|update|put|delete|terminate|stop|start|reboot|deregister|attach|detach|modify|set)(?:-|$)/.test(subcommand)
        || action === "s3" && /^(cp|mv|rm|sync)$/.test(subcommand);
    case "docker":
      return /^(rm|rmi)$/.test(action)
        || action === "system" && subcommand === "prune"
        || /^(volume|container)$/.test(action) && subcommand === "rm";
    case "terraform":
      return /^(destroy|apply|import)$/.test(action);
  }
}

export function isEnvDestructive(command: string): boolean {
  return ENV_DESTRUCTIVE_RE.test(command.trim())
    || detectStatusToolSignals(command).some(isStatusToolMutation);
}

/** Infrastructure changes always earn review, including when no shell-local
 * target has been verified. Status visibility must never control this gate. */
export function environmentRunReview(command: string, sshHost: string | null = null): {
  productionTarget: string | null;
  message: string;
} | null {
  if (!isEnvDestructive(command)) return null;
  const productionTarget = protectedTargets(command, sshHost)[0] ?? null;
  return {
    productionTarget,
    message: productionTarget
      ? `Protected target named by command or SSH session: ${productionTarget} — approve to run`
      : "Infrastructure-changing command — verify the terminal's target before approving",
  };
}
