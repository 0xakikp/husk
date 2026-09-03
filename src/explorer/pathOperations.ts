export type ExplorerPathItem = {
  path: string;
  name: string;
  isDir: boolean;
};

export type ExplorerTransferOperation = "copy" | "move";

export function normalizeExplorerPath(path: string): string {
  const normalized = path.replace(/\/+$/, "");
  return normalized || "/";
}

export function joinExplorerPath(parent: string, name: string): string {
  const normalizedParent = normalizeExplorerPath(parent);
  return normalizedParent === "/" ? `/${name}` : `${normalizedParent}/${name}`;
}

export function parentExplorerPath(path: string): string {
  const normalized = normalizeExplorerPath(path);
  if (normalized === "/") return "/";
  const separator = normalized.lastIndexOf("/");
  return separator <= 0 ? "/" : normalized.slice(0, separator);
}

export function isExplorerPathWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizeExplorerPath(path);
  const normalizedParent = normalizeExplorerPath(parent);
  if (normalizedParent === "/") return normalizedPath.startsWith("/");
  return normalizedPath === normalizedParent || normalizedPath.startsWith(`${normalizedParent}/`);
}

export function replaceExplorerPath(path: string, from: string, to: string): string {
  if (!isExplorerPathWithin(path, from)) return path;
  const normalizedPath = normalizeExplorerPath(path);
  const normalizedFrom = normalizeExplorerPath(from);
  const normalizedTo = normalizeExplorerPath(to);
  return `${normalizedTo}${normalizedPath.slice(normalizedFrom.length)}`;
}

export function explorerTransferError(
  source: ExplorerPathItem,
  destinationDirectory: string,
  root: string,
): string | null {
  const destination = joinExplorerPath(destinationDirectory, source.name);
  if (!isExplorerPathWithin(destinationDirectory, root)) {
    return "Choose a folder inside this Files workspace.";
  }
  if (destination === normalizeExplorerPath(source.path)) {
    return "This item is already in that folder.";
  }
  if (source.isDir && isExplorerPathWithin(destinationDirectory, source.path)) {
    return "A folder cannot be placed inside itself.";
  }
  return null;
}
