import { useRef, type MouseEvent } from "react";
import { TerminalView } from "./Terminal";

/** A tab's terminals form a binary tree: leaves are terminals, splits divide
 *  the space row-wise (side by side) or column-wise (stacked). */
export type TerminalCheckpoint = {
  cwd?: string;
  command?: string;
  exitCode?: number | null;
  at?: number;
};

export type Pane =
  | { kind: "leaf"; id: number; initialCwd?: string; checkpoint?: TerminalCheckpoint; restored?: boolean }
  | { kind: "split"; id: number; dir: "row" | "col"; ratio: number; a: Pane; b: Pane };

let paneSeq = 1000;
const nextPaneId = () => (paneSeq += 1);

export function newLeaf(initialCwd?: string): Pane {
  return { kind: "leaf", id: nextPaneId(), initialCwd };
}

/** Update only one pane's persisted launch directory. OSC 7 gives us this
 * after every shell `cd`, so session restore opens fresh shells where work was
 * actually left rather than where a tab happened to begin. */
export function setLeafCwd(node: Pane, leafId: number, cwd: string): Pane {
  if (node.kind === "leaf") {
    return node.id === leafId && node.initialCwd !== cwd ? { ...node, initialCwd: cwd } : node;
  }
  const a = setLeafCwd(node.a, leafId, cwd);
  const b = setLeafCwd(node.b, leafId, cwd);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

/** Save a tiny restart checkpoint, never terminal output. A new terminal is
 * still a new process; this is enough context to orient the user honestly. */
export function setLeafCheckpoint(node: Pane, leafId: number, checkpoint: TerminalCheckpoint): Pane {
  if (node.kind === "leaf") {
    return node.id === leafId ? { ...node, checkpoint: { ...node.checkpoint, ...checkpoint } } : node;
  }
  const a = setLeafCheckpoint(node.a, leafId, checkpoint);
  const b = setLeafCheckpoint(node.b, leafId, checkpoint);
  return a === node.a && b === node.b ? node : { ...node, a, b };
}

function checkpointFromUnknown(value: unknown): TerminalCheckpoint | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const checkpoint: TerminalCheckpoint = {};
  if (typeof raw.cwd === "string") checkpoint.cwd = raw.cwd;
  if (typeof raw.command === "string") checkpoint.command = raw.command.slice(0, 240);
  if (typeof raw.exitCode === "number" || raw.exitCode === null) checkpoint.exitCode = raw.exitCode;
  if (typeof raw.at === "number" && Number.isFinite(raw.at)) checkpoint.at = raw.at;
  return Object.keys(checkpoint).length ? checkpoint : undefined;
}

/**
 * Rehydrate a saved pane tree defensively. The persisted object is user-owned
 * local data, so a corrupt or old shape must fail back to a fresh leaf rather
 * than duplicate IDs or crash the terminal layout.
 */
export function hydratePane(value: unknown, seen = new Set<number>(), depth = 0): Pane | null {
  if (!value || typeof value !== "object" || depth > 32) return null;
  const raw = value as Record<string, unknown>;
  const id = raw.id;
  if (typeof id !== "number" || !Number.isSafeInteger(id) || id < 1 || seen.has(id)) return null;
  if (raw.kind === "leaf") {
    seen.add(id);
    paneSeq = Math.max(paneSeq, id);
    return {
      kind: "leaf",
      id,
      initialCwd: typeof raw.initialCwd === "string" ? raw.initialCwd : undefined,
      checkpoint: checkpointFromUnknown(raw.checkpoint),
      restored: true,
    };
  }
  if (raw.kind !== "split" || (raw.dir !== "row" && raw.dir !== "col")) return null;
  seen.add(id);
  const a = hydratePane(raw.a, seen, depth + 1);
  const b = hydratePane(raw.b, seen, depth + 1);
  if (!a || !b) return null;
  paneSeq = Math.max(paneSeq, id);
  const ratio = typeof raw.ratio === "number" && Number.isFinite(raw.ratio) ? raw.ratio : 0.5;
  return { kind: "split", id, dir: raw.dir, ratio: Math.min(0.85, Math.max(0.15, ratio)), a, b };
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
  onOpenLogs: (leafId: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
  onCommandComplete?: (leafId: number, run: { command: string; cwd: string; exitCode: number | null; at: number }) => void;
  onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void;
  onRatio: (splitId: number, ratio: number) => void;
};

export function PaneView({ node, ...ops }: { node: Pane } & Ops) {
  if (node.kind === "leaf") {
    const focused = ops.tabActive && ops.focusedId === node.id;
    return (
      <div key={`leaf-${node.id}`} className={`pane-leaf${focused && ops.multi ? " focused" : ""}`}>
        {ops.multi ? (
          <button
            type="button"
            className="pane-close"
            aria-label="Close pane"
            onClick={() => ops.onClose(node.id)}
          >
            ×
          </button>
        ) : null}
        <TerminalView
          leafId={node.id}
          active={focused}
          initialCwd={node.initialCwd}
          checkpoint={node.checkpoint}
          restored={node.restored}
          canClose={ops.multi}
          onSplit={(dir) => ops.onSplit(node.id, dir)}
          onClose={() => ops.onClose(node.id)}
          onFocus={() => ops.onFocus(node.id)}
          onOpenLogs={ops.onOpenLogs}
          onCwd={(cwd) => ops.onCwd?.(node.id, cwd)}
          onCommandComplete={(run) => ops.onCommandComplete?.(node.id, run)}
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
