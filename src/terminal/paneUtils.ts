import type { Pane } from "../terminalPanes";

/** Collect all leaf IDs in a pane tree. */
export function leafIds(node: Pane): number[] {
  if (node.kind === "leaf") return [node.id];
  return [...leafIds(node.a), ...leafIds(node.b)];
}

/** Collect all leaf IDs that exist in `oldTree` but not in `newTree`. */
export function removedLeafIds(oldTree: Pane, newTree: Pane | null): number[] {
  const oldIds = new Set(leafIds(oldTree));
  const newIds = newTree ? new Set(leafIds(newTree)) : new Set<number>();
  const removed: number[] = [];
  for (const id of oldIds) {
    if (!newIds.has(id)) removed.push(id);
  }
  return removed;
}
