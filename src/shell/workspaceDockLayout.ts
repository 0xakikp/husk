import type { Pane } from "../terminalPanes";

export const WORKSPACE_DOCK_HEIGHT_KEY = "husk.workspaceDock.height";
export const WORKSPACE_DOCK_HEADER_HEIGHT = 32;
export const WORKSPACE_DOCK_MIN_HEIGHT = 160;
export const TERMINAL_LEAF_MIN_HEIGHT = 140;
export const TERMINAL_SPLIT_SEAM_HEIGHT = 2;

/** A row shares height; a column allocates its usable height by split ratio.
 * Counting leaves alone misses the short side of an unequal vertical split. */
export function terminalMinimumHeight(root: Pane): number {
  if (root.kind === "leaf") return TERMINAL_LEAF_MIN_HEIGHT;
  const a = terminalMinimumHeight(root.a);
  const b = terminalMinimumHeight(root.b);
  if (root.dir === "row") return Math.max(a, b);
  const ratio = Number.isFinite(root.ratio) && root.ratio > 0 && root.ratio < 1 ? root.ratio : 0.5;
  return Math.ceil(Math.max(a / ratio, b / (1 - ratio)) + TERMINAL_SPLIT_SEAM_HEIGHT);
}

export function parseWorkspaceDockHeight(value: string | null): number | null {
  if (value === null || !value.trim()) return null;
  const height = Number(value);
  return Number.isFinite(height) && height >= WORKSPACE_DOCK_MIN_HEIGHT ? Math.round(height) : null;
}

export type WorkspaceDockGeometry = {
  cramped: boolean;
  minHeight: number;
  maxHeight: number;
  height: number;
  terminalMinHeight: number;
};

/** availableHeight is the measured terminal-only column content box, less its
 * gap. Both dock chrome and terminal border are included in this budget. */
export function workspaceDockGeometry(
  availableHeight: number,
  terminalRoot: Pane,
  preferredHeight: number | null = null,
): WorkspaceDockGeometry {
  const available = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const terminalMinHeight = terminalMinimumHeight(terminalRoot) + 2;
  const maxHeight = Math.max(0, Math.floor(available - terminalMinHeight));
  const cramped = maxHeight < WORKSPACE_DOCK_MIN_HEIGHT;
  const requested = preferredHeight !== null && Number.isFinite(preferredHeight) && preferredHeight > 0
    ? preferredHeight
    : Math.min(260, available * 0.28);
  return {
    cramped,
    minHeight: WORKSPACE_DOCK_MIN_HEIGHT,
    maxHeight,
    height: cramped ? WORKSPACE_DOCK_HEADER_HEIGHT : clampWorkspaceDockHeight(requested, maxHeight),
    terminalMinHeight,
  };
}

export function clampWorkspaceDockHeight(height: number, maxHeight: number): number {
  return Math.min(maxHeight, Math.max(WORKSPACE_DOCK_MIN_HEIGHT, Math.round(height)));
}
