// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";

vi.mock("../toast/store", () => ({ toast: vi.fn(() => "storage-toast"), dismissToast: vi.fn() }));
const nativeWindow = vi.hoisted(() => ({
  listener: undefined as undefined | ((event: { event: string; id: number }) => Promise<void>),
  handler: undefined as undefined | ((event: { preventDefault: () => void }) => Promise<void>),
  close: vi.fn(async () => {}),
  destroy: vi.fn(async () => { throw "Command plugin:window|destroy not allowed by ACL"; }),
  unlisten: vi.fn(async () => {}),
  registrations: 0,
  closed: false,
  events: [] as string[],
}));
vi.mock("@tauri-apps/api/window", async () => {
  const sdk = await vi.importActual<typeof import("@tauri-apps/api/window")>("@tauri-apps/api/window");
  const fixture = {
    close: nativeWindow.close,
    destroy: nativeWindow.destroy,
    listen: async (_event: string, callback: NonNullable<typeof nativeWindow.listener>) => {
      nativeWindow.registrations++;
      nativeWindow.listener = callback;
      return async () => {
        await nativeWindow.unlisten();
        if (nativeWindow.listener === callback) nativeWindow.listener = undefined;
      };
    },
    onCloseRequested: async (handler: NonNullable<typeof nativeWindow.handler>) => {
      nativeWindow.handler = handler;
      // Use the installed SDK wrapper: an unprevented handler implicitly calls
      // destroy(), reproducing the actual ACL rejection rather than hiding it.
      return sdk.Window.prototype.onCloseRequested.call(fixture as unknown as InstanceType<typeof sdk.Window>, handler);
    },
  };
  return { getCurrentWindow: () => fixture };
});

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
  nativeWindow.handler = undefined;
  nativeWindow.registrations = 0;
  nativeWindow.closed = false;
  nativeWindow.events = [];
  nativeWindow.unlisten.mockReset().mockImplementation(async () => { nativeWindow.events.push("unlisten"); });
  nativeWindow.destroy.mockReset().mockImplementation(async () => { throw "Command plugin:window|destroy not allowed by ACL"; });
  nativeWindow.close.mockReset().mockImplementation(async () => {
    nativeWindow.events.push("close");
    if (nativeWindow.listener) await nativeWindow.listener({ event: "tauri://close-requested", id: 2 });
    else nativeWindow.closed = true;
  });
});

async function emitClose() {
  expect(nativeWindow.listener).toBeDefined();
  await nativeWindow.listener!({ event: "tauri://close-requested", id: 1 });
}

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

  it("awaits the final save, removes the SDK guard and closes without forbidden destroy", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    store.setSessionInput("global", "last unsaved draft");
    await emitClose();
    expect(nativeWindow.close).toHaveBeenCalledOnce();
    expect(nativeWindow.events).toEqual(["unlisten", "close"]);
    expect(nativeWindow.closed).toBe(true);
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(store.hasUnsavedSessions()).toBe(false);
  });

  it("keeps the native window open when its final save fails", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    store.setSessionInput("global", "must not lose this draft");
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    await emitClose();
    expect(nativeWindow.close).not.toHaveBeenCalled();
    expect(nativeWindow.unlisten).not.toHaveBeenCalled();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(nativeWindow.listener).toBeDefined();
    expect(store.hasUnsavedSessions()).toBe(true);
    const { toast } = await import("../toast/store");
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Chat changes have not been saved", action: expect.objectContaining({ label: "Retry save" }) }));
    put.mockRestore();
    expect(await store.flushSessionPersistence()).toBe(true);
  });

  it("also prevents implicit SDK destruction when no chat changes need saving", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    expect(store.hasUnsavedSessions()).toBe(false);
    await emitClose();
    expect(nativeWindow.closed).toBe(true);
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(nativeWindow.events).toEqual(["unlisten", "close"]);
  });

  it("prevents duplicate close requests synchronously and waits for native unsubscription", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    let release!: () => void;
    nativeWindow.unlisten.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    const firstEvent = { preventDefault: vi.fn() };
    const first = nativeWindow.handler!(firstEvent);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(release).toBeDefined());
    const duplicate = { preventDefault: vi.fn() };
    await nativeWindow.handler!(duplicate);
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(nativeWindow.close).not.toHaveBeenCalled();
    release(); await first;
    expect(nativeWindow.close).toHaveBeenCalledOnce();
    expect(nativeWindow.destroy).not.toHaveBeenCalled();
  });

  it("saves changes arriving during native unsubscription before allowing close", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    nativeWindow.unlisten.mockImplementationOnce(async () => { store.setSessionInput("global", "arrived during close"); });
    await emitClose();
    expect(nativeWindow.closed).toBe(true); expect(store.hasUnsavedSessions()).toBe(false);
    vi.resetModules();
    const reloaded = await import("./sessionStore");
    await reloaded.initialiseSessionPersistence();
    expect(reloaded.getSession("global").input).toBe("arrived during close");
  });

  it("restores protection when native close fails and Retry close saves later edits", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    nativeWindow.close.mockRejectedValueOnce("close transport unavailable");
    await emitClose();
    expect(nativeWindow.listener).toBeDefined(); expect(nativeWindow.registrations).toBe(2);
    expect(nativeWindow.closed).toBe(false); expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(store.getSessionStorageStatus().state).toBe("saved");
    const { toast } = await import("../toast/store");
    const notice = vi.mocked(toast).mock.calls.map(([value]) => value).find((value) => value.title === "Husk could not close");
    expect(notice?.action?.label).toBe("Retry close");
    store.setSessionInput("global", "typed after failed close");
    notice!.action!.onClick();
    await vi.waitFor(() => expect(nativeWindow.closed).toBe(true));
    expect(store.hasUnsavedSessions()).toBe(false);
    expect(nativeWindow.close).toHaveBeenCalledTimes(2);
  });

  it("restores the close guard if saving edits arriving during unsubscribe fails", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    nativeWindow.unlisten.mockImplementationOnce(async () => { store.setSessionInput("global", "late draft must survive"); });
    const put = vi.spyOn(IDBObjectStore.prototype, "put").mockImplementationOnce(() => { throw new DOMException("full", "QuotaExceededError"); });
    await emitClose();
    expect(nativeWindow.close).not.toHaveBeenCalled(); expect(nativeWindow.destroy).not.toHaveBeenCalled();
    expect(nativeWindow.listener).toBeDefined(); expect(nativeWindow.registrations).toBe(2);
    expect(store.hasUnsavedSessions()).toBe(true);
    put.mockRestore();
    await emitClose();
    expect(nativeWindow.closed).toBe(true); expect(store.hasUnsavedSessions()).toBe(false);
  });

  it("retains failed listener removals for retry and never closes with a live guard", async () => {
    Object.assign(window, { __TAURI_INTERNALS__: {} });
    const store = await import("./sessionStore");
    await store.initialiseSessionPersistence();
    await vi.waitFor(() => expect(nativeWindow.listener).toBeDefined());
    nativeWindow.unlisten.mockRejectedValueOnce("could not remove close listener");
    await emitClose();
    expect(nativeWindow.close).not.toHaveBeenCalled();
    expect(nativeWindow.listener).toBeDefined(); expect(nativeWindow.registrations).toBe(2);
    await emitClose();
    expect(nativeWindow.unlisten).toHaveBeenCalledTimes(3);
    expect(nativeWindow.closed).toBe(true); expect(nativeWindow.destroy).not.toHaveBeenCalled();
  });
});
