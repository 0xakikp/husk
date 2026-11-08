import { afterEach, describe, expect, it } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { createScrollbackArchive, newScrollbackKey, sanitizeScrollbackRow, SCROLLBACK_ARCHIVE_LIMITS as LIMITS, ScrollbackArchiveChangedError, type ScrollbackArchive } from "./scrollbackArchive";

const archives: ScrollbackArchive[] = [];
afterEach(() => { archives.splice(0).forEach(archive => archive.close()); });
function setup(factory = new IDBFactory(), name = "history-test", now = () => Date.now()) {
  const archive = createScrollbackArchive({ factory, name, now });
  archives.push(archive);
  return archive;
}
async function ready(archive: ScrollbackArchive) { const key = newScrollbackKey(); await archive.read(key); return key; }

describe("opt-in plain-text terminal archive", () => {
  it("does not open storage merely on import/construction", () => {
    const factory = { open: () => { throw new Error("unexpected open"); } } as unknown as IDBFactory;
    expect(() => setup(factory)).not.toThrow();
  });
  it("persists a defensive snapshot across archive instances", async () => {
    const factory = new IDBFactory(); const a = setup(factory); const key = await ready(a);
    const rows = ["old output", "unicode 🌍"];
    const save = a.save(key, rows); rows[0] = "changed later";
    await save;
    const b = setup(factory);
    expect((await b.read(key))?.rows).toEqual(["old output", "unicode 🌍"]);
  });
  it("stores no executable escape, OSC, control-string or bidi payload", async () => {
    const a = setup(); const key = await ready(a);
    const saved = await a.save(key, ["before\x1b]777;husk;open;/secret\x07after\x1b[31mRED\x1b[0m", "a\x90evil\x9cb\u202ec\n\r\t"]);
    expect(saved.rows).toEqual(["beforeafterRED", "abc"]);
    expect(sanitizeScrollbackRow("\x1bPbad\x1b\\good")).toBe("good");
    expect(sanitizeScrollbackRow("safe\x1b]unfinished")).toBe("safe");
  });
  it("bounds snapshots to the most recent rows", async () => {
    const a = setup(); const key = await ready(a);
    const saved = await a.save(key, Array.from({ length: LIMITS.rows + 5 }, (_, i) => `row ${i}`));
    expect(saved.rows).toHaveLength(LIMITS.rows);
    expect(saved.rows[0]).toBe("row 5"); expect(saved.truncated).toBe(true);
  });
  it("bounds UTF-8 bytes without splitting Unicode code points", async () => {
    const a = setup(); const key = await ready(a);
    const saved = await a.save(key, ["😀".repeat(400_000)]);
    expect(saved.bytes).toBeLessThanOrEqual(LIMITS.snapshotBytes);
    expect(saved.truncated).toBe(true);
    expect(saved.rows[0]).toMatch(/^(😀)+$/u);
    expect((await a.read(key))?.bytes).toBe(saved.bytes);
  });
  it("expires snapshots by last save and rejects wrong identity", async () => {
    let now = 1_800_000_000_000;
    const a = setup(undefined, undefined, () => now); const key = await ready(a);
    await a.save(key, ["expired"]);
    now += 7 * 86_400_000;
    expect(await a.read(key)).toBeNull();
    await expect(a.read("pane-1")).rejects.toThrow("identifier");
    await expect(a.save(key, [1] as unknown as string[])).rejects.toThrow("plain text");
  });
  it("enforces the global byte cap oldest first", async () => {
    let now = 1_800_000_000_000;
    const a = setup(undefined, undefined, () => now++);
    const keys: string[] = [];
    const row = "x".repeat(LIMITS.snapshotBytes - 1);
    for (let i = 0; i < 21; i++) { const key = await ready(a); keys.push(key); await a.save(key, [row]); }
    expect(await a.read(keys[0])).toBeNull();
    expect((await a.read(keys[20]))?.rows).toEqual([row]);
  }, 20_000);
  it("serializes pending writes and deletion without resurrecting the record", async () => {
    const a = setup(); const key = await ready(a);
    const save = a.save(key, ["before"]);
    const deletion = a.delete(key);
    const stale = a.save(key, ["queued after request but before revision"]);
    const staleResult = expect(stale).rejects.toBeInstanceOf(ScrollbackArchiveChangedError);
    await save; await deletion; await staleResult;
    expect(await a.read(key)).toBeNull();
    await a.save(key, ["new output after re-reading"]);
    expect((await a.read(key))?.rows).toEqual(["new output after re-reading"]);
  });
  it("rejects stale writes from another window even without BroadcastChannel", async () => {
    const factory = new IDBFactory(); const a = setup(factory); const b = setup(factory);
    const key = await ready(a); await a.save(key, ["before"]); await b.read(key);
    await a.clearAll();
    await expect(b.save(key, ["stale other window"])).rejects.toBeInstanceOf(ScrollbackArchiveChangedError);
    expect(await b.read(key)).toBeNull();
    await b.save(key, ["fresh"]); expect((await a.read(key))?.rows).toEqual(["fresh"]);
  });
  it("deleting one pane never invalidates another pane's queued snapshot", async () => {
    const factory = new IDBFactory(); const a = setup(factory); const b = setup(factory);
    const first = await ready(a); const second = await ready(b);
    await a.save(first, ["first pane"]); await b.save(second, ["second pane"]);
    await a.delete(first);
    await expect(b.save(second, ["second pane", "more work"])).resolves.toMatchObject({ rows: ["second pane", "more work"] });
    expect(await a.read(first)).toBeNull(); expect((await b.read(second))?.rows).toEqual(["second pane", "more work"]);
  });
  it("notifies deletion synchronously and allows unsubscribe", async () => {
    const a = setup(); const key = await ready(a); const changes: Array<string | null> = [];
    const stop = a.subscribeDeletion(key => changes.push(key));
    const deleting = a.clearAll(); expect(changes).toEqual([null]); await deleting;
    stop(); await a.delete(key); expect(changes).toEqual([null]);
  });
  it("rejects saves that have not initialized a deletion revision", async () => {
    const a = setup(); const key = newScrollbackKey();
    await expect(a.save(key, ["uninitialized"])).rejects.toBeInstanceOf(ScrollbackArchiveChangedError);
  });
  it("prunes orphaned keys without writing empty snapshots", async () => {
    const a = setup(); const keep = await ready(a); const remove = await ready(a);
    await a.save(keep, ["keep"]); await a.save(remove, ["remove"]);
    await a.prune({ activeKeys: [keep] });
    expect(await a.read(remove)).toBeNull(); expect((await a.read(keep))?.rows).toEqual(["keep"]);
  });
  it("reports unavailable storage", async () => {
    const a = setup({ open: () => { throw new Error("storage unavailable"); } } as unknown as IDBFactory);
    await expect(a.read(newScrollbackKey())).rejects.toThrow("unavailable");
    await expect(a.clearAll()).rejects.toThrow("unavailable");
  });
  it("removes corrupt persisted rows rather than trusting size metadata", async () => {
    const factory = new IDBFactory(); const a = setup(factory); const key = await ready(a);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open("history-test", 2); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put({ key, savedAt: Date.now(), rows: ["payload"], bytes: 1, truncated: false });
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
    });
    db.close(); expect(await a.read(key)).toBeNull();
  });
});
