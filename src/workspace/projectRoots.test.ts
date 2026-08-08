import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  vi.resetModules();
});

afterEach(() => vi.unstubAllGlobals());

describe("project roots", () => {
  it("uses the deepest saved root for a workspace path", async () => {
    const roots = await import("./projectRoots");
    roots.addProjectRoot("/work");
    roots.addProjectRoot("/work/husk");

    expect(roots.findProjectRoot("/work/husk/src/App.tsx")).toBe("/work/husk");
    expect(roots.findProjectRoot("/workbench/app")).toBeNull();
  });

  it("persists pinned roots and removes them cleanly", async () => {
    const roots = await import("./projectRoots");
    roots.addProjectRoot("/work/husk");
    roots.addProjectRoot("/work/husk");
    expect(roots.getProjectRoots()).toEqual(["/work/husk"]);

    vi.resetModules();
    const reloaded = await import("./projectRoots");
    expect(reloaded.getProjectRoots()).toEqual(["/work/husk"]);

    reloaded.removeProjectRoot("/work/husk");
    expect(reloaded.getProjectRoots()).toEqual([]);
  });
});
