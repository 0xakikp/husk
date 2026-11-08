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
let lastKnownDisabled = new Set<string>();
const recordingOverrides = new Map<string, boolean>();

function disabledWorkspaces(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(DISABLED_KEY) || "[]");
    if (Array.isArray(parsed) && parsed.every((root) => typeof root === "string")) {
      lastKnownDisabled = new Set(parsed);
    }
  } catch {
    // Preserve the last known opt-outs while storage is unavailable.
  }
  const disabled = new Set(lastKnownDisabled);
  for (const [root, enabled] of recordingOverrides) {
    if (enabled) disabled.delete(root);
    else disabled.add(root);
  }
  return disabled;
}

export function isTimelineRecordingEnabled(root = getWorkspaceRoot()): boolean {
  if (!root) return false;
  return !disabledWorkspaces().has(root);
}

/** Returns whether the preference was persisted; a failed write still applies
 * for this session, and the UI must not imply it will survive a restart. */
export function setTimelineRecordingEnabled(enabled: boolean, root = getWorkspaceRoot()): boolean {
  if (!root) return false;
  const set = disabledWorkspaces();
  if (enabled) set.delete(root);
  else set.add(root);
  recordingOverrides.set(root, enabled);
  let persisted = false;
  try {
    localStorage.setItem(DISABLED_KEY, JSON.stringify([...set]));
    lastKnownDisabled = set;
    recordingOverrides.clear();
    persisted = true;
  } catch {
    // storage unavailable — recording preference stays in memory only
  }
  emit();
  return persisted;
}

/* ── Recording ─────────────────────────────────────────────────────────────
   Fire-and-forget: the timeline must never slow down or break the thing it
   is logging. A failed insert is a console note, not an error dialog. */

export async function recordTimelineEvent(
  eventType: TimelineEventType,
  summary: string,
  metadata?: Record<string, unknown>,
  options: { workspaceRoot?: string; sensitivity?: number } = {},
): Promise<boolean> {
  const root = options.workspaceRoot ?? getWorkspaceRoot();
  if (!root || !isTimelineRecordingEnabled(root) || !summary.trim()) return false;
  try {
    await invoke("timeline_record", {
      workspaceId: root,
      eventType,
      summary: summary.trim(),
      metadataJson: metadata ? JSON.stringify(metadata) : null,
      sensitivity: options.sensitivity ?? 0,
    });
    emit();
    return true;
  } catch {
    console.warn("[timeline] could not record event");
    return false;
  }
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

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key === DISABLED_KEY || event.key === null) emit();
  });
}

export function subscribeTimeline(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
