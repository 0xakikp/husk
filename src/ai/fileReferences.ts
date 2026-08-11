/**
 * Parse a file reference that an assistant placed in inline Markdown code.
 * Only workspace-relative paths are accepted: a reply must never turn an
 * arbitrary absolute path or a `../` escape into an editor navigation action.
 */
export type WorkspaceFileReference = {
  relativePath: string;
  line?: number;
};

const PATH_AND_LINE = /^(?<path>(?:\.?\/?[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*)|(?:\.?\/[A-Za-z0-9_@.+-]+(?:\/[A-Za-z0-9_@.+-]+)*))(?::(?<line>[1-9]\d*))?$/;

export function parseWorkspaceFileReference(value: string): WorkspaceFileReference | null {
  const source = value.trim();
  if (!source || source.startsWith("/") || source.includes("\\")) return null;
  const match = source.match(PATH_AND_LINE);
  if (!match?.groups?.path) return null;

  const relativePath = match.groups.path.replace(/^\.\//, "");
  const segments = relativePath.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null;

  const line = match.groups.line ? Number(match.groups.line) : undefined;
  return Number.isSafeInteger(line ?? 1) ? { relativePath, line } : null;
}
