import { detectStatusToolSignals, statusToolOverrides, type StatusTool, type StatusToolSignal } from "./statusBarTools";

/* Safety uses command evidence, not app-wide subprocess defaults: the app's
   environment is not the selected shell's environment, especially over SSH. */
const PROTECTED_RE = /prod|production|live/i;

export function isProtectedTarget(value: string | null): boolean {
  return value != null && PROTECTED_RE.test(value);
}

export type ProtectedKind = StatusTool | "git";

export function protectedReason(kind: ProtectedKind, value: string | null): string | null {
  if (!value) return null;
  if (kind !== "git" && PROTECTED_RE.test(value)) return "matches production pattern";
  return null;
}

/** Explicit command overrides and the caller's observed SSH host only. An
 * empty list means the target is unverified, never that it is safe. */
export function protectedTargets(command: string, sshHost: string | null = null): string[] {
  const hits = detectStatusToolSignals(command).flatMap((signal) =>
    statusToolOverrides(signal).filter((override) => isProtectedTarget(override.value))
      .map((override) => `${signal.tool}/${override.value}`),
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

type ExpandedInfrastructure = "oci" | "az" | "gcloud" | "podman" | "orb" | "orbctl" | "colima";

/* These are intentionally small read/utility exceptions to an extra review,
   not execution permissions. Unknown commands/options still earn review.
   Explicit paths avoid mistaking a payload or resource named "list"/"get"
   for a read action. Keep remote execution, raw requests and scripts outside
   these exceptions, even if their nested command appears harmless. */
const READ_OPTIONS: Record<ExpandedInfrastructure, readonly string[]> = {
  oci: ["--profile", "--region", "--config-file", "--cli-rc-file", "--auth", "--output", "--query", "--endpoint",
    "--compartment-id", "--instance-id", "--user-id", "--group-id", "--cluster-id", "--vcn-id", "--subnet-id",
    "--namespace-name", "--bucket-name", "--name", "--limit", "--page", "--sort-by", "--sort-order"],
  az: ["--subscription", "--output", "-o", "--query", "--resource-group", "-g", "--name", "-n", "--ids",
    "--location", "-l", "--top", "--skip"],
  gcloud: ["--project", "--configuration", "--account", "--billing-project", "--format", "--filter", "--limit",
    "--page-size", "--sort-by", "--region", "--zone", "--verbosity"],
  podman: ["--connection", "-c", "--url", "--identity", "--log-level", "--format", "--filter", "-f",
    "--namespace", "--tail", "--since", "--until"],
  orb: ["--machine", "-m", "--user", "-u"],
  orbctl: ["--machine", "-m", "--user", "-u"],
  colima: ["--profile", "-p"],
};
const READ_BOOLEAN_OPTIONS: Record<ExpandedInfrastructure, readonly string[]> = {
  oci: ["--debug", "--all", "--raw-output", "--no-retry"],
  az: ["--debug", "--verbose", "--only-show-errors"],
  gcloud: ["--quiet", "-q", "--log-http", "--no-user-output-enabled"],
  podman: ["--remote", "-r", "--all", "-a", "--quiet", "-q", "--no-trunc", "--no-stream", "--follow"],
  orb: ["--json"],
  orbctl: ["--json"],
  colima: ["--json", "--verbose"],
};
const READ_PATHS: Record<ExpandedInfrastructure, RegExp> = {
  oci: /^(?:compute instance (?:list|get)|iam (?:region|availability-domain|compartment|user|group) (?:list|get)|os (?:bucket|object) (?:list|head)|ce cluster (?:list|get)|network (?:vcn|subnet) (?:list|get))$/,
  az: /^(?:(?:account|group|vm|aks|resource) (?:list|show)|network vnet(?: subnet)? (?:list|show)|version)$/,
  gcloud: /^(?:(?:(?:compute instances|container clusters|run services|projects) list)|(?:compute instances|container clusters|run services|projects) describe(?: [A-Za-z0-9_.:/@+-]+)?|config list|config get-value [A-Za-z0-9_./-]+|auth list|version|info)$/,
  podman: /^(?:(?:ps|images|info|version)|(?:inspect|logs|stats|top|diff|history)(?: [A-Za-z0-9_.:/@+-]+)*|(?:container|image|volume|network|pod|machine) (?:list|ls|ps|inspect|info)(?: [A-Za-z0-9_.:/@+-]+)*|system (?:df|info|connection list))$/,
  orb: /^(?:(?:list|status|version)|(?:info|logs)(?: [A-Za-z0-9_.-]+)?|help(?: [A-Za-z0-9_-]+)*)$/,
  orbctl: /^(?:(?:list|status|version)|(?:info|logs)(?: [A-Za-z0-9_.-]+)?|help(?: [A-Za-z0-9_-]+)*)$/,
  colima: /^(?:list|status|version|help(?: [A-Za-z0-9_-]+)*)$/,
};

function expandedInfrastructureNeedsReview(executable: ExpandedInfrastructure, args: readonly string[]): boolean {
  const positional: string[] = [];
  let utility = false;
  for (let at = 0; at < args.length; at++) {
    const arg = args[at];
    // The relevance parser deliberately does not evaluate shell expansion.
    if (/[\$`*?\[\]~]/.test(arg) || arg === "--") return true;
    if (!arg.startsWith("-")) { positional.push(arg); continue; }
    const equal = arg.indexOf("=");
    const flag = equal < 0 ? arg : arg.slice(0, equal);
    if (READ_OPTIONS[executable].includes(flag)) {
      const value = equal < 0 ? args[++at] : arg.slice(equal + 1);
      if (!value || value.startsWith("-") || /[\$`*?\[\]~]/.test(value)) return true;
    } else if (equal < 0 && ["--help", "-h", "--version"].includes(flag)) {
      utility = true;
    } else if (equal < 0 && READ_BOOLEAN_OPTIONS[executable].includes(flag)) {
      continue;
    } else {
      return true;
    }
  }
  // A nested --help must not exempt `orb run ...` or `podman run ...`.
  return !(utility && positional.length === 0 || READ_PATHS[executable].test(positional.join(" ")));
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
    case "oci": case "az": case "gcloud": case "podman": case "orb": case "orbctl": case "colima":
      return expandedInfrastructureNeedsReview(signal.executable, signal.args);
    // Activity recognition for a runtime/connection is not evidence that its
    // command mutates infrastructure. Other command safety checks still apply.
    default:
      return false;
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
