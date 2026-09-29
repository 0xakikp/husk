import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useSyncExternalStore } from "react";

import {
  sftpCancelTransfer,
  sftpDownload,
  sftpDownloadDir,
  sftpUpload,
  sftpUploadDir,
} from "./sftpApi";

/**
 * Durable client-side queue for native SFTP work.
 *
 * Only paths, public target metadata and transfer state are persisted locally;
 * this queue never accepts credentials. Queued/running transfers from a previous
 * app session are restored as paused — resuming a write is an explicit
 * user action, not a surprise network operation at launch.
 */
const STORAGE_KEY = "huskv2.sftp.transferQueue";
const MAX_COMPLETED = 12;

export type SftpTransferDirection = "upload" | "download";
export type SftpTransferKind = "file" | "folder";
export type SftpTransferState = "queued" | "running" | "paused" | "failed" | "completed";
/** How an initial folder upload treats a same-named remote root. */
export type SftpFolderConflictStrategy = "merge" | "replace";

export type SftpTransfer = {
  id: string;
  host: string;
  direction: SftpTransferDirection;
  kind: SftpTransferKind;
  /** The local file, or the local parent directory for a folder download. */
  localPath: string;
  /** The remote file, or the remote parent directory for a folder upload. */
  remotePath: string;
  /** Stored with a folder upload so queue retries preserve the original intent. */
  folderConflictStrategy?: SftpFolderConflictStrategy;
  /** Set only after an explicit destination/replacement confirmation. */
  allowOverwrite?: boolean;
  label: string;
  state: SftpTransferState;
  progress: number;
  copied?: number;
  total?: number;
  error?: string;
  /** Starts at zero. Retry/resume attempts may reuse staged partial files. */
  attempts: number;
  createdAt: number;
  updatedAt: number;
};

type NewTransfer = Pick<SftpTransfer, "host" | "direction" | "kind" | "localPath" | "remotePath" | "label" | "folderConflictStrategy" | "allowOverwrite">;

type NativeProgress = {
  id: string;
  type: SftpTransferDirection;
  path: string;
  progress: number;
  copied?: number;
  total?: number;
};

function isTransfer(value: unknown): value is SftpTransfer {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<SftpTransfer>;
  return typeof task.id === "string"
    && typeof task.host === "string"
    && (task.direction === "upload" || task.direction === "download")
    && (task.kind === "file" || task.kind === "folder")
    && typeof task.localPath === "string"
    && typeof task.remotePath === "string"
    && typeof task.label === "string"
    && ["queued", "running", "paused", "failed", "completed"].includes(task.state ?? "")
    && typeof task.progress === "number"
    && typeof task.createdAt === "number"
    && typeof task.updatedAt === "number";
}

function load(): SftpTransfer[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return parsed.filter(isTransfer).map((task) => {
      const attempts = typeof task.attempts === "number" ? Math.max(0, task.attempts) : task.state === "queued" ? 0 : 1;
      return task.state === "running" || task.state === "queued"
        ? { ...task, attempts, state: "paused", error: "Restored transfer. Connect and explicitly resume when ready.", updatedAt: now }
        : { ...task, attempts };
    });
  } catch {
    return [];
  }
}

let transfers = load();
const subscribers = new Set<() => void>();
const processingHosts = new Set<string>();
type ActiveConnection = { sessionKey: string; unlisten?: UnlistenFn };
const activeHosts = new Map<string, ActiveConnection>();
const runningSessions = new Map<string, string>();
const transferSnapshots = new Map<string, SftpTransfer[]>();
const EMPTY_TRANSFERS: SftpTransfer[] = [];

function persist(): void {
  try {
    const unfinished = transfers.filter((task) => task.state !== "completed");
    const completed = transfers
      .filter((task) => task.state === "completed")
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_COMPLETED);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...unfinished, ...completed]));
  } catch {
    // A transfer can continue during a storage failure; it simply cannot survive
    // a restart until browser storage becomes available again.
  }
}

function emit(): void {
  // useSyncExternalStore compares snapshots by reference. Any queue mutation
  // invalidates the derived host lists; reads between mutations must return the
  // same array or React treats every render as another store update.
  transferSnapshots.clear();
  persist();
  for (const subscriber of subscribers) subscriber();
}

function replace(id: string, patch: Partial<SftpTransfer>): SftpTransfer | null {
  const index = transfers.findIndex((task) => task.id === id);
  if (index < 0) return null;
  const next = { ...transfers[index], ...patch, updatedAt: Date.now() };
  transfers = [...transfers.slice(0, index), next, ...transfers.slice(index + 1)];
  emit();
  return next;
}

function makeId(): string {
  const suffix = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 12)
    ?? Math.random().toString(36).slice(2, 14);
  return `sftp-${Date.now().toString(36)}-${suffix}`;
}

function transferError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function run(task: SftpTransfer, sessionKey: string): Promise<void> {
  const resume = task.attempts > 1;
  const allowOverwrite = task.allowOverwrite === true;
  if (task.direction === "download") {
    if (task.kind === "folder") {
      await sftpDownloadDir(sessionKey, task.remotePath, task.localPath, task.id, resume, allowOverwrite);
    } else {
      await sftpDownload(sessionKey, task.remotePath, task.localPath, task.id, resume, allowOverwrite);
    }
  } else if (task.kind === "folder") {
    await sftpUploadDir(sessionKey, task.localPath, task.remotePath, task.id, resume, task.folderConflictStrategy ?? "merge", allowOverwrite);
  } else {
    await sftpUpload(sessionKey, task.localPath, task.remotePath, task.id, resume, allowOverwrite);
  }
}

async function process(host: string): Promise<void> {
  if (processingHosts.has(host) || !activeHosts.has(host)) return;
  const connection = activeHosts.get(host)!;
  processingHosts.add(host);
  try {
    while (activeHosts.get(host) === connection) {
      const next = transfers.find((task) => task.host === host && task.state === "queued");
      if (!next) break;
      const running = replace(next.id, { state: "running", error: undefined, attempts: next.attempts + 1 });
      if (!running) continue;
      runningSessions.set(running.id, connection.sessionKey);
      try {
        await run(running, connection.sessionKey);
        const current = transfers.find((task) => task.id === next.id);
        if (current?.state === "running" && activeHosts.get(host) === connection) {
          replace(next.id, { state: "completed", progress: 100, error: undefined });
          window.dispatchEvent(new CustomEvent("husk-sftp-transfer-complete", { detail: { host } }));
        }
      } catch (error) {
        const current = transfers.find((task) => task.id === next.id);
        // The cancel action changes the state immediately so the controls feel
        // responsive; retain the native partial data for a later resume.
        if (current?.state !== "running" || activeHosts.get(host) !== connection) continue;
        replace(next.id, { state: "failed", error: transferError(error) });
      } finally {
        runningSessions.delete(running.id);
      }
    }
  } finally {
    processingHosts.delete(host);
    // A retry can be requested by the UI immediately after a task becomes
    // failed, before this worker reaches its cleanup. In that short window the
    // retry sees an active worker and intentionally does not start another
    // loop. Pick up any such queued work after releasing the host lock.
    if (activeHosts.has(host) && transfers.some((task) => task.host === host && task.state === "queued")) {
      void process(host);
    }
  }
}

function ensureProgressListener(host: string, connection: ActiveConnection): void {
  void listen<NativeProgress>(`sftp://progress/${connection.sessionKey}`, (event) => {
    if (activeHosts.get(host) !== connection) return;
    const progress = event.payload;
    const task = transfers.find((item) => item.id === progress.id);
    if (!task || task.host !== host || task.state !== "running" || runningSessions.get(task.id) !== connection.sessionKey) return;
    replace(progress.id, {
      progress: Math.min(100, Math.max(0, progress.progress || 0)),
      copied: progress.copied,
      total: progress.total,
    });
  }).then((unlisten) => {
    if (activeHosts.get(host) === connection) connection.unlisten = unlisten;
    else unlisten();
  }).catch(() => {
    // The queue still functions; completion and failure are handled by invoke.
  });
}

function pauseHost(host: string, error: string): void {
  for (const task of transfers.filter(task => task.host === host && (task.state === "running" || task.state === "queued"))) {
    const wasRunning = task.state === "running";
    replace(task.id, { state: "paused", error });
    if (wasRunning) void sftpCancelTransfer(task.id).catch(() => {});
  }
}

export function activateSftpTransferQueue(host: string, sessionKey = host): () => void {
  const previous = activeHosts.get(host);
  if (previous) {
    pauseHost(host, "The connection changed. Explicitly resume when ready.");
    previous.unlisten?.();
  }
  const connection: ActiveConnection = { sessionKey };
  activeHosts.set(host, connection);
  ensureProgressListener(host, connection);
  void process(host);
  return () => {
    // An older panel must not deactivate a newer, explicitly connected session.
    if (activeHosts.get(host) !== connection) return;
    activeHosts.delete(host);
    pauseHost(host, "Connection closed. Connect and explicitly resume when ready.");
    connection.unlisten?.();
  };
}

export function enqueueSftpTransfer(input: NewTransfer): SftpTransfer {
  const now = Date.now();
  const task: SftpTransfer = {
    ...input,
    id: makeId(),
    state: activeHosts.has(input.host) ? "queued" : "paused",
    error: activeHosts.has(input.host) ? undefined : "Connect before explicitly starting this transfer.",
    progress: 0,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  transfers = [...transfers, task];
  emit();
  void process(task.host);
  return task;
}

export function pauseSftpTransfer(id: string): void {
  const previous = transfers.find(task => task.id === id);
  if (!previous || previous.state === "completed") return;
  const task = replace(id, { state: "paused", error: "Paused by you." });
  if (task && previous.state === "running") void sftpCancelTransfer(id).catch(() => {});
}

export function resumeSftpTransfer(id: string, allowOverwrite = false): void {
  const previous = transfers.find(task => task.id === id);
  if (!previous || (previous.state !== "paused" && previous.state !== "failed")) return;
  if (!activeHosts.has(previous.host)) {
    replace(id, { state: "paused", error: "Connect before explicitly resuming this transfer." });
    return;
  }
  // Re-confirm replacement each time, including restored queues. Never restore
  // the old whole-directory replacement mode through a retry.
  const task = replace(id, { state: "queued", error: undefined, allowOverwrite, folderConflictStrategy: "merge" });
  if (task) void process(task.host);
}

export function retrySftpTransfer(id: string, allowOverwrite = false): void {
  resumeSftpTransfer(id, allowOverwrite);
}

export function removeSftpTransfer(id: string): void {
  const task = transfers.find((item) => item.id === id);
  if (!task || task.state === "running") return;
  transfers = transfers.filter((item) => item.id !== id);
  emit();
}

export function clearCompletedSftpTransfers(host: string): void {
  transfers = transfers.filter((task) => task.host !== host || task.state !== "completed");
  emit();
}

export function getSftpTransfers(host?: string): SftpTransfer[] {
  const key = host ?? "\0all";
  const cached = transferSnapshots.get(key);
  if (cached) return cached;

  const snapshot = transfers
    .filter((task) => !host || task.host === host)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  transferSnapshots.set(key, snapshot);
  return snapshot;
}

export function subscribeSftpTransfers(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useSftpTransfers(host: string): SftpTransfer[] {
  return useSyncExternalStore(
    subscribeSftpTransfers,
    () => getSftpTransfers(host),
    () => EMPTY_TRANSFERS,
  );
}
