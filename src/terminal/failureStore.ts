import { useSyncExternalStore } from "react";

import { scanForSecrets } from "../ai/contextItems";

/**
 * Per-pane command failure state.
 *
 * The terminal registry records a failure when a command boundary (OSC 133 D)
 * arrives with a non-zero exit code. Each terminal leaf owns its record, so
 * the strip under a pane always describes the command that failed in THAT
 * pane — never a global banner, never a modal.
 *
 * Lifecycle: record on failure → collapse to a tiny indicator when the user
 * starts typing again → clear when a new command starts or the pane closes.
 */

export type FailureKind =
  | "dependency"
  | "permission"
  | "test"
  | "port"
  | "git"
  | "network"
  | "unknown";

export type FailureRecord = {
  leafId: number;
  command: string;
  output: string;
  exitCode: number;
  cwd: string;
  at: number;
  kind: FailureKind;
  /** Output matched the secret scanner — warn before sending it to AI. */
  sensitive: boolean;
};

type FailureEntry = { record: FailureRecord; collapsed: boolean };

const failures = new Map<number, FailureEntry>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

/* ── Local classification ──────────────────────────────────────────────────
   Order matters: specific signatures before generic ones. This runs entirely
   locally — nothing is sent anywhere to produce the label. */

export function classifyFailure(command: string, output: string): FailureKind {
  const out = output || "";
  if (/EADDRINUSE|address already in use|port \d+ .* (?:in use|occupied)/i.test(out)) return "port";
  if (/EACCES|permission denied|Operation not permitted/i.test(out)) return "permission";
  if (/ENOTFOUND|EAI_AGAIN|Could not resolve host|ETIMEDOUT|ECONNREFUSED|Network is unreachable|Failed to fetch/i.test(out)) return "network";
  if (/command not found|Cannot find module|ModuleNotFoundError|No module named|is not recognized as an internal|no such file or directory.*(?:bin|node_modules)/i.test(out)) return "dependency";
  if (/^\s*fatal:/m.test(out) || /\b(?:merge|rebase|cherry-pick)\b.*\bconflict/i.test(out)) return "git";
  if (/\b(?:[1-9]\d* failing|FAIL\b|AssertionError|tests? failed|\b✕\b)/.test(out)) return "test";
  /* A test runner that prints nothing recognizable still identifies itself by
     the command line. */
  if (/\b(?:jest|vitest|mocha|pytest|cargo test|go test|pnpm test|npm test|bun test)\b/.test(command)) return "test";
  return "unknown";
}

export const FAILURE_KIND_LABEL: Record<FailureKind, string> = {
  dependency: "dependency missing?",
  permission: "permission denied",
  test: "test failure",
  port: "port already in use",
  git: "git failure",
  network: "network / DNS",
  unknown: "",
};

/* ── Store ───────────────────────────────────────────────────────────────── */

export function recordFailure(
  leafId: number,
  fields: { command: string; output: string; exitCode: number; cwd: string },
): void {
  const { command, output, exitCode, cwd } = fields;
  if (exitCode === 0) return;
  failures.set(leafId, {
    record: {
      leafId,
      command,
      output,
      exitCode,
      cwd,
      at: Date.now(),
      kind: classifyFailure(command, output),
      sensitive: scanForSecrets(command, output).length > 0,
    },
    collapsed: false,
  });
  emit();
}

/** A new command starting (or succeeding) retires the previous failure. */
export function clearFailure(leafId: number): void {
  if (failures.delete(leafId)) emit();
}

/** Typing at the prompt again collapses the strip to a tiny indicator. */
export function collapseFailure(leafId: number): void {
  const entry = failures.get(leafId);
  if (!entry || entry.collapsed) return;
  failures.set(leafId, { ...entry, collapsed: true });
  emit();
}

export function expandFailure(leafId: number): void {
  const entry = failures.get(leafId);
  if (!entry || !entry.collapsed) return;
  failures.set(leafId, { ...entry, collapsed: false });
  emit();
}

export function getFailure(leafId: number): FailureEntry | null {
  return failures.get(leafId) ?? null;
}

export function subscribeFailures(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useFailure(leafId: number | null): FailureEntry | null {
  return useSyncExternalStore(subscribeFailures, () =>
    leafId == null ? null : getFailure(leafId),
  );
}
