import { useRef, type MouseEvent } from "react";
import { TerminalView } from "./Terminal";

/** A tab's terminals form a binary tree: leaves are terminals, splits divide
 *  the space row-wise (side by side) or column-wise (stacked). */
export type Pane =
  | { kind: "leaf"; id: number; initialCwd?: string }
  | { kind: "split"; id: number; dir: "row" | "col"; ratio: number; a: Pane; b: Pane };

let paneSeq = 1000;
const nextPaneId = () => (paneSeq += 1);

export function newLeaf(initialCwd?: string): Pane {
  return { kind: "leaf", id: nextPaneId(), initialCwd };
}

/** Replace leaf `leafId` with a split of [that leaf, a fresh leaf]. */
export function splitPane(node: Pane, leafId: number, dir: "row" | "col", makeLeaf: () => Pane): Pane {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    return { kind: "split", id: nextPaneId(), dir, ratio: 0.5, a: node, b: makeLeaf() };
  }
  return {
    ...node,
    a: splitPane(node.a, leafId, dir, makeLeaf),
    b: splitPane(node.b, leafId, dir, makeLeaf),
  };
}

/** Remove leaf `leafId`; the parent split collapses to its sibling. Returns the
 *  new tree, or null when the whole tab was that single leaf. */
export function removePane(node: Pane, leafId: number): Pane | null {
  if (node.kind === "leaf") return node.id === leafId ? null : node;
  const a = removePane(node.a, leafId);
  const b = removePane(node.b, leafId);
  if (a === null) return b;
  if (b === null) return a;
  return { ...node, a, b };
}

export function setRatio(node: Pane, splitId: number, ratio: number): Pane {
  if (node.kind === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, a: setRatio(node.a, splitId, ratio), b: setRatio(node.b, splitId, ratio) };
}

export function firstLeaf(node: Pane): number {
  return node.kind === "leaf" ? node.id : firstLeaf(node.a);
}

export function leafCount(node: Pane): number {
  return node.kind === "leaf" ? 1 : leafCount(node.a) + leafCount(node.b);
}

type Ops = {
  tabActive: boolean;
  focusedId: number;
  multi: boolean;
  onSplit: (leafId: number, dir: "row" | "col") => void;
  onClose: (leafId: number) => void;
  onFocus: (leafId: number) => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
  onRatio: (splitId: number, ratio: number) => void;
};

export function PaneView({ node, ...ops }: { node: Pane } & Ops) {
  if (node.kind === "leaf") {
    const focused = ops.tabActive && ops.focusedId === node.id;
    return (
      <div key={`leaf-${node.id}`} className={`pane-leaf${focused && ops.multi ? " focused" : ""}`}>
        <TerminalView
          leafId={node.id}
          active={focused}
          initialCwd={node.initialCwd}
          canClose={ops.multi}
          onSplit={(dir) => ops.onSplit(node.id, dir)}
          onClose={() => ops.onClose(node.id)}
          onFocus={() => ops.onFocus(node.id)}
          onFocusDirection={ops.onFocusDirection}
        />
      </div>
    );
  }
  return <SplitView key={`split-${node.id}`} node={node} ops={ops} />;
}

function SplitView({
  node,
  ops,
}: {
  node: Extract<Pane, { kind: "split" }>;
  ops: Ops;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const startDrag = (e: MouseEvent) => {
    e.preventDefault();
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const onMove = (ev: globalThis.MouseEvent) => {
      const r =
        node.dir === "row"
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
      ops.onRatio(node.id, Math.min(0.85, Math.max(0.15, r)));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div ref={ref} className={`pane-split ${node.dir}`}>
      <div className="pane-slot" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <PaneView node={node.a} {...ops} />
      </div>
      <div className={`pane-divider ${node.dir}`} onMouseDown={startDrag} />
      <div className="pane-slot" style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <PaneView node={node.b} {...ops} />
      </div>
    </div>
  );
}
