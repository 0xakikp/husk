/** Explicit, per-chat access to a folder on the host of an active SSH shell. */
export type RemoteWorkspaceScope = {
  kind: "ssh";
  /** The exact safe SSH target used by the terminal, for example `prod` or `me@host`. */
  host: string;
  /** Absolute POSIX path on that host. */
  path: string;
};

const SAFE_SSH_TARGET = /^(?!-)[A-Za-z0-9_.:@\[\]-]+$/;

export function normalizeRemoteHost(value: unknown): string {
  if (typeof value !== "string") return "";
  const host = value.trim();
  return host && host.length <= 255 && SAFE_SSH_TARGET.test(host) ? host : "";
}

/** Normalize without ever allowing `..` to escape the selected remote root. */
export function normalizeRemotePath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.includes("\0")) return "";
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function normalizeRemoteWorkspace(value: unknown): RemoteWorkspaceScope | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<RemoteWorkspaceScope>;
  const host = normalizeRemoteHost(candidate.host);
  const path = normalizeRemotePath(candidate.path);
  if (candidate.kind !== "ssh" || !host || !path) return undefined;
  return { kind: "ssh", host, path };
}

export function resolveRemoteWorkspacePath(value: string, rootValue: string): string | null {
  const root = normalizeRemotePath(rootValue);
  if (!root) return null;
  const candidate = value.startsWith("/")
    ? normalizeRemotePath(value)
    : normalizeRemotePath(`${root}/${value || "."}`);
  if (!candidate) return null;
  return root === "/" || candidate === root || candidate.startsWith(`${root}/`) ? candidate : null;
}

export function remoteWorkspaceLabel(scope: RemoteWorkspaceScope): string {
  const name = scope.path === "/" ? "/" : scope.path.split("/").filter(Boolean).pop() || scope.path;
  return `${scope.host}:${name}`;
}
