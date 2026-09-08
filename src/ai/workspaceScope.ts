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
  if (!path || path.includes("\0")) return "";
  const windows = /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("//");
  const normalized = windows ? path.replace(/\\/g, "/") : path;
  if (normalized.startsWith("//?/") || normalized.startsWith("//./")) return "";
  const drive = normalized.match(/^([A-Za-z]):\//);
  const unc = normalized.startsWith("//");
  if (!drive && !normalized.startsWith("/")) return "";
  const segments = normalized.slice(drive ? 3 : unc ? 2 : 1).split("/").filter(Boolean);
  if (segments.some((part) => part === "." || part === ".." || (windows && /[:<>|?*]/.test(part)))) return "";
  if (unc && segments.length < 2) return "";
  const prefix = drive ? `${drive[1].toUpperCase()}:/` : unc ? "//" : "/";
  return prefix + segments.join("/");
}

/** True only when an absolute path belongs to the supplied workspace root. */
export function isPathInWorkspace(path: string | null | undefined, workspaceRoot: string | null | undefined): boolean {
  let root = normalizeWorkspacePath(workspaceRoot);
  let target = normalizeWorkspacePath(path);
  if (!root || !target) return false;
  if (/^[A-Z]:\//.test(root) || root.startsWith("//")) {
    root = root.toLowerCase();
    target = target.toLowerCase();
  }
  return target === root || target.startsWith(root.endsWith("/") ? root : `${root}/`);
}

/**
 * Choose the workspace represented by the terminal the user is looking at.
 * The asynchronously resolved project root is useful while the shell remains
 * inside it, but it must never win after the terminal has cd-ed elsewhere.
 * Falling back to the live CWD also handles filesystem aliases such as macOS
 * `/tmp` and `/private/tmp` without sending the chat back to a stale project.
 */
export function currentTerminalWorkspace(
  terminalCwd: string | null | undefined,
  resolvedWorkspaceRoot: string | null | undefined,
): string {
  const cwd = normalizeWorkspacePath(terminalCwd);
  const root = normalizeWorkspacePath(resolvedWorkspaceRoot);
  if (!cwd) return root;
  return root && isPathInWorkspace(cwd, root) ? root : cwd;
}

/** True when an async project-root lookup still belongs to the visible shell. */
export function workspaceResolutionApplies(
  requestedCwd: string | null | undefined,
  resolvedWorkspaceRoot: string | null | undefined,
  currentCwd: string | null | undefined,
): boolean {
  return isPathInWorkspace(currentCwd, requestedCwd)
    || isPathInWorkspace(currentCwd, resolvedWorkspaceRoot);
}

/**
 * Resolve a model-supplied file reference safely inside a selected workspace.
 * Relative references become absolute; parent traversal and outside absolute
 * paths are refused before any filesystem call is made.
 */
export function resolveWorkspacePath(path: string, workspaceRoot: string | null | undefined): string | null {
  const root = normalizeWorkspacePath(workspaceRoot);
  const windows = /^[A-Z]:\//.test(root) || root.startsWith("//");
  const input = windows ? path.trim().replace(/\\/g, "/") : path.trim();
  if (!root || !input || input.includes("\0")) return null;

  if (input.startsWith("/") || /^[A-Za-z]:/.test(input)) {
    if (input.split("/").includes("..")) return null;
    return isPathInWorkspace(input, root) ? normalizeWorkspacePath(input) : null;
  }

  /* `.` is the conventional and documented reference to the selected
     workspace root. Treat it as the root itself before segment validation;
     otherwise the generic rejection of dot segments makes workspace.list
     impossible at the exact path Husk teaches models to use. */
  if (input === "." || input === "./") return root;

  const relative = input.replace(/^\.\//, "");
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;
  const resolved = normalizeWorkspacePath(`${root.endsWith("/") ? root : `${root}/`}${segments.join("/")}`);
  return resolved && isPathInWorkspace(resolved, root) ? resolved : null;
}

export function workspaceDisplayName(path: string | null | undefined): string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return "No workspace";
  if (normalized === "/") return "/";
  return normalized.split("/").pop() || normalized;
}
