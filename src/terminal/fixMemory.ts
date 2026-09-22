import { useSyncExternalStore } from "react";
import { scanForSecrets } from "../ai/contextItems";
import { classifyFailure, type FailureKind } from "./failureStore";
import type { ComparisonRunInput } from "./runComparison";

export const FIX_MEMORY_KEY = "husk.remembered-fixes.v1";
export const MAX_REMEMBERED_FIXES = 30;
export const MAX_FIX_MEMORY_BYTES = 64 * 1024;
const MAX_STEPS = 6;
const MAX_PANES = 12;
const encoder = new TextEncoder();
const bytes = (value: string) => encoder.encode(value).byteLength;
const kinds = new Set<FailureKind>(["dependency", "permission", "test", "port", "git", "network", "unknown"]);
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type FixScope = Pick<ComparisonRunInput, "ptyId" | "cwd" | "remoteHost">;
type Failure = { command: string; excerpt: string; errorKey: string; kind: FailureKind; exitCode: number; at: number };
export type FixStep = { id: number; command: string; at: number; verification: boolean };
export type FixCandidate = FixScope & { id: number; failure: Failure; steps: FixStep[]; omitted: number };
export type RememberedFix = {
  id: string;
  title: string;
  summary: string;
  cwd: string;
  remoteHost: string | null;
  failedCommand: string;
  kind: FailureKind;
  errorKey: string;
  errorExcerpt: string;
  commands: string[];
  failureAt: number;
  resolvedAt: number;
  savedAt: number;
};
export type FixSnapshot = { candidate: FixCandidate | null; matches: RememberedFix[]; failure: Failure | null };
type Pane = { scope: FixScope; failure: Failure; steps: FixStep[]; omitted: number; candidate: FixCandidate | null; dismissed: boolean; snapshot: FixSnapshot };

function text(value: unknown, max: number, allowEmpty = false): value is string {
  return typeof value === "string" && (allowEmpty || Boolean(value.trim())) && bytes(value) <= max;
}
function command(value: unknown): value is string {
  return text(value, 2048) && !/[\x00-\x1f\x7f\u2028\u2029]/.test(value);
}
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
function sameScope(a: FixScope, b: FixScope): boolean { return a.ptyId === b.ptyId && a.cwd === b.cwd && a.remoteHost === b.remoteHost; }
function sensitive(value: unknown): boolean { return scanForSecrets("Remembered fix", JSON.stringify(value)).length > 0; }

/** Keep only a visibly bounded excerpt. No command output is written on capture. */
export function fixErrorExcerpt(output: string): string {
  const lines = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "").split("\n");
  const relevant = lines.filter((line) => /error|fail|fatal|denied|not found|no module|cannot find|refused|E[A-Z]{3,}/i.test(line));
  const selected: string[] = [];
  for (const line of (relevant.length ? relevant : lines).slice(0, 8)) {
    if (bytes([...selected, line].join("\n")) > 2048) break;
    selected.push(line);
  }
  return selected.join("\n").trim();
}

/** Matching is conservative: same command, host, directory, category and error
 * text (ignoring whitespace only). Store a fingerprint, not hidden output. */
function errorKey(excerpt: string): string {
  const normalized = excerpt.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  let first = 2166136261; let second = 5381;
  for (let index = 0; index < normalized.length; index++) {
    first = Math.imul(first ^ normalized.charCodeAt(index), 16777619);
    second = Math.imul(second, 33) ^ normalized.charCodeAt(index);
  }
  return `${normalized.length}:${(first >>> 0).toString(16)}:${(second >>> 0).toString(16)}`;
}

function validSaved(value: unknown): value is RememberedFix {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fix = value as RememberedFix;
  return text(fix.id, 120) && text(fix.title, 160) && text(fix.summary, 2048, true)
    && text(fix.cwd, 4096) && (fix.remoteHost === null || text(fix.remoteHost, 255))
    && command(fix.failedCommand) && kinds.has(fix.kind) && text(fix.errorKey, 100)
    && /^\d+:[a-f0-9]+:[a-f0-9]+$/.test(fix.errorKey) && text(fix.errorExcerpt, 2048, true)
    && Array.isArray(fix.commands) && fix.commands.length > 0 && fix.commands.length <= MAX_STEPS
    && fix.commands.every(command) && fix.commands[fix.commands.length - 1] === fix.failedCommand
    && timestamp(fix.failureAt) && timestamp(fix.resolvedAt) && timestamp(fix.savedAt)
    && fix.failureAt <= fix.resolvedAt && fix.resolvedAt <= fix.savedAt && !sensitive(fix);
}

/** Reject corrupt/oversized storage without exposing it or rewriting it. */
export function parseRememberedFixes(raw: string | null): RememberedFix[] {
  if (!raw || bytes(raw) > MAX_FIX_MEMORY_BYTES) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const payload = parsed as { version?: unknown; fixes?: unknown };
    if (payload.version !== 1 || !Array.isArray(payload.fixes) || payload.fixes.length > MAX_REMEMBERED_FIXES) return [];
    const seen = new Set<string>();
    return payload.fixes.filter(validSaved).filter((fix) => {
      if (seen.has(fix.id)) return false;
      seen.add(fix.id); return true;
    }).map((fix) => {
      // Never preserve unknown fields from a modified/older storage payload.
      const { id, title, summary, cwd, remoteHost, failedCommand, kind, errorKey, errorExcerpt, commands, failureAt, resolvedAt, savedAt } = fix;
      return { id, title, summary, cwd, remoteHost, failedCommand, kind, errorKey, errorExcerpt, commands: [...commands], failureAt, resolvedAt, savedAt };
    });
  } catch { return []; }
}

export class FixMemoryStore {
  private panes = new Map<number, Pane>();
  private listeners = new Set<() => void>();
  private fixes: RememberedFix[] | null = null;
  private sequence = 0;
  constructor(private storage: () => StoragePort | undefined, private now = () => Date.now()) {}

  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  getSnapshot = (leafId: number): FixSnapshot | null => this.panes.get(leafId)?.snapshot ?? null;
  getSaved = (): RememberedFix[] => {
    if (!this.fixes) {
      try { this.fixes = parseRememberedFixes(this.storage()?.getItem(FIX_MEMORY_KEY) ?? null); }
      catch { this.fixes = []; }
    }
    return this.fixes;
  };
  private emit(): void { for (const listener of this.listeners) listener(); }
  private refresh(pane: Pane): void {
    const matches = pane.candidate || pane.dismissed || !pane.failure.errorKey ? [] : this.getSaved().filter((fix) =>
      fix.cwd === pane.scope.cwd && fix.remoteHost === pane.scope.remoteHost && fix.failedCommand === pane.failure.command
      && fix.kind === pane.failure.kind && fix.errorKey === pane.failure.errorKey,
    ).slice(0, 3);
    pane.snapshot = { candidate: pane.dismissed ? null : pane.candidate, matches, failure: pane.failure };
  }
  clear(leafId: number): void { if (this.panes.delete(leafId)) this.emit(); }
  dismiss(leafId: number): void {
    const pane = this.panes.get(leafId); if (!pane) return;
    pane.dismissed = true; this.refresh(pane); this.emit();
  }

  record(input: ComparisonRunInput): void {
    if (!Number.isInteger(input.ptyId) || input.ptyId < 0 || !text(input.cwd, 4096)
      || (input.remoteHost !== null && !text(input.remoteHost, 255)) || !command(input.command)
      || !timestamp(input.at) || input.exitCode == null || !Number.isInteger(input.exitCode) || input.truncated) {
      this.clear(input.leafId); return;
    }
    const previous = this.panes.get(input.leafId);
    if (previous && !sameScope(previous.scope, input)) this.clear(input.leafId);
    let pane = this.panes.get(input.leafId);
    if (input.exitCode !== 0) {
      const excerpt = fixErrorExcerpt(input.output);
      // A different failure starts a different investigation. A failed retry
      // keeps only the newest error evidence, not an unbounded command log.
      const failure = { command: input.command, excerpt, errorKey: errorKey(excerpt), kind: classifyFailure(input.command, input.output), exitCode: input.exitCode, at: input.at };
      pane = { scope: { ptyId: input.ptyId, cwd: input.cwd, remoteHost: input.remoteHost }, failure, steps: [], omitted: 0, candidate: null, dismissed: false, snapshot: { candidate: null, matches: [], failure } };
      this.panes.delete(input.leafId); this.panes.set(input.leafId, pane);
      if (this.panes.size > MAX_PANES) this.panes.delete(this.panes.keys().next().value!);
    } else if (pane && !pane.candidate && !pane.dismissed) {
      if (input.at < pane.failure.at) { this.clear(input.leafId); return; }
      const verification = input.command === pane.failure.command;
      // Navigation and screen-clearing are not repair steps.
      if (!verification && /^(?:cd|pwd|ls|ll|clear|reset|exit)(?:\s|$)/.test(input.command.trim())) return;
      pane.steps.push({ id: ++this.sequence, command: input.command, at: input.at, verification });
      if (pane.steps.length > MAX_STEPS) { pane.steps.shift(); pane.omitted++; }
      if (verification && pane.failure.errorKey) {
        pane.candidate = { ...pane.scope, id: ++this.sequence, failure: pane.failure, steps: [...pane.steps], omitted: pane.omitted };
      }
    } else return;
    this.refresh(pane!); this.emit();
  }

  save(leafId: number, candidateId: number, input: { title: string; summary: string; stepIds: number[]; includeError: boolean; confirmed: boolean }): RememberedFix {
    const pane = this.panes.get(leafId);
    const candidate = pane?.candidate;
    if (!candidate || candidate.id !== candidateId || pane?.dismissed) throw new Error("This terminal context changed. Review the current fix before saving.");
    if (!input.confirmed) throw new Error("Confirm that these steps resolved the issue before saving.");
    if (!Array.isArray(input.stepIds) || input.stepIds.some((id) => !candidate.steps.some((step) => step.id === id))) throw new Error("Select steps from this captured fix.");
    const steps = candidate.steps.filter((step) => input.stepIds.includes(step.id));
    const verification = steps[steps.length - 1];
    if (!verification?.verification) throw new Error("Keep the successful verification command in this fix.");
    const savedAt = this.now();
    const fix: RememberedFix = {
      id: `fix-${savedAt}-${++this.sequence}`, title: input.title.trim(), summary: input.summary.trim(),
      cwd: candidate.cwd, remoteHost: candidate.remoteHost, failedCommand: candidate.failure.command,
      kind: candidate.failure.kind, errorKey: candidate.failure.errorKey,
      errorExcerpt: input.includeError ? candidate.failure.excerpt : "", commands: steps.map((step) => step.command),
      failureAt: candidate.failure.at, resolvedAt: verification.at, savedAt,
    };
    if (sensitive(fix)) throw new Error("Possible credentials detected. Remove sensitive notes or steps, or leave the error excerpt unchecked. Nothing was saved.");
    if (!validSaved(fix)) throw new Error("Use a title of up to 160 bytes and notes of up to 2 KB, with at least the successful verification command.");
    // Do not silently evict user-saved fixes when the bounded store is full.
    const fixes = [fix, ...this.getSaved()];
    if (fixes.length > MAX_REMEMBERED_FIXES || bytes(JSON.stringify({ version: 1, fixes })) > MAX_FIX_MEMORY_BYTES) throw new Error("Fix memory is full. Delete an old fix from Saved fixes before saving another.");
    this.persist(fixes);
    pane!.dismissed = true; this.refresh(pane!); this.emit(); return fix;
  }

  delete(id: string): void {
    const fixes = this.getSaved().filter((fix) => fix.id !== id);
    if (fixes.length === this.getSaved().length) return;
    this.persist(fixes);
    for (const pane of this.panes.values()) this.refresh(pane);
    this.emit();
  }
  private persist(fixes: RememberedFix[]): void {
    try {
      const storage = this.storage();
      if (!storage) throw new Error("unavailable");
      storage.setItem(FIX_MEMORY_KEY, JSON.stringify({ version: 1, fixes }));
    } catch { throw new Error("Local fix storage is unavailable or full. Your saved fixes were not changed."); }
    this.fixes = fixes;
  }
}

export const fixMemoryStore = new FixMemoryStore(() => typeof window === "undefined" ? undefined : window.localStorage);
export const recordCompletedFixRun = (input: ComparisonRunInput): void => fixMemoryStore.record(input);
export const clearFixRuns = (leafId: number): void => fixMemoryStore.clear(leafId);
export const useFixMemory = (leafId: number): FixSnapshot | null => useSyncExternalStore(fixMemoryStore.subscribe, () => fixMemoryStore.getSnapshot(leafId));
