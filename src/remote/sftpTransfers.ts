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
 * The paths and transfer state are safe to persist locally; credentials remain
 * in the operating-system keychain. A transfer marked running when the app
 * closes is deliberately restored as paused — resuming a write is an explicit
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

type NewTransfer = Pick<SftpTransfer, "host" | "direction" | "kind" | "localPath" | "remotePath" | "label" | "folderConflictStrategy">;

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
      return task.state === "running"
        ? { ...task, attempts, state: "paused", error: "Husk was closed while this transfer was running.", updatedAt: now }
        : { ...task, attempts };
    });
  } catch {
    return [];
  }
}

let transfers = load();
const subscribers = new Set<() => void>();
const processingHosts = new Set<string>();
const activeHosts = new Set<string>();
const hostListeners = new Map<string, UnlistenFn>();

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

async function run(task: SftpTransfer): Promise<void> {
  const resume = task.attempts > 1;
  if (task.direction === "download") {
    if (task.kind === "folder") {
      await sftpDownloadDir(task.host, task.remotePath, task.localPath, task.id, resume);
    } else {
      await sftpDownload(task.host, task.remotePath, task.localPath, task.id, resume);
    }
  } else if (task.kind === "folder") {
    await sftpUploadDir(task.host, task.localPath, task.remotePath, task.id, resume, task.folderConflictStrategy ?? "merge");
  } else {
    await sftpUpload(task.host, task.localPath, task.remotePath, task.id, resume);
  }
}

async function process(host: string): Promise<void> {
  if (processingHosts.has(host) || !activeHosts.has(host)) return;
  processingHosts.add(host);
  try {
    while (activeHosts.has(host)) {
      const next = transfers.find((task) => task.host === host && task.state === "queued");
      if (!next) break;
      const running = replace(next.id, { state: "running", error: undefined, attempts: next.attempts + 1 });
      if (!running) continue;
      try {
        await run(running);
        const current = transfers.find((task) => task.id === next.id);
        if (current?.state === "running") {
          replace(next.id, { state: "completed", progress: 100, error: undefined });
          window.dispatchEvent(new CustomEvent("husk-sftp-transfer-complete", { detail: { host } }));
        }
      } catch (error) {
        const current = transfers.find((task) => task.id === next.id);
        // The cancel action changes the state immediately so the controls feel
        // responsive; retain the native partial data for a later resume.
        if (current?.state === "paused") continue;
        replace(next.id, { state: "failed", error: transferError(error) });
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

function ensureProgressListener(host: string): void {
  if (hostListeners.has(host)) return;
  void listen<NativeProgress>(`sftp://progress/${host}`, (event) => {
    const progress = event.payload;
    const task = transfers.find((item) => item.id === progress.id);
    if (!task || task.state !== "running") return;
    replace(progress.id, {
      progress: Math.min(100, Math.max(0, progress.progress || 0)),
      copied: progress.copied,
      total: progress.total,
    });
  }).then((unlisten) => {
    if (activeHosts.has(host)) hostListeners.set(host, unlisten);
    else unlisten();
  }).catch(() => {
    // The queue still functions; completion and failure are handled by invoke.
  });
}

export function activateSftpTransferQueue(host: string): () => void {
  activeHosts.add(host);
  ensureProgressListener(host);
  void process(host);
  return () => {
    activeHosts.delete(host);
    const unlisten = hostListeners.get(host);
    hostListeners.delete(host);
    unlisten?.();
  };
}

export function enqueueSftpTransfer(input: NewTransfer): SftpTransfer {
  const now = Date.now();
  const task: SftpTransfer = {
    ...input,
    id: makeId(),
    state: "queued",
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
  const task = replace(id, { state: "paused", error: "Paused by you." });
  if (task?.state === "paused") void sftpCancelTransfer(id).catch(() => {});
}

export function resumeSftpTransfer(id: string): void {
  const task = replace(id, { state: "queued", error: undefined });
  if (task) void process(task.host);
}

export function retrySftpTransfer(id: string): void {
  resumeSftpTransfer(id);
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
  return transfers
    .filter((task) => !host || task.host === host)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function subscribeSftpTransfers(listener: () => void): () => void {
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

export function useSftpTransfers(host: string): SftpTransfer[] {
  return useSyncExternalStore(
    subscribeSftpTransfers,
    () => getSftpTransfers(host),
    () => [],
  );
}
