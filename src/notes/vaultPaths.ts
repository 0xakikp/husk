const NOTE_EXTENSION = /\.(md|mdx|txt)$/i;

export function vaultParent(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "/" : normalized.slice(0, separator);
}

export function vaultJoin(parent: string, name: string): string {
  return `${parent.replace(/\/+$/, "")}/${name}`;
}

export function isVaultPathWithin(path: string, parent: string): boolean {
  const normalizedPath = path.replace(/\/+$/, "");
  const normalizedParent = parent.replace(/\/+$/, "");
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function replaceVaultPath(path: string, from: string, to: string): string {
  if (!isVaultPathWithin(path, from)) return path;
  const normalizedFrom = from.replace(/\/+$/, "");
  const normalizedTo = to.replace(/\/+$/, "");
  return `${normalizedTo}${path.replace(/\/+$/, "").slice(normalizedFrom.length)}`;
}

export function normalizedVaultName(originalName: string, requestedName: string, isDirectory: boolean): string {
  const trimmed = requestedName.trim();
  if (isDirectory || NOTE_EXTENSION.test(trimmed)) return trimmed;
  const extension = originalName.match(NOTE_EXTENSION)?.[0] ?? ".md";
  return `${trimmed}${extension}`;
}

export function vaultNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name.";
  if (trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
    return "Names cannot be . , .. , or contain a path separator.";
  }
  return null;
}
