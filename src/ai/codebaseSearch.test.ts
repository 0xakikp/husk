import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "../fs";

vi.mock("../fs", () => ({
  readDir: vi.fn(), readFile: vi.fn(),
  readDirScoped: vi.fn(), readFileScoped: vi.fn(),
}));
import { readDir, readDirScoped, readFile, readFileScoped } from "../fs";
import { buildCodebaseIndex, clearCodebaseIndex, formatSearchResults, searchCodebase } from "./codebaseSearch";

function entry(name: string, dir = false): DirEntry { return { name, path: `/untrusted-entry-path/${name}`, is_dir: dir }; }

beforeEach(() => clearCodebaseIndex());

describe("scoped AI workspace search", () => {
  it("uses native-scoped reads throughout and excludes rejected symlink targets", async () => {
    vi.mocked(readDirScoped).mockImplementation(async (path) => {
      if (path === "/workspace") return [entry("normal.ts"), entry("linked.txt"), entry("outside-link", true), entry("../outside-secret.txt")];
      throw new Error("Symlink directory escapes the workspace");
    });
    vi.mocked(readFileScoped).mockImplementation(async (path) => {
      if (path === "/workspace/normal.ts") return "export const publicGreeting = 'hello';";
      throw new Error("Symlink target is outside the workspace");
    });
    const index = await buildCodebaseIndex("/workspace");
    expect([...index.keys()]).toEqual(["normal.ts"]);
    expect(readDirScoped).toHaveBeenCalledWith("/workspace", "/workspace");
    expect(readDirScoped).toHaveBeenCalledWith("/workspace/outside-link", "/workspace");
    expect(readFileScoped).toHaveBeenCalledWith("/workspace/linked.txt", "/workspace", 500_000);
    expect(vi.mocked(readFileScoped).mock.calls.every(([path, root]) => path.startsWith("/workspace/") && root === "/workspace")).toBe(true);
    expect(formatSearchResults(searchCodebase("outside-secret", 10, index))).toBe("No matching files found in the codebase.");
    expect(readFile).not.toHaveBeenCalled();
    expect(readDir).not.toHaveBeenCalled();
  });

  it("keeps concurrent workspace searches on their own immutable index snapshots", async () => {
    let resumeA!: () => void;
    let announceA!: () => void;
    const readingA = new Promise<void>((resolve) => { announceA = resolve; });
    const suspendedA = new Promise<void>((resolve) => { resumeA = resolve; });
    vi.mocked(readDirScoped).mockResolvedValue([entry("notes.txt")]);
    vi.mocked(readFileScoped).mockImplementation(async (_path, root) => {
      if (root === "/project-a") { announceA(); await suspendedA; return "confidential alpha content"; }
      return "confidential beta content";
    });
    const pendingA = buildCodebaseIndex("/project-a");
    await readingA;
    const snapshotB = await buildCodebaseIndex("/project-b");
    resumeA();
    const snapshotA = await pendingA;
    expect(snapshotA).not.toBe(snapshotB);
    expect(searchCodebase("beta", 10, snapshotA)).toEqual([]);
    expect(searchCodebase("alpha", 10, snapshotB)).toEqual([]);
    expect(searchCodebase("alpha", 10, snapshotA)[0].snippet).toContain("alpha");
    expect(searchCodebase("beta", 10, snapshotB)[0].snippet).toContain("beta");
  });

  it("checks cancellation after a read instead of returning a partial completed search", async () => {
    const controller = new AbortController();
    vi.mocked(readDirScoped).mockResolvedValue([entry("first.txt"), entry("second.txt")]);
    vi.mocked(readFileScoped).mockImplementation(async () => { controller.abort(); return "partial content"; });
    await expect(buildCodebaseIndex("/workspace", { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(readFileScoped).toHaveBeenCalledTimes(1);
  });

  it("omits oversized reads and credential file names from the search snapshot", async () => {
    vi.mocked(readDirScoped).mockResolvedValue([entry("large.txt"), entry(".env.local"), entry("normal.ts")]);
    vi.mocked(readFileScoped).mockImplementation(async (path) => path.endsWith("large.txt") ? "x".repeat(500_001) : "safe normal content");
    const index = await buildCodebaseIndex("/workspace");
    expect([...index.keys()]).toEqual(["normal.ts"]);
    expect(vi.mocked(readFileScoped).mock.calls.some(([path]) => path.endsWith(".env.local"))).toBe(false);
  });
});
