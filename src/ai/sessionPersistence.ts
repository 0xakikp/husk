/** One transaction changes only the conversations that changed since the last
 * save. Streaming never serializes or rewrites the complete chat archive. */
export type SessionBatch<T> = {
  puts: T[];
  deletes: string[];
  activeSessionId?: string | null;
};

export type SessionArchive<T> = {
  initialized: boolean;
  sessions: T[];
  activeSessionId: string | null;
};

export interface SessionDatabase<T> {
  load(): Promise<SessionArchive<T>>;
  commit(batch: SessionBatch<T>): Promise<void>;
  close(): void;
}

const DB_NAME = "husk-ai-conversations";

/** IndexedDB provides an atomic commit for conversation data and selection.
 * Request success is insufficient: a later quota failure aborts the whole
 * transaction, so a save is acknowledged only by transaction.oncomplete. */
export function openSessionDatabase<T extends { id: string }>(
  factory: IDBFactory = indexedDB,
  name = DB_NAME,
): Promise<SessionDatabase<T>> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error("Chat storage is busy. Close another Husk window and retry."));
    }, 8000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "id" });
      if (!db.objectStoreNames.contains("metadata")) db.createObjectStore("metadata");
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error ?? new Error("Could not open chat storage.")); };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve({
        load: () => new Promise((resolveLoad, rejectLoad) => {
          const tx = db.transaction(["sessions", "metadata"], "readonly");
          const rows = tx.objectStore("sessions").getAll();
          const initialized = tx.objectStore("metadata").get("initialized");
          const active = tx.objectStore("metadata").get("activeSessionId");
          tx.oncomplete = () => resolveLoad({ initialized: initialized.result === true, sessions: rows.result, activeSessionId: active.result ?? null });
          tx.onabort = () => rejectLoad(tx.error ?? new Error("Could not read chat storage."));
          tx.onerror = () => { /* onabort reports transaction failures once. */ };
        }),
        commit: (batch) => new Promise((resolveCommit, rejectCommit) => {
          // Strict durability is supported by current WebViews; older WebViews
          // still get an atomic transaction with their default durability.
          let tx: IDBTransaction;
          try { tx = db.transaction(["sessions", "metadata"], "readwrite", { durability: "strict" }); }
          catch { tx = db.transaction(["sessions", "metadata"], "readwrite"); }
          tx.oncomplete = () => resolveCommit();
          tx.onabort = () => rejectCommit(tx.error ?? new Error("Chat storage transaction was aborted."));
          tx.onerror = () => { /* Preserve the transaction's quota/error cause. */ };
          try {
            const rows = tx.objectStore("sessions");
            for (const id of batch.deletes) rows.delete(id);
            for (const session of batch.puts) rows.put(session);
            const metadata = tx.objectStore("metadata");
            metadata.put(true, "initialized");
            if ("activeSessionId" in batch) metadata.put(batch.activeSessionId, "activeSessionId");
          } catch (error) {
            tx.abort();
            rejectCommit(error);
          }
        }),
        close: () => db.close(),
      });
    };
  });
}

/** Failed batches stay queued. Changes arriving during a save win over older
 * snapshots, including deletes, so retries cannot resurrect a deleted chat. */
export class SessionSaveQueue<T extends { id: string }> {
  private dirty = new Map<string, T | null>();
  private selection: { value: string | null } | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<boolean> | undefined;
  private retryDelay = 1500;
  private disposed = false;

  constructor(
    private readonly commit: (batch: SessionBatch<T>) => Promise<void>,
    private readonly onState: (state: "saving" | "saved" | "error", error?: unknown) => void,
    private readonly batchMs = 300,
  ) {}

  put(session: T) { this.dirty.set(session.id, session); this.schedule(this.batchMs); }
  delete(id: string) { this.dirty.set(id, null); this.schedule(this.batchMs); }
  select(id: string | null) { this.selection = { value: id }; this.schedule(this.batchMs); }
  hasPending(): boolean { return Boolean(this.running || this.dirty.size || this.selection); }

  private schedule(delay: number) {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, delay);
  }

  async flush(): Promise<boolean> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.running) {
      const success = await this.running;
      if (!success) return false;
      return this.flush();
    }
    if (!this.dirty.size && !this.selection) return true;
    const changes = this.dirty;
    const selection = this.selection;
    this.dirty = new Map();
    this.selection = undefined;
    const batch: SessionBatch<T> = { puts: [], deletes: [] };
    for (const [id, session] of changes) {
      if (session) batch.puts.push(session);
      else batch.deletes.push(id);
    }
    if (selection) batch.activeSessionId = selection.value;
    this.onState("saving");
    this.running = (async () => {
      try {
        await this.commit(batch);
        this.retryDelay = 1500;
        this.onState("saved");
        return true;
      } catch (error) {
        for (const [id, session] of changes) if (!this.dirty.has(id)) this.dirty.set(id, session);
        if (!this.selection) this.selection = selection;
        this.onState("error", error);
        this.schedule(this.retryDelay);
        this.retryDelay = Math.min(this.retryDelay * 2, 30000);
        return false;
      }
    })();
    const success = await this.running;
    this.running = undefined;
    if (success && (this.dirty.size || this.selection)) return this.flush();
    return success;
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
  }
}
