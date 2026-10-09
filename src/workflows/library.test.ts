// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";

const KEY = "huskv2.workflow-library.v1";
const empty = () => ({ version: 1, pinnedWorkflowIds: [], scripts: [], pinnedScriptIds: [] });
const linked = () => ({ id: "script_1", name: "Check environment", path: "/project/scripts/check.sh", createdAt: 100 });

beforeEach(() => {
  vi.resetModules();
  const saved = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: vi.fn((key: string) => saved.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { saved.set(key, value); }),
    removeItem: vi.fn((key: string) => { saved.delete(key); }),
    clear: vi.fn(() => { saved.clear(); }),
  });
});

it("loads a stable, immutable empty snapshot without writing any state", async () => {
  const writes = vi.spyOn(localStorage, "setItem");
  const library = await import("./library");
  const first = library.getWorkflowLibrary();
  expect(first).toEqual(empty());
  expect(library.getWorkflowLibrary()).toBe(first);
  expect(Object.isFrozen(first)).toBe(true);
  expect(Object.isFrozen(first.scripts)).toBe(true);
  expect(library.getWorkflowLibraryError()).toBeNull();
  expect(writes).not.toHaveBeenCalled();
});

it("persists pins separately from portable workflow definitions and restores them", async () => {
  localStorage.setItem("huskv2.runbooks", JSON.stringify([{ id: "wf_1", name: "One", steps: ["true"] }]));
  const originalWorkflows = localStorage.getItem("huskv2.runbooks");
  const library = await import("./library");
  library.setWorkflowPinned("wf_1", true);
  library.setWorkflowPinned("wf_1", true);
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_1"]);
  expect(localStorage.getItem("huskv2.runbooks")).toBe(originalWorkflows);
  vi.resetModules();
  const restored = await import("./library");
  expect(restored.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_1"]);
  restored.removeWorkflowPin("wf_1");
  expect(restored.getWorkflowLibrary().pinnedWorkflowIds).toEqual([]);
});

it("links only local path metadata, pins it, and removing it removes its pin", async () => {
  const library = await import("./library");
  const script = library.addLinkedScript({ name: "  Check environment  ", path: "/project/scripts/check.sh" });
  expect(script.id).toMatch(/^script_/);
  expect(script.name).toBe("Check environment");
  expect(Object.keys(script).sort()).toEqual(["createdAt", "id", "name", "path"]);
  expect(Object.isFrozen(script)).toBe(true);
  library.setScriptPinned(script.id, true);
  expect(library.getWorkflowLibrary().pinnedScriptIds).toEqual([script.id]);
  expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(library.getWorkflowLibrary());
  library.removeLinkedScript(script.id);
  expect(library.getWorkflowLibrary().scripts).toEqual([]);
  expect(library.getWorkflowLibrary().pinnedScriptIds).toEqual([]);
});

it("never copies unrecognized data or script contents into a stored link", async () => {
  const { validateWorkflowLibrary } = await import("./library");
  const result = validateWorkflowLibrary({ ...empty(), scripts: [{ ...linked(), content: "secret contents", command: "rm", cwd: "/unreviewed" }] });
  expect(result.scripts[0]).toEqual(linked());
});

it("rejects duplicate links without changing saved data", async () => {
  const library = await import("./library");
  library.addLinkedScript({ name: "Check", path: "/project/check.sh" });
  const saved = localStorage.getItem(KEY);
  expect(() => library.addLinkedScript({ name: "Same script", path: "/project/check.sh" })).toThrow("already linked");
  expect(localStorage.getItem(KEY)).toBe(saved);
  expect(library.getWorkflowLibrary().scripts).toHaveLength(1);
});

it.each(["scripts/check.sh", "~/check.sh", "https://host/check.sh", "ssh://host/check.sh", "/", "/project/", "C:check.sh", "/project/check\n.sh", "/project/check\u0000.sh"])("rejects unsafe or non-file path %j", async (path) => {
  const library = await import("./library");
  expect(() => library.addLinkedScript({ name: "Check", path })).toThrow();
  expect(localStorage.getItem(KEY)).toBeNull();
});

it.each(["/project/a script's file.sh", "C:\\project\\check.ps1", "C:/project/check.ps1", "\\\\server\\share\\check.ps1"])("preserves absolute path %j without shell expansion", async (path) => {
  const library = await import("./library");
  expect(library.addLinkedScript({ name: "Check", path }).path).toBe(path);
});

it("rejects malformed metadata and keeps the original data untouched", async () => {
  localStorage.setItem(KEY, "{broken");
  const library = await import("./library");
  expect(library.getWorkflowLibrary()).toEqual(empty());
  expect(library.getWorkflowLibraryError()).toContain("Original data is unchanged");
  expect(() => library.setWorkflowPinned("wf_1", true)).toThrow("nothing was saved");
  expect(localStorage.getItem(KEY)).toBe("{broken");
});

it("keeps the previously published state on a failed save and allows retry", async () => {
  const library = await import("./library");
  library.setWorkflowPinned("wf_1", true);
  const original = library.getWorkflowLibrary();
  const saved = localStorage.getItem(KEY);
  const writes = vi.spyOn(localStorage, "setItem").mockImplementation(() => { throw new Error("Storage quota exceeded"); });
  expect(() => library.setWorkflowPinned("wf_2", true)).toThrow("not applied");
  expect(library.getWorkflowLibrary()).toBe(original);
  expect(localStorage.getItem(KEY)).toBe(saved);
  expect(library.getWorkflowLibraryError()).toContain("Storage quota exceeded");
  writes.mockRestore();
  library.setWorkflowPinned("wf_2", true);
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_1", "wf_2"]);
  expect(library.getWorkflowLibraryError()).toBeNull();
});

it("refuses writes when storage cannot be read", async () => {
  const library = await import("./library");
  vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("Storage unavailable"); });
  const writes = vi.spyOn(localStorage, "setItem");
  expect(library.getWorkflowLibraryError()).toContain("Storage unavailable");
  expect(() => library.setWorkflowPinned("wf_1", true)).toThrow("nothing was saved");
  expect(writes).not.toHaveBeenCalled();
});

it("publishes only after local storage accepted a write", async () => {
  const library = await import("./library");
  const subscriber = vi.fn(() => { expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual(library.getWorkflowLibrary()); });
  const unsubscribe = library.subscribeWorkflowLibrary(subscriber);
  library.setWorkflowPinned("wf_1", true);
  expect(subscriber).toHaveBeenCalledTimes(1);
  unsubscribe();
  library.setWorkflowPinned("wf_2", true);
  expect(subscriber).toHaveBeenCalledTimes(1);
});

it("merges against the latest stored state even before another window's event arrives", async () => {
  const library = await import("./library");
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual([]);
  localStorage.setItem(KEY, JSON.stringify({ ...empty(), pinnedWorkflowIds: ["wf_other_window"] }));
  library.setWorkflowPinned("wf_this_window", true);
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_other_window", "wf_this_window"]);
});

it("refreshes subscribers on external changes and clears, but not unrelated storage", async () => {
  const library = await import("./library");
  library.getWorkflowLibrary();
  const listener = vi.fn();
  const unsubscribe = library.subscribeWorkflowLibrary(listener);
  localStorage.setItem(KEY, JSON.stringify({ ...empty(), pinnedWorkflowIds: ["wf_1"] }));
  window.dispatchEvent(new StorageEvent("storage", { key: "different-key" }));
  expect(listener).not.toHaveBeenCalled();
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_1"]);
  expect(listener).toHaveBeenCalledTimes(1);
  localStorage.clear();
  window.dispatchEvent(new StorageEvent("storage", { key: null }));
  expect(library.getWorkflowLibrary()).toEqual(empty());
  expect(listener).toHaveBeenCalledTimes(2);
  unsubscribe();
});

it("preserves the last valid snapshot if another window stores malformed data", async () => {
  const library = await import("./library");
  library.setWorkflowPinned("wf_1", true);
  const original = library.getWorkflowLibrary();
  localStorage.setItem(KEY, "bad data");
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(library.getWorkflowLibrary()).toBe(original);
  expect(library.getWorkflowLibraryError()).toContain("updated local workflow library");
  expect(localStorage.getItem(KEY)).toBe("bad data");
});

it("validates limits, IDs, timestamps, and dangling pins", async () => {
  const { validateWorkflowLibrary: validate } = await import("./library");
  expect(() => validate({ ...empty(), version: 2 })).toThrow("format");
  expect(() => validate({ ...empty(), pinnedWorkflowIds: ["wf_1", "wf_1"] })).toThrow("duplicate");
  expect(() => validate({ ...empty(), pinnedWorkflowIds: Array.from({ length: 501 }, (_, index) => `wf_${index}`) })).toThrow("500");
  expect(() => validate({ ...empty(), scripts: [{ ...linked(), path: "/" + "x".repeat(4096) }] })).toThrow("4096");
  expect(() => validate({ ...empty(), scripts: [{ ...linked(), name: "界".repeat(54) }] })).toThrow("160");
  expect(() => validate({ ...empty(), scripts: [{ ...linked(), createdAt: Number.NaN }] })).toThrow("timestamp");
  expect(() => validate({ ...empty(), scripts: [{ ...linked(), id: "wf_1" }] })).toThrow("script_");
  expect(() => validate({ ...empty(), pinnedScriptIds: ["script_missing"] })).toThrow("missing");
});

it("does not pin an absent or removed script", async () => {
  const library = await import("./library");
  expect(() => library.setScriptPinned("script_missing", true)).toThrow("no longer available");
  expect(localStorage.getItem(KEY)).toBeNull();
});

it("bounds aggregate storage and refuses oversize saved data before parsing", async () => {
  const library = await import("./library");
  const scripts = Array.from({ length: 500 }, (_, index) => ({
    ...linked(), id: `script_${index}`, path: `/project/${index}/${"x".repeat(2500)}`,
  }));
  expect(() => library.validateWorkflowLibrary({ ...empty(), scripts })).toThrow("1 MiB");
  localStorage.setItem(KEY, " ".repeat(1024 * 1024 + 1));
  expect(library.getWorkflowLibraryError()).toContain("1 MiB");
  expect(() => library.setWorkflowPinned("wf_1", true)).toThrow("nothing was saved");
  expect(localStorage.getItem(KEY)?.length).toBe(1024 * 1024 + 1);
});

it("reads actual external storage rather than replaying a stale event payload", async () => {
  const library = await import("./library");
  library.getWorkflowLibrary();
  localStorage.setItem(KEY, JSON.stringify({ ...empty(), pinnedWorkflowIds: ["wf_latest"] }));
  window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: JSON.stringify(empty()) }));
  expect(library.getWorkflowLibrary().pinnedWorkflowIds).toEqual(["wf_latest"]);
});
