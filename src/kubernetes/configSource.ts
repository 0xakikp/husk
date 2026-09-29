import { invoke } from "@tauri-apps/api/core";

/** Paths only. Kubeconfig contents and credentials never enter frontend state. */
export type K8sConfigSource = {
  kind: "app" | "file" | "terminal";
  paths: string[];
  cwd: string;
  fingerprint: string;
  label: string;
  missingPaths: string[];
  pathSeparator?: string;
};

export type K8sReadScope = string | { context: string; config: K8sConfigSource };

export type K8sConfigRequest =
  | { kind: "app" }
  | { kind: "file"; path: string }
  | { kind: "terminal"; kubeconfig: string; cwd: string };

export function resolveK8sConfig(request: K8sConfigRequest): Promise<K8sConfigSource> {
  return invoke("kubernetes_resolve_config", { request });
}

export function configSourceName(source: K8sConfigSource): string {
  return source.kind === "app" ? "App default" : source.kind === "file" ? "Kubeconfig file" : "Terminal snapshot";
}

/** Reproducible read-only CLI examples use the inspected source, not the terminal's current config. */
export function configEnvironment(source: K8sConfigSource | undefined, quote: (text: string) => string): string {
  if (!source) return "";
  // This app's terminal command examples use POSIX syntax. The source is resolved
  // natively and never inferred from a mutable active terminal after selection.
  return `KUBECONFIG=${quote(source.paths.join(source.pathSeparator || ":"))} `;
}
