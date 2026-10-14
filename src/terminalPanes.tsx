import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { TerminalView } from "./Terminal";
import { resolveTerminalLaunchCwd } from "./terminal/launchOptions";
import { TerminalPaneHeader } from "./terminal/TerminalPaneHeader";

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
  return { kind: "leaf", id: nextPaneId(), initialCwd: resolveTerminalLaunchCwd(initialCwd) };
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
      initialCwd: resolveTerminalLaunchCwd(raw.initialCwd),
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

export function PaneView({ node, paneNumber = 1, ...ops }: { node: Pane; paneNumber?: number } & Ops) {
  if (node.kind === "leaf") {
    const focused = ops.tabActive && ops.focusedId === node.id;
    return (
      <div key={`leaf-${node.id}`} className={`pane-leaf${ops.multi ? " pane-framed" : ""}${focused && ops.multi ? " focused" : ""}`}>
        {ops.multi ? (
          <TerminalPaneHeader leafId={node.id} label={`Terminal ${paneNumber}`} active={focused}
            onFocus={() => ops.onFocus(node.id)} onClose={() => ops.onClose(node.id)} />
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
  return <SplitView key={`split-${node.id}`} node={node} paneNumber={paneNumber} ops={ops} />;
}

const SPLIT_GUTTER = 6;
const clampRatio = (ratio: number) => Math.min(0.85, Math.max(0.15, ratio));

function SplitView({
  node,
  paneNumber,
  ops,
}: {
  node: Extract<Pane, { kind: "split" }>;
  paneNumber: number;
  ops: Ops;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onRatioRef = useRef(ops.onRatio);
  onRatioRef.current = ops.onRatio;
  const dragRef = useRef<{
    pointerId: number; target: HTMLDivElement; start: number; ratio: number; size: number;
    cursor: string; userSelect: string;
  } | null>(null);

  const finishDrag = () => {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    delete drag.target.dataset.dragging;
    document.body.style.cursor = drag.cursor;
    document.body.style.userSelect = drag.userSelect;
    if (drag.target.hasPointerCapture?.(drag.pointerId)) drag.target.releasePointerCapture?.(drag.pointerId);
  };

  useEffect(() => {
    const move = (event: globalThis.PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const position = node.dir === "row" ? event.clientX : event.clientY;
      onRatioRef.current(node.id, clampRatio(drag.ratio + (position - drag.start) / drag.size));
    };
    const end = (event: globalThis.PointerEvent) => {
      if (dragRef.current?.pointerId === event.pointerId) finishDrag();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", finishDrag);
    window.addEventListener("resize", finishDrag);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", finishDrag);
      window.removeEventListener("resize", finishDrag);
      finishDrag();
    };
  }, [node.id, node.dir]);

  useEffect(() => {
    if (!ops.tabActive) finishDrag();
  }, [ops.tabActive]);

  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.isPrimary === false || dragRef.current) return;
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const size = (node.dir === "row" ? rect.width : rect.height) - SPLIT_GUTTER;
    if (size <= 0) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId, target: event.currentTarget,
      start: node.dir === "row" ? event.clientX : event.clientY, ratio: node.ratio, size,
      cursor: document.body.style.cursor, userSelect: document.body.style.userSelect,
    };
    event.currentTarget.dataset.dragging = "true";
    document.body.style.cursor = node.dir === "row" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const resizeWithKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const step = event.shiftKey ? 0.1 : 0.02;
    const decrement = node.dir === "row" ? "ArrowLeft" : "ArrowUp";
    const increment = node.dir === "row" ? "ArrowRight" : "ArrowDown";
    const ratio = event.key === decrement ? node.ratio - step : event.key === increment ? node.ratio + step
      : event.key === "Home" ? 0.15 : event.key === "End" ? 0.85 : event.key === "Enter" ? 0.5 : null;
    if (ratio === null) return;
    event.preventDefault();
    event.stopPropagation();
    finishDrag();
    ops.onRatio(node.id, clampRatio(ratio));
  };

  return (
    <div ref={ref} className={`pane-split ${node.dir}`}>
      <div id={`terminal-split-${node.id}-first`} className="pane-slot" style={{ flexGrow: node.ratio, flexBasis: 0 }}>
        <PaneView node={node.a} paneNumber={paneNumber} {...ops} />
      </div>
      <div className={`pane-divider ${node.dir} husk-resize-seam husk-resize-seam-${node.dir === "row" ? "vertical" : "horizontal"}`}
        role="separator" tabIndex={ops.tabActive ? 0 : -1}
        aria-label={node.dir === "row" ? "Resize terminals left/right" : "Resize terminals up/down"}
        aria-orientation={node.dir === "row" ? "vertical" : "horizontal"}
        aria-controls={`terminal-split-${node.id}-first`}
        aria-valuemin={15} aria-valuemax={85} aria-valuenow={Math.round(node.ratio * 100)}
        title={`Drag or use ${node.dir === "row" ? "Left / Right" : "Up / Down"} arrows to resize · Double-click to balance`}
        onPointerDown={startDrag} onLostPointerCapture={finishDrag} onKeyDown={resizeWithKey}
        onDoubleClick={() => { finishDrag(); ops.onRatio(node.id, 0.5); }} />
      <div className="pane-slot" style={{ flexGrow: 1 - node.ratio, flexBasis: 0 }}>
        <PaneView node={node.b} paneNumber={paneNumber + leafCount(node.a)} {...ops} />
      </div>
    </div>
  );
}
