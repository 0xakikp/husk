import { invoke } from "@tauri-apps/api/core";

import { getWorkspaceRoot } from "../workspace/store";

/**
 * Workspace timeline — local, summary-only event log backed by
 * ~/.husk/state.sqlite (Rust side). Records what happened in a project so
 * returning to it does not mean reading a week of scrollback.
 *
 * Privacy contract:
 * - summaries and metadata, never full terminal output or file contents;
 * - a workspace can opt out entirely ("do not record this workspace");
 * - retention is enforced in Rust on every write (90 days).
 */

export type TimelineEventType = "command" | "command_failed" | "ai" | "git" | "file";

export type TimelineEvent = {
  id: number;
  ts: number;
  workspace_id: string;
  event_type: string;
  summary: string;
  metadata_json: string;
  sensitivity: number;
};

const DISABLED_KEY = "husk.timeline.disabledWorkspaces";

function disabledWorkspaces(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(DISABLED_KEY) || "[]") as string[]);
  } catch {
    return new Set();
  }
}

export function isTimelineRecordingEnabled(root = getWorkspaceRoot()): boolean {
  if (!root) return false;
  return !disabledWorkspaces().has(root);
}

export function setTimelineRecordingEnabled(enabled: boolean, root = getWorkspaceRoot()): void {
  if (!root) return;
  const set = disabledWorkspaces();
  if (enabled) set.delete(root);
  else set.add(root);
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...set]));
  } catch {
    // storage unavailable — recording preference stays in memory only
  }
  emit();
}

/* ── Recording ─────────────────────────────────────────────────────────────
   Fire-and-forget: the timeline must never slow down or break the thing it
   is logging. A failed insert is a console note, not an error dialog. */

export function recordTimelineEvent(
  eventType: TimelineEventType,
  summary: string,
  metadata?: Record<string, unknown>,
): void {
  const root = getWorkspaceRoot();
  if (!root || !isTimelineRecordingEnabled(root)) return;
  if (!summary.trim()) return;
  void invoke("timeline_record", {
    workspaceId: root,
    eventType,
    summary: summary.trim(),
    metadataJson: metadata ? JSON.stringify(metadata) : null,
    sensitivity: 0,
  })
    .then(() => emit())
    .catch((e) => console.warn("[timeline] record failed:", e));
}

/* ── Querying ────────────────────────────────────────────────────────────── */

export async function queryTimeline(
  eventTypes: TimelineEventType[] = [],
  sinceDays = 30,
  limit = 200,
  root = getWorkspaceRoot(),
): Promise<TimelineEvent[]> {
  if (!root) return [];
  return invoke<TimelineEvent[]>("timeline_query", {
    workspaceId: root,
    eventTypes,
    sinceDays,
    limit,
  });
}

export async function clearWorkspaceTimeline(root = getWorkspaceRoot()): Promise<void> {
  if (!root) return;
  await invoke("timeline_clear", { workspaceId: root });
  emit();
}

/* ── Buckets ─────────────────────────────────────────────────────────────── */

export type TimelineWorkspace = {
  workspace_id: string;
  event_count: number;
  last_ts: number;
};

/** Every bucket that has events, most recent first — powers the header
    folder switcher (peek at another project's timeline without cd-ing). */
export function listTimelineWorkspaces(): Promise<TimelineWorkspace[]> {
  return invoke<TimelineWorkspace[]>("timeline_workspaces");
}

/* ── Change notification (recording + clears refresh open views) ─────────── */

const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

export function subscribeTimeline(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
