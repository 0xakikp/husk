// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sentry = typeof import("@sentry/react");
type Options = NonNullable<Parameters<Sentry["init"]>[0]>;
const KEY = "husk:sentry-enabled";
let dispose: (() => void) | undefined;

beforeEach(() => {
  vi.resetModules();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  vi.stubGlobal("__APP_VERSION__", "fixture");
});
afterEach(() => {
  dispose?.(); dispose = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function fixture(initial: boolean | null = true, delayed = false) {
  if (initial !== null) localStorage.setItem(KEY, String(initial));
  const consent = await import("./crashReporting");
  const clients: { options: Options; close: ReturnType<typeof vi.fn> }[] = [];
  const send = vi.fn(async () => ({}));
  const flush = vi.fn(async () => true);
  const init = vi.fn((options: Options) => {
    const client = { options, close: vi.fn(async () => true), getOptions: () => options };
    clients.push(client);
    return client;
  });
  const sdk = { init, makeFetchTransport: vi.fn(() => ({ send, flush })) } as unknown as Sentry;
  const pending: ((sdk: Sentry) => void)[] = [];
  const load = vi.fn(() => delayed ? new Promise<Sentry>((resolve) => pending.push(resolve)) : Promise.resolve(sdk));
  let idle: (() => void) | undefined;
  const cancel = vi.fn();
  const schedule = vi.fn((callback: () => void) => { idle = callback; return cancel; });
  dispose = consent.initialiseCrashReporting({ load, schedule });
  const start = async () => { idle?.(); await Promise.resolve(); };
  return { consent, clients, send, flush, init, sdk, pending, load, schedule, cancel, start };
}

describe("crash reporting consent lifecycle", () => {
  it("does not even load the SDK on an opted-out launch", async () => {
    const f = await fixture(false);
    expect(f.schedule).not.toHaveBeenCalled();
    expect(f.load).not.toHaveBeenCalled();
  });

  it("preserves the legacy enabled default while deferring startup", async () => {
    const f = await fixture(null);
    expect(f.consent.getSentryEnabled()).toBe(true);
    expect(f.init).not.toHaveBeenCalled();
    await f.start();
    expect(f.init).toHaveBeenCalledOnce();
  });

  it("cancels idle startup and rechecks consent even if the cancelled callback runs", async () => {
    const f = await fixture();
    f.consent.setSentryEnabled(false);
    expect(f.cancel).toHaveBeenCalledOnce();
    await f.start();
    expect(f.load).not.toHaveBeenCalled();
  });

  it("ignores an import that resolves after opt-out", async () => {
    const f = await fixture(true, true);
    await f.start();
    f.consent.setSentryEnabled(false);
    f.pending[0](f.sdk); await Promise.resolve();
    expect(f.init).not.toHaveBeenCalled();
  });

  it("does not revive cancelled startup after a later explicit enable", async () => {
    const f = await fixture();
    f.consent.setSentryEnabled(false); f.consent.setSentryEnabled(true);
    await Promise.resolve(); expect(f.init).toHaveBeenCalledOnce();
    await f.start(); expect(f.init).toHaveBeenCalledOnce();
  });

  it("fences disable/re-enable races and leaves the newest client running", async () => {
    const f = await fixture(true, true);
    await f.start();
    f.consent.setSentryEnabled(false);
    f.consent.setSentryEnabled(true);
    f.pending[1](f.sdk); await Promise.resolve();
    f.pending[0](f.sdk); await Promise.resolve();
    expect(f.init).toHaveBeenCalledOnce();
    expect(f.clients[0].close).not.toHaveBeenCalled();
  });

  it("disables synchronously, drops events and blocks new sends before async close finishes", async () => {
    const f = await fixture(); await f.start();
    const options = f.clients[0].options;
    const transport = options.transport!({} as never);
    await transport.send([{}, []]); expect(f.send).toHaveBeenCalledOnce();
    f.clients[0].close.mockReturnValue(new Promise(() => {}));
    f.consent.setSentryEnabled(false);
    expect(options.enabled).toBe(false);
    expect(options.beforeSend!({ type: undefined, message: "fixture" }, {})).toBeNull();
    await transport.send([{}, []]);
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.clients[0].close).toHaveBeenCalledWith(1);
  });

  it("does not revive the old transport after re-enabling", async () => {
    const f = await fixture(); await f.start();
    const oldTransport = f.clients[0].options.transport!({} as never);
    f.consent.setSentryEnabled(false); f.consent.setSentryEnabled(true);
    await Promise.resolve();
    await oldTransport.send([{}, []]); expect(f.send).not.toHaveBeenCalled();
    await f.clients[1].options.transport!({} as never).send([{}, []]);
    expect(f.send).toHaveBeenCalledOnce();
  });

  it("reacts to another window's consent and does not write it back", async () => {
    const f = await fixture(); await f.start();
    const subscriber = vi.fn(); const unsubscribe = f.consent.subscribeSentryEnabled(subscriber);
    localStorage.setItem(KEY, "false");
    const write = vi.spyOn(localStorage, "setItem");
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));
    expect(f.consent.getSentryEnabled()).toBe(false);
    expect(f.clients[0].options.enabled).toBe(false);
    expect(subscriber).toHaveBeenCalledOnce(); expect(write).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("checks shared storage at send time before the other window's event arrives", async () => {
    const f = await fixture(); await f.start();
    const transport = f.clients[0].options.transport!({} as never);
    localStorage.setItem(KEY, "false");
    await transport.send([{}, []]);
    expect(f.send).not.toHaveBeenCalled();
  });

  it("disables when storage is cleared instead of restoring the startup default", async () => {
    const f = await fixture(); await f.start();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(f.consent.getSentryEnabled()).toBe(false);
    expect(f.clients[0].options.enabled).toBe(false);
  });

  it("still disables locally if saving the privacy choice fails", async () => {
    const f = await fixture(); await f.start();
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(f.consent.setSentryEnabled(false)).toBe(false);
    expect(f.consent.getSentryEnabled()).toBe(false);
    expect(f.clients[0].options.enabled).toBe(false);
  });

  it("fails closed when consent storage cannot be read", async () => {
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    const f = await fixture(); await f.start();
    expect(f.consent.getSentryEnabled()).toBe(false);
    expect(f.load).not.toHaveBeenCalled();
  });

  it("does not enable reporting if the choice cannot be saved", async () => {
    const f = await fixture(false);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(f.consent.setSentryEnabled(true)).toBe(false);
    expect(f.consent.getSentryEnabled()).toBe(false); expect(f.load).not.toHaveBeenCalled();
  });

  it("removes sensitive browser context and does not enable sessions or breadcrumbs", async () => {
    const f = await fixture(); await f.start();
    const options = f.clients[0].options;
    expect(options.sendDefaultPii).toBe(false); expect(options.sendClientReports).toBe(false);
    expect(options.maxBreadcrumbs).toBe(0);
    const beforeSend = options.beforeSend!;
    expect(beforeSend({ type: undefined, message: "fixture", user: { email: "fixture@example.invalid" }, request: { url: "/private" }, extra: { token: "fixture" }, breadcrumbs: [{ message: "private" }] }, {})).toEqual({ type: undefined, message: "fixture" });
    const integrations = options.integrations as (defaults: { name: string }[]) => { name: string }[];
    expect(integrations(["GlobalHandlers", "Breadcrumbs", "BrowserSession", "HttpContext", "Dedupe"].map(name => ({ name })))).toEqual([{ name: "GlobalHandlers" }, { name: "Dedupe" }]);
  });

  it("cleans up listeners and does not start after disposing an in-flight import", async () => {
    const f = await fixture(true, true); await f.start();
    dispose!(); dispose = undefined;
    f.pending[0](f.sdk); await Promise.resolve();
    expect(f.init).not.toHaveBeenCalled();
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: "false" }));
    expect(f.consent.getSentryEnabled()).toBe(true);
  });
});
