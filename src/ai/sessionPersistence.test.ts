import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { openSessionDatabase, SessionSaveQueue, type SessionBatch } from "./sessionPersistence";

type Chat = { id: string; content: string };

afterEach(() => vi.useRealTimers());

describe("transactional chat persistence", () => {
  it("reloads conversation updates, selection, and deletions from one committed archive", async () => {
    const factory = new IDBFactory();
    const first = await openSessionDatabase<Chat>(factory, "reload-test");
    expect((await first.load()).initialized).toBe(false);
    await first.commit({ puts: [{ id: "a", content: "old" }, { id: "b", content: "other chat" }], deletes: [], activeSessionId: "b" });
    await first.commit({ puts: [{ id: "a", content: "complete reply" }], deletes: ["b"], activeSessionId: "a" });
    first.close();
    const reopened = await openSessionDatabase<Chat>(factory, "reload-test");
    expect(await reopened.load()).toEqual({ initialized: true, sessions: [{ id: "a", content: "complete reply" }], activeSessionId: "a" });
    reopened.close();
  });

  it("rolls back earlier operations if a later row cannot be cloned", async () => {
    const db = await openSessionDatabase<Chat>(new IDBFactory(), "abort-test");
    await db.commit({ puts: [{ id: "a", content: "original" }], deletes: [], activeSessionId: "a" });
    await expect(db.commit({
      deletes: ["a"],
      puts: [{ id: "b", content: () => "cannot clone functions" } as unknown as Chat],
      activeSessionId: "b",
    })).rejects.toBeDefined();
    expect(await db.load()).toEqual({ initialized: true, sessions: [{ id: "a", content: "original" }], activeSessionId: "a" });
    db.close();
  });
});

describe("streaming save queue", () => {
  it("batches token updates and writes only conversations that changed", async () => {
    vi.useFakeTimers();
    const commit = vi.fn(async (_batch: SessionBatch<Chat>) => {});
    const queue = new SessionSaveQueue(commit, vi.fn());
    for (let index = 0; index < 100; index++) queue.put({ id: "chat-a", content: `token ${index}` });
    queue.select("chat-a");
    expect(commit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ puts: [{ id: "chat-a", content: "token 99" }], deletes: [], activeSessionId: "chat-a" });
    queue.dispose();
  });

  it("keeps unsaved data and reports quota failure until a retry commits", async () => {
    vi.useFakeTimers();
    const commit = vi.fn<(batch: SessionBatch<Chat>) => Promise<void>>()
      .mockRejectedValueOnce(new DOMException("disk full", "QuotaExceededError"))
      .mockResolvedValue(undefined);
    const state = vi.fn();
    const queue = new SessionSaveQueue(commit, state);
    queue.put({ id: "a", content: "must survive" });
    queue.select("a");
    expect(await queue.flush()).toBe(false);
    expect(queue.hasPending()).toBe(true);
    expect(state).toHaveBeenLastCalledWith("error", expect.objectContaining({ name: "QuotaExceededError" }));
    await vi.advanceTimersByTimeAsync(1500);
    expect(commit).toHaveBeenCalledTimes(2);
    expect(commit.mock.calls[1][0]).toEqual(commit.mock.calls[0][0]);
    expect(queue.hasPending()).toBe(false);
    expect(state).toHaveBeenLastCalledWith("saved");
    queue.dispose();
  });

  it("does not resurrect a chat deleted while an older save fails", async () => {
    const commit = vi.fn<(batch: SessionBatch<Chat>) => Promise<void>>();
    let failSave!: (error: unknown) => void;
    commit.mockImplementationOnce(() => new Promise((_resolve, reject) => { failSave = reject; })).mockResolvedValue(undefined);
    const queue = new SessionSaveQueue(commit, vi.fn());
    queue.put({ id: "a", content: "old token" });
    const saving = queue.flush();
    queue.delete("a");
    queue.select("b");
    failSave(new Error("temporary disk failure"));
    expect(await saving).toBe(false);
    expect(await queue.flush()).toBe(true);
    expect(commit.mock.calls[1][0]).toEqual({ puts: [], deletes: ["a"], activeSessionId: "b" });
    queue.dispose();
  });

  it("flush waits for a save in flight and then commits the latest streamed content", async () => {
    let finish!: () => void;
    const commit = vi.fn<(batch: SessionBatch<Chat>) => Promise<void>>()
      .mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const queue = new SessionSaveQueue(commit, vi.fn());
    queue.put({ id: "a", content: "partial" });
    const initial = queue.flush();
    queue.put({ id: "a", content: "finished" });
    const closingWindow = queue.flush();
    finish();
    expect(await initial).toBe(true);
    expect(await closingWindow).toBe(true);
    expect(commit.mock.calls[commit.mock.calls.length - 1]?.[0].puts).toEqual([{ id: "a", content: "finished" }]);
    expect(queue.hasPending()).toBe(false);
    queue.dispose();
  });
});
