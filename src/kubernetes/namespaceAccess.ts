import { invoke } from "@tauri-apps/api/core";
import type { K8sReadScope } from "./configSource";
import { boundedK8sDiagnostic, missingCredentialHelper } from "./commandErrors";

export type NamespaceAccessResult = {
  resource: string;
  /** null means the permission check itself failed, not that access was denied. */
  allowed: boolean | null;
  error?: string;
  errorHint?: string;
  diagnostics?: string;
};

/** Only the read permissions used by Husk's built-in Kubernetes views. */
export const NAMESPACE_ACCESS_RESOURCES = [
  "namespaces", "pods", "services", "configmaps", "secrets", "persistentvolumeclaims",
  "resourcequotas", "events", "endpoints", "deployments.apps", "replicasets.apps",
  "statefulsets.apps", "daemonsets.apps", "ingresses.networking.k8s.io", "jobs.batch",
  "cronjobs.batch", "endpointslices.discovery.k8s.io",
] as const;

const allowedResources = new Set<string>(NAMESPACE_ACCESS_RESOURCES);
const TIMEOUT_SECONDS = 10;
const MAX_CONCURRENT_CHECKS = 3;

type CommandOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

/** Namespace names are DNS labels. UI-only sentinels such as `_all` are not names. */
export function isValidNamespace(value: string): boolean {
  return value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value);
}

function contextOf(scope: K8sReadScope): string {
  const context = typeof scope === "string" ? scope : scope.context;
  if (!context.trim()) throw new Error("Choose a Kubernetes context before checking namespace access.");
  return context;
}

async function run(args: string[], scope: K8sReadScope): Promise<CommandOutput> {
  // Arguments go directly to kubectl; neither namespace names nor context names
  // pass through a shell. Do not read or change kubectl's current context.
  const scopedArgs = [...args, `--context=${contextOf(scope)}`, `--request-timeout=${TIMEOUT_SECONDS}s`];
  return typeof scope === "object"
    ? invoke<CommandOutput>("kubernetes_run_command", {
      args: scopedArgs,
      kubeconfigPaths: scope.config.paths,
      cwd: scope.config.cwd,
      timeoutSecs: TIMEOUT_SECONDS,
    })
    : invoke<CommandOutput>("shell_run_command", {
      program: "kubectl", args: scopedArgs, cwd: null, timeout_secs: TIMEOUT_SECONDS,
    });
}

function incompleteOutput(output: CommandOutput): string | undefined {
  if (output.timed_out) return "The permission check timed out. Check cluster connectivity and try again.";
  if (output.truncated) return "The permission check output exceeded the local size limit; its result is unknown.";
  return undefined;
}

function unavailable(resource: string, error: string): NamespaceAccessResult {
  const missing = missingCredentialHelper(error);
  return missing ? {
    resource, allowed: null, error: missing.title,
    errorHint: `Authentication could not start; permissions were not checked. ${missing.guidance}`,
    diagnostics: boundedK8sDiagnostic(error),
  } : { resource, allowed: null, error };
}

/** Reads only namespace metadata from the selected local kubeconfig context. */
export async function getContextNamespace(scope: K8sReadScope): Promise<string> {
  const output = await run(["config", "view", "--minify", "--output=jsonpath={.contexts[0].context.namespace}"], scope);
  if (output.timed_out) throw new Error("Reading the context's namespace timed out.");
  if (output.truncated) throw new Error("The context's namespace output exceeded the local size limit.");
  if (output.exit_code !== 0) throw new Error(output.stderr.trim() || "Could not read the context's namespace.");
  const namespace = output.stdout.trim();
  // Kubernetes defaults to `default` only when a successfully read context has
  // no namespace. Failed reads must never silently select a different namespace.
  if (!namespace) return "default";
  if (!isValidNamespace(namespace)) throw new Error("The selected context contains an invalid namespace name. Enter a namespace manually.");
  return namespace;
}

/** Explicit, bounded permission probes. Does not fetch resource or Secret data. */
export async function checkNamespaceAccess(
  namespace: string,
  resources: readonly string[],
  scope: K8sReadScope,
): Promise<NamespaceAccessResult[]> {
  contextOf(scope);
  if (namespace !== "_all" && !isValidNamespace(namespace)) throw new Error("Enter a valid Kubernetes namespace.");
  if (resources.length > NAMESPACE_ACCESS_RESOURCES.length || resources.some((resource) => !allowedResources.has(resource))) {
    throw new Error("Unsupported Kubernetes read-permission check.");
  }
  const uniqueResources = [...new Set(resources)];
  const results: NamespaceAccessResult[] = new Array(uniqueResources.length);
  let next = 0;
  async function worker() {
    while (next < uniqueResources.length) {
      const index = next++;
      const resource = uniqueResources[index];
      try {
        // Namespace discovery is cluster-scoped. `--all-namespaces` also avoids
        // implying that namespace-list permission can be granted in one namespace.
        const scopeArgs = resource === "namespaces" || namespace === "_all"
          ? ["--all-namespaces"] : ["--namespace", namespace];
        const output = await run(["auth", "can-i", "list", resource, ...scopeArgs], scope);
        const incomplete = incompleteOutput(output);
        const answer = output.stdout.trim();
        const diagnostic = output.stderr.trim();
        if (incomplete) results[index] = { resource, allowed: null, error: incomplete };
        else if (!diagnostic && answer === "yes" && output.exit_code === 0) results[index] = { resource, allowed: true };
        else if (!diagnostic && answer === "no" && (output.exit_code === 1 || output.exit_code === 0)) results[index] = { resource, allowed: false };
        else results[index] = unavailable(resource,
          // kubectl flattens a denied reason and an authorizer evaluation error
          // into the same `no - ...` format. Conservatively keep that unknown.
          diagnostic || (answer.startsWith("no - ") ? answer : `Could not confirm this permission (kubectl exit ${output.exit_code ?? "unknown"}).`),
        );
      } catch (error) {
        results[index] = unavailable(resource, error instanceof Error ? error.message : String(error));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENT_CHECKS, uniqueResources.length) }, worker));
  return results;
}
