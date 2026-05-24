import {
  resolveMaterialFileIcon,
  resolveMaterialFolderIcon,
} from "material-icon-resolver";

const ICON_BASE = "/icons";

export function fileIconUrl(name: string): string {
  const result = resolveMaterialFileIcon(name);
  if (!result) return `${ICON_BASE}/file.svg`;
  return `${ICON_BASE}/${result.filename}`;
}

export function folderIconUrl(name: string, expanded: boolean): string {
  const result = resolveMaterialFolderIcon(name);
  if (!result) return `${ICON_BASE}/${expanded ? "folder-open" : "folder"}.svg`;
  const iconName = expanded ? `${result.name}-open` : result.name;
  return `${ICON_BASE}/${iconName}.svg`;
}
