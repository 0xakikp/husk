import { useSyncExternalStore } from "react";
import { scanForSecrets } from "../ai/contextItems";

export const MAX_COMPARISON_BYTES = 12 * 1024;
export const MAX_COMPARISON_LINES = 200;
const MAX_PANES = 12;
const MAX_RUNS_PER_PANE = 8;

export type ComparisonRunInput = {
  leafId: number;
  ptyId: number;
  cwd: string;
  /** null denotes a local shell; an unknown SSH target must not be recorded. */
  remoteHost: string | null;
  command: string;
  output: string;
  exitCode: number | null;
  at: number;
  truncated?: boolean;
};

export type ComparisonRun = ComparisonRunInput & {
  id: number;
  truncated: boolean;
  sensitive: boolean;
};
export type RunComparison = { before: ComparisonRun; after: ComparisonRun };
type PaneRuns = { runs: ComparisonRun[]; comparison: RunComparison | null };
const panes = new Map<number, PaneRuns>();
const listeners = new Set<() => void>();
let sequence = 0;

function emit(): void { for (const listener of listeners) listener(); }

/** Dedicated provenance survives the registry's active-shell UI flag resetting
 * on OSC 133 D. Unknown or same-host SSH provenance fails closed. */
export class ComparisonScopeTracker {
  private localHost: string | null = null;
  private cwdHost: string | null = null;
  private remoteEntered = false;
  private remoteConfirmed = false;
  private cwdUri: string | null = null;
  private generation = 0;

  observeCwd(uri: string, isRemote: boolean): boolean {
    if (this.cwdUri !== uri) this.generation++;
    this.cwdUri = uri;
    const host = /^file:\/\/([^/]+)\//.exec(uri)?.[1] ?? null;
    const changed = host !== this.cwdHost;
    this.cwdHost = host;
    if (!this.localHost && !isRemote && !this.remoteEntered) this.localHost = host;
    if (this.remoteEntered && this.localHost && host) {
      if (host !== this.localHost) this.remoteConfirmed = true;
      else if (this.remoteConfirmed) { this.remoteEntered = false; this.remoteConfirmed = false; }
    }
    return changed;
  }

  enterRemote(): void { this.generation++; this.remoteEntered = true; this.remoteConfirmed = false; }
  leaveRemote(): void { this.generation++; this.remoteEntered = false; this.remoteConfirmed = false; }
  getGeneration(): number { return this.generation; }

  /** undefined means there is not enough provenance to capture this run. */
  target(isRemote: boolean): string | null | undefined {
    if (!this.localHost || !this.cwdHost) return undefined;
    if (this.remoteEntered) return this.remoteConfirmed ? this.cwdHost : undefined;
    return !isRemote && this.cwdHost === this.localHost ? null : undefined;
  }
}

type OutputBuffer = {
  baseY: number;
  cursorY: number;
  cursorX: number;
  getLine(index: number): { isWrapped?: boolean; translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string } | undefined;
};

/** Use a tracked marker, not an absolute row that becomes stale on scrollback trim. */
export function captureComparisonOutput(buffer: OutputBuffer, startLine: number | null): { output: string; truncated: boolean } {
  const cursorRow = buffer.baseY + buffer.cursorY;
  const end = cursorRow + (buffer.cursorX > 0 ? 1 : 0);
  const start = Math.max(startLine ?? 0, end - MAX_COMPARISON_LINES);
  const lines: string[] = [];
  let truncated = startLine == null || start > startLine;
  let characters = 0;
  for (let row = start; row < end; row++) {
    const line = buffer.getLine(row);
    if (!line) { truncated = true; continue; }
    const text = line.translateToString(true, 0, row === cursorRow ? buffer.cursorX : undefined);
    // Even an unexpectedly wide terminal cannot allocate an unbounded sample.
    if (characters + text.length > MAX_COMPARISON_BYTES) { truncated = true; break; }
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
    characters += text.length;
  }
  const bounded = boundComparisonOutput(lines.join("\n"));
  return { output: bounded.output, truncated: truncated || bounded.truncated };
}

/** Retain a whole-line prefix with a strict UTF-8 budget. No hidden tail is sent. */
export function boundComparisonOutput(output: string): { output: string; truncated: boolean } {
  const encoder = new TextEncoder();
  const lines = output ? output.split("\n") : [];
  const retained: string[] = [];
  let bytes = 0;
  for (const line of lines) {
    const size = encoder.encode(line).byteLength + (retained.length ? 1 : 0);
    if (retained.length >= MAX_COMPARISON_LINES || bytes + size > MAX_COMPARISON_BYTES) {
      return { output: retained.join("\n"), truncated: true };
    }
    retained.push(line);
    bytes += size;
  }
  return { output: retained.join("\n"), truncated: false };
}

function sameTarget(a: ComparisonRunInput, b: ComparisonRunInput): boolean {
  return a.leafId === b.leafId && a.ptyId === b.ptyId && a.cwd === b.cwd
    && a.remoteHost === b.remoteHost && a.command === b.command;
}

/** Ephemeral only: never persist output or contact a model on command completion. */
export function recordComparisonRun(input: ComparisonRunInput): void {
  if (!Number.isInteger(input.ptyId) || input.ptyId < 0 || !input.cwd || !input.command.trim()
    || input.command.length > 2048 || input.cwd.length > 4096 || input.remoteHost === ""
    || /^(?:cd|clear|reset|exit)(?:\s|$)/.test(input.command.trim())) return;
  const bounded = boundComparisonOutput(input.output);
  const run: ComparisonRun = {
    ...input,
    ...bounded,
    id: ++sequence,
    truncated: Boolean(input.truncated || bounded.truncated),
    sensitive: scanForSecrets("Run comparison", [input.command, input.output, input.cwd, input.remoteHost ?? ""].join("\n")).length > 0,
  };
  const previous = panes.get(input.leafId)?.runs ?? [];
  const before = previous.find((candidate) => sameTarget(candidate, run));
  // Refresh insertion order so the global pane cap evicts the least-recently used.
  panes.delete(input.leafId);
  panes.set(input.leafId, {
    runs: [run, ...previous].slice(0, MAX_RUNS_PER_PANE),
    comparison: before ? { before, after: run } : null,
  });
  if (panes.size > MAX_PANES) panes.delete(panes.keys().next().value!);
  emit();
}

export function clearRunComparisons(leafId: number): void {
  if (panes.delete(leafId)) emit();
}

export function dismissRunComparison(leafId: number): void {
  const pane = panes.get(leafId);
  if (!pane?.comparison) return;
  panes.set(leafId, { ...pane, comparison: null });
  emit();
}

export function getRunComparison(leafId: number): RunComparison | null {
  return panes.get(leafId)?.comparison ?? null;
}

export function subscribeRunComparisons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRunComparison(leafId: number): RunComparison | null {
  return useSyncExternalStore(subscribeRunComparisons, () => getRunComparison(leafId));
}

export type ComparisonLine = {
  id: string;
  kind: "added" | "removed" | "unchanged" | "status";
  text: string;
  beforeLine?: number;
  afterLine?: number;
};
export type ComparisonDiff = { lines: ComparisonLine[]; added: number; removed: number; exitChanged: boolean };

/** Exact line comparison, bounded above by 200×200 cells; no model-generated diff. */
export function diffCommandRuns(pair: RunComparison): ComparisonDiff {
  const before = pair.before.output ? pair.before.output.split("\n") : [];
  const after = pair.after.output ? pair.after.output.split("\n") : [];
  const width = after.length + 1;
  const cells = new Uint16Array((before.length + 1) * width);
  for (let a = before.length - 1; a >= 0; a--) {
    for (let b = after.length - 1; b >= 0; b--) {
      cells[a * width + b] = before[a] === after[b]
        ? 1 + cells[(a + 1) * width + b + 1]
        : Math.max(cells[(a + 1) * width + b], cells[a * width + b + 1]);
    }
  }
  const lines: ComparisonLine[] = [];
  let a = 0; let b = 0; let added = 0; let removed = 0;
  while (a < before.length || b < after.length) {
    if (a < before.length && b < after.length && before[a] === after[b]) {
      lines.push({ id: `same-${a + 1}-${b + 1}`, kind: "unchanged", text: before[a], beforeLine: ++a, afterLine: ++b });
    } else if (b < after.length && (a >= before.length || cells[a * width + b + 1] > cells[(a + 1) * width + b])) {
      lines.push({ id: `after-${b + 1}`, kind: "added", text: after[b], afterLine: ++b }); added++;
    } else {
      lines.push({ id: `before-${a + 1}`, kind: "removed", text: before[a], beforeLine: ++a }); removed++;
    }
  }
  const exitChanged = pair.before.exitCode !== pair.after.exitCode;
  lines.push({
    id: "exit", kind: "status",
    text: `Exit code: ${pair.before.exitCode ?? "unknown"} → ${pair.after.exitCode ?? "unknown"}`,
  });
  return { lines, added, removed, exitChanged };
}

export type ComparisonClaim = { text: string; evidence: string[] };

/** No unsupported free-form summaries: every displayed claim links to real lines. */
export function parseComparisonClaims(raw: string, evidence: ComparisonLine[]): ComparisonClaim[] {
  const decoded: unknown = JSON.parse(raw.trim());
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("AI returned an invalid comparison. The local diff is still available.");
  const claims = (decoded as { claims?: unknown }).claims;
  if (!Array.isArray(claims) || claims.length < 1 || claims.length > 4) throw new Error("AI returned an invalid comparison. The local diff is still available.");
  const ids = new Set(evidence.map((line) => line.id));
  return claims.map((claim: unknown) => {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) throw new Error("AI returned an unsupported claim.");
    const item = claim as { text?: unknown; evidence?: unknown };
    if (typeof item.text !== "string" || !item.text.trim() || item.text.length > 500
      || !Array.isArray(item.evidence) || !item.evidence.length || item.evidence.length > 6
      || item.evidence.some((id: unknown) => typeof id !== "string" || !ids.has(id))) {
      throw new Error("AI returned an unsupported claim. Inspect the local diff below.");
    }
    return { text: item.text.trim(), evidence: [...new Set(item.evidence as string[])] };
  });
}

/** A smaller evidence payload leaves room for JSON escaping under the shared gate. */
export function comparisonEvidence(diff: ComparisonDiff): ComparisonLine[] {
  const changed = diff.lines.filter((line) => line.kind !== "unchanged");
  const selected: ComparisonLine[] = [changed.find((line) => line.id === "exit")!];
  let bytes = new TextEncoder().encode(JSON.stringify(selected)).byteLength;
  for (const line of changed) {
    if (line.id === "exit") continue;
    const size = new TextEncoder().encode(JSON.stringify(line)).byteLength + 1;
    if (bytes + size > 12 * 1024) continue;
    bytes += size;
    selected.push(line);
  }
  return selected;
}
