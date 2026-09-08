// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

vi.mock("../toast/store", () => ({ toast: vi.fn(() => "storage-toast"), dismissToast: vi.fn() }));
const nativeWindow = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  close: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  close: nativeWindow.close,
  onCloseRequested: async (listener: typeof nativeWindow.listener) => { nativeWindow.listener = listener; return () => {}; },
}) }));

const LEGACY_KEY = "huskv2.ai.sessions.v1";

function oldArchive() {
  return JSON.stringify({
    sessions: [{
      id: "history", name: "My chat", source: "ai-tab", input: "unsent draft", createdAt: 1, updatedAt: 2,
      messages: [{ role: "assistant", content: "Partial but saved", streaming: true }],
    }],
    activeSessionId: "history",
  });
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal("indexedDB", new IDBFactory());
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  nativeWindow.listener = undefined;
});

describe("session archive migration and recovery", () => {
  it("migrates existing history, saves drafts and images, and reloads committed conversations", async () => {
    localStorage.setItem(LEGACY_KEY, oldArchive());
    const first = await import("./sessionStore");
    expect(await first.initialiseSessionPersistence()).toBe(true);
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(first.getSession("history").messages[0].streaming).toBe(false);
    first.appendSessionMessage("history", { role: "user", content: "inspect screenshot", images: [{ dataUrl: "data:image/png;base64,abc", mediaType: "image/png" }] });
    first.setSessionInput("history", "next question");
    expect(await first.flushSessionPersistence()).toBe(true);
    vi.resetModules();
    const reloaded = await import("./sessionStore");
    expect(await reloaded.initialiseSessionPersistence()).toBe(true);
    expect(reloaded.getActiveSessionId()).toBe("history");
    expect(reloaded.getSession("history").input).toBe("next question");
    expect(reloaded.getSession("history").messages[1]).toMatchObject({ id: expect.any(String), role: "user", images: [{ dataUrl: "data:image/png;base64,abc", mediaType: "image/png" }] });
  });

  it("retains the legacy archive on a failed migration and lets Retry save finish it", async () => {
    const original = oldArchive();
    localStorage.setItem(LEGACY_KEY, original);
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("disk is full", "QuotaExceededError"); });
    const store = await import("./sessionStore");
    expect(await store.initialiseSessionPersistence()).toBe(false);
    expect(localStorage.getItem(LEGACY_KEY)).toBe(original);
    expect(store.getSessionStorageStatus().state).toBe("error");
    const { toast } = await import("../toast/store");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Chat changes have not been saved", duration: 0, action: expect.objectContaining({ label: "Retry save" }) }));
    put.mockRestore();
    expect(await store.flushSessionPersistence()).toBe(true);
    expect(store.getSessionStorageStatus().state).toBe("saved");
    vi.resetModules();
    const reloaded = await import("./sessionStore");
    expect(await reloaded.initialiseSessionPersistence()).toBe(true);
    expect(reloaded.getSession("history").messages[0].content).toBe("Partial but saved");
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
  });

  it("does not restore a deleted chat from a late request callback or the migration backup", async () => {
    localStorage.setItem(LEGACY_KEY, oldArchive());
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    store.deleteSession("history");
    expect(store.updateExistingSession("history", (session) => ({ ...session, input: "late callback" }))).toBe(false);
    await store.flushSessionPersistence();
    localStorage.setItem(LEGACY_KEY, oldArchive());
    vi.resetModules();
    const reloaded = await import("./sessionStore");
    await reloaded.initialiseSessionPersistence();
    expect(reloaded.getAllSessions().some((session) => session.id === "history")).toBe(false);
    expect(reloaded.getActiveSessionId()).toBe("global");
  });

  it("awaits the final save on native close and does not recursively intercept the completed close", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    store.setSessionInput("global", "last unsaved draft");
    const requested = { preventDefault: vi.fn() };
    const completed = { preventDefault: vi.fn() };
    nativeWindow.close.mockImplementationOnce(async () => { await nativeWindow.listener!(completed); });
    await nativeWindow.listener!(requested);
    expect(requested.preventDefault).toHaveBeenCalledOnce();
    expect(nativeWindow.close).toHaveBeenCalledOnce();
    expect(completed.preventDefault).not.toHaveBeenCalled();
    expect(store.hasUnsavedSessions()).toBe(false);
  });

  it("keeps the native window open when its final save fails", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    store.setSessionInput("global", "must not lose this draft");
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    const requested = { preventDefault: vi.fn() };
    await nativeWindow.listener!(requested);
    expect(requested.preventDefault).toHaveBeenCalledOnce();
    expect(nativeWindow.close).not.toHaveBeenCalled();
    expect(store.hasUnsavedSessions()).toBe(true);
    put.mockRestore();
    expect(await store.flushSessionPersistence()).toBe(true);
  });
});
