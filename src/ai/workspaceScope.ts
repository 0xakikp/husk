/**
 * Helpers shared by the AI session, context builder, and file tools.
 *
 * A workspace scope is deliberately a simple absolute local folder. It is not
 * a second workspace model: it records the folder a particular conversation is
 * allowed to treat as its project, even while the active terminal later moves
 * somewhere else.
 */

/** Remove a trailing slash without turning the filesystem root into an empty string. */
export function normalizeWorkspacePath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/")) return "";
  const trimmed = path.replace(/\/+$/, "");
  return trimmed || "/";
}

/** True only when an absolute path belongs to the supplied workspace root. */
export function isPathInWorkspace(path: string | null | undefined, workspaceRoot: string | null | undefined): boolean {
  const root = normalizeWorkspacePath(workspaceRoot);
  const target = normalizeWorkspacePath(path);
  if (!root || !target) return false;
  return root === "/" || target === root || target.startsWith(`${root}/`);
}

/**
 * Resolve a model-supplied file reference safely inside a selected workspace.
 * Relative references become absolute; parent traversal and outside absolute
 * paths are refused before any filesystem call is made.
 */
export function resolveWorkspacePath(path: string, workspaceRoot: string | null | undefined): string | null {
  const root = normalizeWorkspacePath(workspaceRoot);
  const input = path.trim();
  if (!root || !input || input.includes("\0")) return null;

  if (input.startsWith("/")) {
    if (input.split("/").includes("..")) return null;
    return isPathInWorkspace(input, root) ? normalizeWorkspacePath(input) : null;
  }

  const relative = input.replace(/^\.\//, "");
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  return root === "/" ? `/${segments.join("/")}` : `${root}/${segments.join("/")}`;
}

export function workspaceDisplayName(path: string | null | undefined): string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return "No workspace";
  if (normalized === "/") return "/";
  return normalized.split("/").pop() || normalized;
}
