import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirEntry } from "../fs";

vi.mock("../fs", () => ({
  readDir: vi.fn(), readFile: vi.fn(),
  readDirScoped: vi.fn(), readFileScoped: vi.fn(),
}));
import { readDir, readDirScoped, readFile, readFileScoped } from "../fs";
import { buildCodebaseIndex, clearCodebaseIndex, formatSearchResults, searchCodebase, getCodebaseCoverage, getCodebaseIndex, isCodebaseIndexFresh, subscribeCodebaseInvalidation } from "./codebaseSearch";
import { onFileChanged, onRepositoryFilesChanged } from "../editor/fileChanges";

function entry(name: string, dir = false): DirEntry { return { name, path: `/untrusted-entry-path/${name}`, is_dir: dir }; }

beforeEach(() => clearCodebaseIndex());
afterEach(() => vi.useRealTimers());

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
    expect(getCodebaseCoverage(index)).toEqual(expect.objectContaining({ partial: true, indexedFiles: 1, skippedFiles: 1 }));
  });

  it("ignores exact generated directories without excluding source filenames containing those words", async () => {
    vi.mocked(readDirScoped).mockResolvedValue([
      entry("environment.ts"), entry("distribution.ts"), entry("buildPipeline.ts"), entry("targetParser.ts"),
      entry("dist", true), entry("env", true), entry("node_modules", true), entry(".env.local", true),
    ]);
    vi.mocked(readFileScoped).mockResolvedValue("export const value = 'searchable';");
    const snapshot = await buildCodebaseIndex("/workspace");
    expect([...snapshot.keys()]).toEqual(["environment.ts", "distribution.ts", "buildPipeline.ts", "targetParser.ts"]);
    expect(readDirScoped).toHaveBeenCalledTimes(1);
    expect(getCodebaseCoverage(snapshot)?.partial).toBe(false);
  });

  it("invalidates relevant file and repository changes, but leaves other workspaces alone", async () => {
    vi.mocked(readDirScoped).mockResolvedValue([entry("normal.ts")]);
    vi.mocked(readFileScoped).mockResolvedValue("before");
    await buildCodebaseIndex("/workspace");
    const changed = vi.fn(); const unsubscribe = subscribeCodebaseInvalidation(changed);
    try {
      onFileChanged("/workspace-other/normal.ts");
      expect(isCodebaseIndexFresh("/workspace")).toBe(true);
      expect(changed).not.toHaveBeenCalled();
      onFileChanged("/workspace/normal.ts");
      expect(getCodebaseIndex()).toBeNull(); expect(changed).toHaveBeenCalledTimes(1);
      await buildCodebaseIndex("/workspace");
      onRepositoryFilesChanged("/workspace");
      expect(getCodebaseIndex()).toBeNull(); expect(changed).toHaveBeenCalledTimes(2);
    } finally { unsubscribe(); }
  });

  it("does not publish an index built across a filesystem change", async () => {
    vi.mocked(readDirScoped).mockResolvedValue([entry("normal.ts")]);
    vi.mocked(readFileScoped).mockImplementation(async () => { onFileChanged("/workspace/normal.ts"); return "stale"; });
    await expect(buildCodebaseIndex("/workspace")).rejects.toThrow("Workspace changed");
    expect(getCodebaseIndex()).toBeNull();
  });

  it("expires cached coverage after one minute without discarding caller-owned snapshots", async () => {
    vi.mocked(readDirScoped).mockResolvedValue([entry("normal.ts")]);
    vi.mocked(readFileScoped).mockResolvedValue("snapshot");
    const snapshot = await buildCodebaseIndex("/workspace");
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 60_001);
    expect(isCodebaseIndexFresh("/workspace")).toBe(false);
    expect(searchCodebase("snapshot", 10, snapshot)).toHaveLength(1);
  });
});
