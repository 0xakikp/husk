/** Local, opt-in terminal display history. This stores rendered normal-buffer
 * rows, never PTY bytes, executable commands, prompt state, or live processes.
 * Rows are historical visual rows: a line that wrapped when captured remains
 * split on restore. Content is plaintext in the application's local WebView
 * storage. Enabling/disabling capture belongs to the terminal runtime. */
import { createScrollbackKey, isScrollbackKey } from "./scrollbackIdentity";
export const SCROLLBACK_ARCHIVE_LIMITS = {
  rows: 10_000,
  snapshotBytes: 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  snapshots: 256,
  defaultRetentionDays: 7,
  timeoutMs: 8_000,
} as const;

export type ScrollbackSnapshot = {
  key: string;
  rows: string[];
  savedAt: number;
  /** Archived text bytes, including one line separator per visual row. */
  bytes: number;
  truncated: boolean;
  /** Capture width avoids artificial startup reflow before the pane is fitted. */
  cols?: number;
};

export type ScrollbackArchiveOptions = { retentionDays?: number; cols?: number };
export type ScrollbackArchive = {
  read(key: string, options?: ScrollbackArchiveOptions): Promise<ScrollbackSnapshot | null>;
  /** Call read first to acknowledge the archive's deletion revision. */
  save(key: string, rows: readonly string[], options?: ScrollbackArchiveOptions): Promise<ScrollbackSnapshot>;
  delete(key: string): Promise<void>;
  clearAll(): Promise<void>;
  prune(options?: ScrollbackArchiveOptions & { activeKeys?: readonly string[] }): Promise<void>;
  /** Fires synchronously when deletion is requested, before queued work runs.
   * The runtime must cancel pending captures and advance their baselines so
   * visible old rows cannot be saved again after an explicit deletion. */
  subscribeDeletion(listener: (key: string | null) => void): () => void;
  close(): void;
};

const DB_NAME = "husk-terminal-scrollback";
const STORE = "snapshots";
const META = "metadata";
const DAY_MS = 86_400_000;
export class ScrollbackArchiveChangedError extends Error {
  constructor() { super("Saved terminal history changed in another window. The stale snapshot was not saved."); }
}

function assertKey(key: unknown): asserts key is string {
  if (!isScrollbackKey(key)) throw new Error("Invalid terminal history identifier.");
}

export const newScrollbackKey = createScrollbackKey;

/** Rendered rows should have no escape sequences. Still treat local storage as
 * untrusted: discard ANSI/OSC/control-string payloads as well as control and
 * bidi characters. Merely deleting ESC would leave its payload masquerading
 * as ordinary historical output. No restored row can issue terminal actions. */
export function sanitizeScrollbackRow(value: string): string {
  // Real rendered xterm rows take this fast path. Avoid walking/concatenating
  // every character of a large archive on the UI thread at each checkpoint.
  if (!/[\x00-\x1f\x7f-\x9f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/.test(value)) return value;
  let mode: "text" | "escape" | "csi" | "osc" | "string" | "charset" = "text";
  let stringEscape = false;
  let result = "";
  for (const char of value) {
    const point = char.codePointAt(0)!;
    if (mode === "osc" || mode === "string") {
      if (point === 0x9c || (mode === "osc" && point === 7) || (stringEscape && char === "\\")) {
        mode = "text";
        stringEscape = false;
      } else stringEscape = point === 27;
      continue;
    }
    if (mode === "csi") {
      if (point === 27) mode = "escape";
      else if (char >= "@" && char <= "~") mode = "text";
      continue;
    }
    if (mode === "charset") { mode = "text"; continue; }
    if (mode === "escape") {
      if (char === "[") mode = "csi";
      else if (char === "]") mode = "osc";
      else if ("PX^_".includes(char)) mode = "string";
      else if ("()*+-./".includes(char)) mode = "charset";
      else if (point !== 27) mode = "text";
      continue;
    }
    if (point === 27) { mode = "escape"; continue; }
    if (point === 0x9b) { mode = "csi"; continue; }
    if (point === 0x9d) { mode = "osc"; continue; }
    if ([0x90, 0x98, 0x9e, 0x9f].includes(point)) { mode = "string"; continue; }
    if (point < 32 || (point >= 127 && point <= 159)
      || point === 0x061c || point === 0x200e || point === 0x200f
      || (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069)) continue;
    // These Unicode separators must not create extra rows outside the cap.
    result += point === 0x2028 || point === 0x2029 ? " " : char;
  }
  return result;
}

function codePointBytes(point: number) { return point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4; }

function utf8Bytes(value: string): number {
  if (/^[\x00-\x7f]*$/.test(value)) return value.length;
  let bytes = 0;
  for (const char of value) bytes += codePointBytes(char.codePointAt(0)!);
  return bytes;
}

function boundedTail(value: string, limit: number): { text: string; bytes: number; truncated: boolean } {
  const fullBytes = utf8Bytes(value);
  if (fullBytes <= limit) return { text: value, bytes: fullBytes, truncated: false };
  let start = value.length;
  let bytes = 0;
  while (start > 0) {
    let index = start - 1;
    const last = value.charCodeAt(index);
    if (last >= 0xdc00 && last <= 0xdfff && index > 0) {
      const before = value.charCodeAt(index - 1);
      if (before >= 0xd800 && before <= 0xdbff) index--;
    }
    const size = codePointBytes(value.codePointAt(index)!);
    if (bytes + size > limit) break;
    bytes += size;
    start = index;
  }
  return { text: value.slice(start), bytes, truncated: start !== 0 };
}

function capture(key: string, input: readonly string[], savedAt: number): ScrollbackSnapshot {
  assertKey(key);
  if (!Array.isArray(input) || !Number.isFinite(savedAt) || savedAt < 0) throw new Error("Invalid terminal history snapshot.");
  const rows: string[] = [];
  let bytes = 0;
  let truncated = input.length > SCROLLBACK_ARCHIVE_LIMITS.rows;
  const first = Math.max(0, input.length - SCROLLBACK_ARCHIVE_LIMITS.rows);
  for (let i = input.length - 1; i >= first; i--) {
    if (typeof input[i] !== "string") throw new Error("Terminal history rows must be plain text.");
    const available = SCROLLBACK_ARCHIVE_LIMITS.snapshotBytes - bytes;
    if (available < 1) { truncated = true; break; }
    const row = boundedTail(sanitizeScrollbackRow(input[i]), available - 1);
    rows.push(row.text);
    bytes += row.bytes + 1;
    if (row.truncated) { truncated = true; break; }
  }
  rows.reverse();
  return { key, rows, bytes, savedAt, truncated };
}

function retentionDays(options?: ScrollbackArchiveOptions): number {
  const value = options?.retentionDays;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(30, Math.max(1, Math.trunc(value))) : SCROLLBACK_ARCHIVE_LIMITS.defaultRetentionDays;
}

/** Validate before returning any persisted content. Oversized/corrupt records
 * are removed rather than trusted based on their claimed `bytes` metadata. */
function validate(value: unknown, now: number, days: number): ScrollbackSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ScrollbackSnapshot>;
  if (!isScrollbackKey(row.key) || !Array.isArray(row.rows)
    || row.rows.length === 0 || row.rows.length > SCROLLBACK_ARCHIVE_LIMITS.rows
    || typeof row.savedAt !== "number" || !Number.isFinite(row.savedAt)
    || row.savedAt < 0 || row.savedAt > now + DAY_MS || row.savedAt <= now - days * DAY_MS
    || typeof row.truncated !== "boolean" || !Number.isSafeInteger(row.bytes) || row.bytes! < 0
    || (row.cols !== undefined && (!Number.isSafeInteger(row.cols) || row.cols < 2 || row.cols > 4096))) return null;
  const rows: string[] = [];
  let rawBytes = 0;
  let bytes = 0;
  for (const line of row.rows) {
    if (typeof line !== "string" || line.length > SCROLLBACK_ARCHIVE_LIMITS.snapshotBytes) return null;
    rawBytes += utf8Bytes(line) + 1;
    if (rawBytes > SCROLLBACK_ARCHIVE_LIMITS.snapshotBytes) return null;
    const safe = sanitizeScrollbackRow(line);
    rows.push(safe);
    bytes += utf8Bytes(safe) + 1;
  }
  // The declared size must describe the stored data, not a smaller fake value.
  if (row.bytes !== rawBytes) return null;
  return { key: row.key, rows, bytes, savedAt: row.savedAt, truncated: row.truncated, cols: row.cols };
}

type ArchiveEntry = { key: string; savedAt: number; bytes: number };
function entryValid(value: unknown, now: number, days: number): value is ArchiveEntry {
  if (!value || typeof value !== "object") return false;
  const item = value as ArchiveEntry;
  return isScrollbackKey(item.key) && Number.isFinite(item.savedAt) && item.savedAt >= 0
    && item.savedAt <= now + DAY_MS && item.savedAt > now - days * DAY_MS
    && Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= SCROLLBACK_ARCHIVE_LIMITS.snapshotBytes;
}

export function createScrollbackArchive(config: {
  factory?: IDBFactory;
  name?: string;
  now?: () => number;
  timeoutMs?: number;
} = {}): ScrollbackArchive {
  const now = config.now ?? Date.now;
  const timeoutMs = config.timeoutMs ?? SCROLLBACK_ARCHIVE_LIMITS.timeoutMs;
  let database: IDBDatabase | undefined;
  let opening: Promise<IDBDatabase> | undefined;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  let revision: number | null = null;
  const paneRevisions = new Map<string, number>();
  let channel: BroadcastChannel | undefined;
  const deletionListeners = new Set<(key: string | null) => void>();

  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(new Error("Terminal history storage is closed."));
    const result = queue.then(operation);
    // One failed transaction must not poison later clear/delete requests.
    queue = result.catch(() => {});
    return result;
  }

  function notifyDeletion(key: string | null) {
    for (const listener of deletionListeners) {
      try { listener(key); } catch { /* A UI subscriber cannot prevent deletion. */ }
    }
  }

  function connectChannel() {
    if (channel || typeof window === "undefined" || typeof BroadcastChannel === "undefined") return;
    try {
      channel = new BroadcastChannel(`${config.name ?? DB_NAME}:deletions`);
      channel.onmessage = ({ data }) => {
        if (!data || !Number.isSafeInteger(data.revision) || data.revision < 1
          || !Number.isSafeInteger(data.generation) || data.generation < 0
          || (data.key !== null && !isScrollbackKey(data.key))) return;
        if (revision !== null && data.generation < revision) return;
        if (data.key === null) {
          if (revision !== null && data.revision <= revision) return;
          revision = data.revision;
          paneRevisions.clear();
        } else {
          if (revision !== null && data.generation > revision) { paneRevisions.clear(); notifyDeletion(null); }
          revision = data.generation;
          if (data.revision <= (paneRevisions.get(data.key) ?? -1)) return;
          paneRevisions.set(data.key, data.revision);
        }
        notifyDeletion(data.key);
      };
    } catch { /* Revision checks in storage also reject stale cross-window saves. */ }
  }

  function open(): Promise<IDBDatabase> {
    connectChannel();
    if (database) return Promise.resolve(database);
    if (opening) return opening;
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        const factory = config.factory ?? globalThis.indexedDB;
        if (!factory) throw new Error("Terminal history storage is unavailable.");
        request = factory.open(config.name ?? DB_NAME, 2);
      } catch (error) { reject(error); return; }
      let expired = false;
      const timer = setTimeout(() => {
        expired = true;
        reject(new Error("Terminal history storage timed out. Close other Husk windows and retry."));
      }, timeoutMs);
      request.onupgradeneeded = () => {
        if (expired) { request.transaction?.abort(); return; }
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" });
        if (!request.result.objectStoreNames.contains(META)) request.result.createObjectStore(META);
      };
      request.onerror = () => { clearTimeout(timer); reject(request.error ?? new Error("Could not open terminal history storage.")); };
      request.onsuccess = () => {
        clearTimeout(timer);
        const db = request.result;
        if (expired || closed) { db.close(); reject(new Error("Terminal history storage is closed.")); return; }
        db.onversionchange = () => { db.close(); if (database === db) database = undefined; };
        database = db;
        resolve(db);
      };
    }).finally(() => { opening = undefined; });
    return opening;
  }

  async function transaction<T>(work: (store: IDBObjectStore, result: (value: T) => void, meta: IDBObjectStore, fail: (error: Error) => void) => void): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try { tx = db.transaction([STORE, META], "readwrite", { durability: "strict" }); }
      catch { try { tx = db.transaction([STORE, META], "readwrite"); } catch (error) { reject(error); return; } }
      let value: T;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        try { tx.abort(); } catch { /* A completed transaction will settle below. */ }
        reject(new Error("Terminal history storage timed out. The change was not confirmed."));
      }, timeoutMs);
      tx.oncomplete = () => { clearTimeout(timer); if (!timedOut) resolve(value); };
      tx.onabort = () => { clearTimeout(timer); reject(tx.error ?? new Error("Terminal history storage transaction was aborted.")); };
      tx.onerror = () => { /* Transaction abort owns rejection, including quota errors. */ };
      const fail = (error: Error) => { clearTimeout(timer); reject(error); try { tx.abort(); } catch { /* Already settled. */ } };
      try { work(tx.objectStore(STORE), next => { value = next; }, tx.objectStore(META), fail); }
      catch (error) { clearTimeout(timer); tx.abort(); reject(error); }
    });
  }

  /** Prune using tiny metadata records, never loading every pane's megabyte
   * of output on each save. Only the requested snapshot is validated/read. */
  function scan<T>(options: ScrollbackArchiveOptions | undefined, requested: string | null,
    finish: (store: Pick<IDBObjectStore, "put" | "delete">, found: ScrollbackSnapshot | null, retained: ArchiveEntry[]) => T,
    activeKeys?: Set<string>, expectedRevision?: { global: number | null; pane: number | null; key: string }): Promise<T> {
    return transaction<T>((store, result, meta, fail) => {
      const version = meta.get("revision");
      version.onsuccess = () => {
        const currentRevision = Number.isSafeInteger(version.result) ? version.result as number : 0;
        if (expectedRevision !== undefined && expectedRevision.global !== currentRevision) {
          revision = currentRevision;
          paneRevisions.clear();
          notifyDeletion(null);
          fail(new ScrollbackArchiveChangedError());
          return;
        }
        if (revision !== null && revision !== currentRevision) { paneRevisions.clear(); notifyDeletion(null); }
        revision = currentRevision;
        const processSnapshot = () => {
        const stamp = now();
        const days = retentionDays(options);
        const retained: ArchiveEntry[] = [];
        let found: ScrollbackSnapshot | null = null;
        const indexedStore: Pick<IDBObjectStore, "put" | "delete"> = {
          put(value: ScrollbackSnapshot) {
            meta.put({ key: value.key, savedAt: value.savedAt, bytes: value.bytes }, `entry:${value.key}`);
            return store.put(value);
          },
          delete(key) {
            meta.delete(`entry:${String(key)}`);
            return store.delete(key);
          },
        };
        const scanEntries = () => {
          const request = meta.openCursor();
          request.onsuccess = () => {
            const cursor = request.result;
            if (cursor) {
              if (typeof cursor.key === "string" && cursor.key.startsWith("entry:")) {
                const entry = cursor.value as ArchiveEntry;
                if (!entryValid(entry, stamp, days) || cursor.key !== `entry:${entry.key}` || (activeKeys && !activeKeys.has(entry.key))) {
                  const key = cursor.key.slice(6);
                  store.delete(key);
                  if (found?.key === key) found = null;
                  cursor.delete();
                } else retained.push(entry);
              }
              cursor.continue();
              return;
            }
            retained.sort((a, b) => b.savedAt - a.savedAt || a.key.localeCompare(b.key));
            let bytes = 0;
            const keep: typeof retained = [];
            for (const record of retained) {
              if (keep.length >= SCROLLBACK_ARCHIVE_LIMITS.snapshots || bytes + record.bytes > SCROLLBACK_ARCHIVE_LIMITS.totalBytes) {
                indexedStore.delete(record.key);
                if (found?.key === record.key) found = null;
              } else { keep.push(record); bytes += record.bytes; }
            }
            result(finish(indexedStore, found, keep));
          };
        };
        if (requested) {
          const request = store.get(requested);
          request.onsuccess = () => {
            found = validate(request.result, stamp, days);
            if (!found || found.key !== requested) { found = null; indexedStore.delete(requested); }
            else meta.put({ key: requested, savedAt: found.savedAt, bytes: (request.result as ScrollbackSnapshot).bytes }, `entry:${requested}`);
            scanEntries();
          };
        } else scanEntries();
        };
        const identity = expectedRevision?.key ?? requested;
        if (identity) {
          const paneVersion = meta.get(`revision:${identity}`);
          paneVersion.onsuccess = () => {
            const currentPaneRevision = Number.isSafeInteger(paneVersion.result) ? paneVersion.result as number : 0;
            if (expectedRevision && expectedRevision.pane !== currentPaneRevision) {
              paneRevisions.set(identity, currentPaneRevision);
              notifyDeletion(identity);
              fail(new ScrollbackArchiveChangedError());
              return;
            }
            if (paneRevisions.has(identity) && paneRevisions.get(identity) !== currentPaneRevision) notifyDeletion(identity);
            paneRevisions.set(identity, currentPaneRevision);
            processSnapshot();
          };
        } else processSnapshot();
      };
    });
  }

  function remove(key: string | null): Promise<void> {
    notifyDeletion(key);
    return enqueue(async () => {
      const next = await transaction<{ revision: number; generation: number }>((store, result, meta) => {
        const version = meta.get("revision");
        version.onsuccess = () => {
          const generation = Number.isSafeInteger(version.result) ? version.result as number : 0;
          if (key === null) {
            store.clear(); meta.clear(); meta.put(generation + 1, "revision");
            result({ revision: generation + 1, generation: generation + 1 });
          } else {
            const paneVersion = meta.get(`revision:${key}`);
            paneVersion.onsuccess = () => {
              const next = (Number.isSafeInteger(paneVersion.result) ? paneVersion.result as number : 0) + 1;
              store.delete(key); meta.delete(`entry:${key}`); meta.put(next, `revision:${key}`);
              result({ revision: next, generation });
            };
          }
        };
      });
      revision = next.generation;
      if (key === null) paneRevisions.clear(); else paneRevisions.set(key, next.revision);
      channel?.postMessage({ key, ...next });
    });
  }

  return {
    read(key, options) {
      try { assertKey(key); } catch (error) { return Promise.reject(error); }
      return enqueue(() => scan(options, key, (_store, found) => found));
    },
    save(key, rows, options) {
      // Snapshot before queueing: later edits to the caller's array cannot
      // mutate an earlier save or race a deletion queued after it.
      let snapshot: ScrollbackSnapshot;
      try { snapshot = capture(key, rows, now()); } catch (error) { return Promise.reject(error); }
      if (Number.isSafeInteger(options?.cols) && options!.cols! >= 2 && options!.cols! <= 4096) snapshot.cols = options!.cols;
      const expectedRevision = { global: revision, pane: paneRevisions.get(key) ?? null, key };
      return enqueue(() => scan(options, null, (store, _found, retained) => {
        let bytes = snapshot.bytes;
        let count = snapshot.rows.length ? 1 : 0;
        for (const record of retained) {
          if (record.key === key) continue;
          if (count >= SCROLLBACK_ARCHIVE_LIMITS.snapshots || bytes + record.bytes > SCROLLBACK_ARCHIVE_LIMITS.totalBytes) store.delete(record.key);
          else { count++; bytes += record.bytes; }
        }
        if (snapshot.rows.length) store.put(snapshot);
        else store.delete(key);
        return { ...snapshot, rows: [...snapshot.rows] };
      }, undefined, expectedRevision));
    },
    delete(key) {
      try { assertKey(key); } catch (error) { return Promise.reject(error); }
      return remove(key);
    },
    clearAll() {
      return remove(null);
    },
    prune(options) {
      let activeKeys: Set<string> | undefined;
      if (options?.activeKeys) {
        try { for (const key of options.activeKeys) assertKey(key); } catch (error) { return Promise.reject(error); }
        activeKeys = new Set(options.activeKeys);
      }
      return enqueue(() => scan(options, null, () => undefined, activeKeys));
    },
    subscribeDeletion(listener) { deletionListeners.add(listener); return () => { deletionListeners.delete(listener); }; },
    close() {
      closed = true;
      channel?.close();
      deletionListeners.clear();
      void queue.finally(() => { database?.close(); database = undefined; });
    },
  };
}

/** Lazy: importing the settings page or terminal code does not open storage. */
export const scrollbackArchive = createScrollbackArchive();
