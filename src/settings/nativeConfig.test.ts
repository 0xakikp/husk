import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HuskConfigDocument, ConfigPatch } from "./nativeConfig";

type Saved = { path: string; document: HuskConfigDocument; revision: number };
const fixture = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: [] as ((event: { payload: Saved }) => void)[],
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: fixture.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, listener: (event: { payload: Saved }) => void) => {
    fixture.listeners.push(listener);
    return () => {};
  }),
}));

const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const defaults = (): HuskConfigDocument => ({ config_version: 1,
  preferences: { terminalFontSize: 13, editorFontSize: 13, background: { path: "old.png", opacity: 100, blur: 0 } },
  ai: { model: "old-model" }, mcp: {}, appearance_presets: {},
});
let disk: HuskConfigDocument;
let diskRevision: number;
const saved = (): Saved => ({ path: "/fixture/config.toml", document: copy(disk), revision: diskRevision });
const broadcast = (value: Saved) => fixture.listeners.forEach((listener) => listener({ payload: copy(value) }));
function apply(patches: ConfigPatch[]) {
  for (const patch of patches) {
    let parent = disk as unknown as Record<string, unknown>;
    for (const key of patch.path.slice(0, -1)) {
      if (!parent[key]) parent[key] = {};
      parent = parent[key] as Record<string, unknown>;
    }
    const key = patch.path[patch.path.length - 1];
    if (patch.value === undefined) delete parent[key]; else parent[key] = copy(patch.value);
  }
  diskRevision++;
  return saved();
}
async function windowModule() {
  vi.resetModules();
  const config = await import("./nativeConfig");
  await config.initialiseNativeConfig({ ...saved(), exists: true, error: null }, defaults());
  return config;
}
beforeEach(() => {
  vi.useFakeTimers();
  disk = defaults(); diskRevision = 0; fixture.listeners = [];
  fixture.invoke.mockReset();
  fixture.invoke.mockImplementation(async (command: string, args?: { patches: ConfigPatch[]; document: HuskConfigDocument }) => {
    if (command === "config_load") return { ...saved(), exists: true, error: null };
    if (command === "config_save") return saved();
    if (command === "config_patch") { const result = apply(args!.patches); broadcast(result); return result; }
    throw new Error("Unexpected command: " + command);
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("native settings coordination", () => {
  it("does not write clean documents on flush or visibility flush", async () => {
    const config = await windowModule();
    await config.flushNativeConfig();
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(config.getNativeConfigStatus()).toMatchObject({ ready: true, phase: "saved", dirty: false, saving: false });
  });

  it("writes only edited leaves, retaining concurrent sections and nested fields", async () => {
    const first = await windowModule();
    const second = await windowModule();
    first.persistNativeConfigSection("preferences", { ...disk.preferences, terminalFontSize: 18 });
    second.persistNativeConfigSection("preferences", { ...disk.preferences, background: { path: "new.png", opacity: 100, blur: 0 } });
    second.persistNativeConfigSection("ai", { model: "new-model" });
    await first.flushNativeConfig();
    await second.flushNativeConfig();
    expect(disk.preferences).toMatchObject({ terminalFontSize: 18, background: { path: "new.png", opacity: 100 } });
    expect(disk.ai.model).toBe("new-model");
    expect(first.getNativeConfigSnapshot()).toEqual(second.getNativeConfigSnapshot());
    expect(fixture.invoke.mock.calls.filter(([command]) => command === "config_patch").map(([, args]) => args.patches)).toEqual([
      [{ path: ["preferences", "terminalFontSize"], value: 18 }],
      [{ path: ["preferences", "background", "path"], value: "new.png" }, { path: ["ai", "model"], value: "new-model" }],
    ]);
  });

  it("diffs against the caller's actual previous state after a browser storage event", async () => {
    const config = await windowModule();
    const runtime = { ...disk.preferences, terminalFontSize: 18 };
    // Another window's browser mirror arrives before its durable notification.
    config.persistNativeConfigSection("preferences", { ...runtime, editorFontSize: 16 }, runtime);
    disk.preferences.terminalFontSize = 18;
    await config.flushNativeConfig();
    expect(fixture.invoke).toHaveBeenCalledWith("config_patch", { patches: [{ path: ["preferences", "editorFontSize"], value: 16 }] });
    expect(disk.preferences).toMatchObject({ terminalFontSize: 18, editorFontSize: 16 });
  });

  it("retains local pending changes while rebasing an external update", async () => {
    const config = await windowModule();
    const listener = vi.fn(); config.subscribeNativeConfigDocument(listener);
    config.persistNativeConfigSection("preferences", { ...disk.preferences, terminalFontSize: 18 });
    disk.preferences.editorFontSize = 20; diskRevision++;
    broadcast(saved());
    expect(config.getNativeConfigSnapshot()?.preferences).toMatchObject({ terminalFontSize: 18, editorFontSize: 20 });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ preferences: expect.objectContaining({ terminalFontSize: 18, editorFontSize: 20 }) }));
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "dirty", dirty: true });
    await config.flushNativeConfig();
    expect(disk.preferences).toMatchObject({ terminalFontSize: 18, editorFontSize: 20 });
  });

  it("does not resurrect in-flight values when an older reply follows a newer event", async () => {
    const config = await windowModule();
    let resolve!: (saved: Saved) => void;
    let older!: Saved;
    fixture.invoke.mockImplementationOnce(async (_command, args) => {
      older = apply(args.patches);
      return new Promise<Saved>((done) => { resolve = done; });
    });
    config.persistNativeConfigSection("preferences", { ...disk.preferences, terminalFontSize: 18 });
    const flushing = config.flushNativeConfig();
    await Promise.resolve();
    disk.preferences.terminalFontSize = 20; diskRevision++;
    broadcast(saved());
    resolve(older);
    await flushing;
    expect(config.getNativeConfigSnapshot()?.preferences.terminalFontSize).toBe(20);
    expect(config.getNativeConfigStatus().phase).toBe("saved");
  });

  it("waits for edits made during a write and reports saving until all finish", async () => {
    const config = await windowModule();
    let resolve!: (saved: Saved) => void;
    fixture.invoke.mockImplementationOnce((_command, args) => new Promise<Saved>((done) => { resolve = done; apply(args.patches); }));
    config.persistNativeConfigSection("ai", { model: "first" });
    const flushing = config.flushNativeConfig();
    await Promise.resolve();
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "saving", dirty: true, saving: true });
    config.persistNativeConfigSection("ai", { model: "second" });
    resolve(saved());
    await flushing;
    expect(disk.ai.model).toBe("second");
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "saved", dirty: false, saving: false });
  });

  it("retains edits and rejects on save failure, then retries safely", async () => {
    const config = await windowModule();
    config.persistNativeConfigSection("ai", { model: "new" });
    fixture.invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(config.flushNativeConfig()).rejects.toThrow("disk full");
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "error", dirty: true, saving: false });
    expect(config.getNativeConfigSnapshot()?.ai.model).toBe("new");
    disk.preferences.terminalFontSize = 18; diskRevision++;
    await config.retryNativeConfig();
    expect(disk.ai.model).toBe("new");
    expect(disk.preferences.terminalFontSize).toBe(18);
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "saved", error: null, dirty: false });
  });

  it("keeps malformed files untouched and retains edits until repaired", async () => {
    vi.resetModules(); const config = await import("./nativeConfig");
    await config.initialiseNativeConfig({ path: "/fixture/config.toml", exists: true, error: "invalid TOML", document: null }, defaults());
    config.persistNativeConfigSection("ai", { model: "pending" });
    await expect(config.flushNativeConfig()).rejects.toThrow("invalid TOML");
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(config.getNativeConfigStatus()).toMatchObject({ ready: false, dirty: true, phase: "error" });
    await config.retryNativeConfig();
    expect(disk.ai.model).toBe("pending");
  });

  it("adopts the winner when two windows initialize a new file", async () => {
    vi.resetModules(); const config = await import("./nativeConfig");
    disk.preferences.terminalFontSize = 20;
    const result = await config.initialiseNativeConfig({ path: "/fixture/config.toml", exists: false, error: null, document: null }, defaults());
    expect(result.preferences.terminalFontSize).toBe(20);
    expect(config.getNativeConfigSnapshot()).toEqual(disk);
  });

  it("captures updates between the initial read and startup hydration", async () => {
    vi.resetModules(); const config = await import("./nativeConfig");
    const initial = await config.readNativeConfig();
    disk.preferences.terminalFontSize = 20; diskRevision++;
    broadcast(saved());
    const result = await config.initialiseNativeConfig(initial, defaults());
    expect(result.preferences.terminalFontSize).toBe(20);
  });

  it("uses the explicit import baseline across async preparation and foreign updates", async () => {
    const config = await windowModule();
    const before = await config.readLatestNativeConfig();
    const imported = { ...before.preferences, editorFontSize: 16 };
    disk.preferences.terminalFontSize = 20; diskRevision++;
    broadcast(saved());
    await config.applyNativeConfigSections({ preferences: imported }, before);
    expect(disk.preferences).toMatchObject({ editorFontSize: 16, terminalFontSize: 20 });
  });

  it("coalesces long slider bursts into one native edit", async () => {
    const config = await windowModule();
    for (let i = 0; i < 3000; i++) config.persistNativeConfigSection("preferences", { ...config.getNativeConfigSnapshot()!.preferences, terminalFontSize: 12 + i % 8 });
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    expect(fixture.invoke.mock.calls[0][1].patches).toHaveLength(1);
  });

  it("atomically flushes import sections and provides an isolated latest snapshot", async () => {
    const config = await windowModule();
    await config.applyNativeConfigSections({ ai: { model: "imported" }, preferences: { ...disk.preferences, editorFontSize: 16 } });
    expect(fixture.invoke).toHaveBeenCalledTimes(1);
    const result = await config.readLatestNativeConfig();
    result.preferences.editorFontSize = 99;
    expect(config.getNativeConfigSnapshot()?.preferences.editorFontSize).toBe(16);
  });

  it("publishes explicit form changes only after a successful native commit", async () => {
    const config = await windowModule();
    const listener = vi.fn(); config.subscribeNativeConfigDocument(listener);
    let resolve!: (saved: Saved) => void;
    fixture.invoke.mockImplementationOnce((_command, args) => new Promise<Saved>((done) => { resolve = done; apply(args.patches); }));
    const operation = config.commitNativeConfigSections({ ai: { model: "draft" } });
    await Promise.resolve(); await Promise.resolve();
    expect(config.getNativeConfigSnapshot()?.ai.model).toBe("old-model");
    expect(listener).not.toHaveBeenCalled();
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "saving", dirty: false });
    resolve(saved());
    await operation;
    expect(config.getNativeConfigSnapshot()?.ai.model).toBe("draft");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("never queues a failed explicit draft for later flush", async () => {
    const config = await windowModule();
    fixture.invoke.mockRejectedValueOnce(new Error("disk full"));
    await expect(config.commitNativeConfigSections({ ai: { model: "discard this draft" } })).rejects.toThrow("disk full");
    expect(config.getNativeConfigSnapshot()?.ai.model).toBe("old-model");
    expect(config.getNativeConfigStatus()).toMatchObject({ phase: "saved", dirty: false, error: null });
    await config.flushNativeConfig();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fixture.invoke).toHaveBeenCalledOnce();
    config.persistNativeConfigSection("preferences", { ...disk.preferences, editorFontSize: 16 });
    await config.flushNativeConfig();
    expect(disk.ai.model).toBe("old-model");
  });

  it("flushes live edits created during an explicit save before close can finish", async () => {
    const config = await windowModule();
    let resolve!: (saved: Saved) => void;
    fixture.invoke.mockImplementationOnce((_command, args) => new Promise<Saved>((done) => { resolve = done; apply(args.patches); }));
    const explicit = config.commitNativeConfigSections({ ai: { model: "draft" } });
    await Promise.resolve(); await Promise.resolve();
    config.persistNativeConfigSection("preferences", { ...disk.preferences, editorFontSize: 16 });
    const close = config.flushNativeConfig();
    resolve(saved());
    await explicit; await close;
    expect(disk.preferences.editorFontSize).toBe(16);
    expect(config.getNativeConfigStatus().dirty).toBe(false);
  });
});
