import { beforeEach, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "/alpha" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => workspace.root }));
vi.mock("../explorer/search", async (original) => ({
  ...await original<typeof import("../explorer/search")>(), searchWorkspace: vi.fn(),
}));
vi.mock("../jobs/client", () => ({ bgList: vi.fn(async () => []) }));
vi.mock("../docker/client", () => ({ listContainers: vi.fn(async () => []) }));
vi.mock("../kubernetes/client", () => ({ listContexts: vi.fn(async () => []), currentContext: vi.fn(async () => "") }));
vi.mock("../notes/store", () => ({
  ensureNotesDirectory: vi.fn(), loadNotesTree: vi.fn(), getPinnedNotes: () => [],
  getRecentNotes: () => [], isNoteFile: () => true,
}));
vi.mock("../workflows/store", () => ({ loadWorkflows: () => [] }));

import { searchWorkspace, type WorkspaceSearchOutcome } from "../explorer/search";
import { invalidateLauncherCache, loadWorkspaceFiles, searchWorkspaceContents } from "./sources";

const outcome = (names: string[] = []): WorkspaceSearchOutcome => ({
  results: names.map((name) => ({ path: `/alpha/${name}`, rel: name, name, line: null, column: null, text: null })),
  scannedFiles: names.length, skippedFiles: 0, errors: 0, truncated: false, timedOut: false, reason: null,
});

beforeEach(() => {
  workspace.root = "/alpha";
  invalidateLauncherCache();
  vi.mocked(searchWorkspace).mockReset().mockResolvedValue(outcome());
});

it("searches the actual filename query before the result cap with a captured root and cancellation", async () => {
  const controller = new AbortController();
  vi.mocked(searchWorkspace).mockResolvedValue(outcome(["late-match.ts"]));
  workspace.root = "/beta";
  const result = await loadWorkspaceFiles("/alpha", "late-match", controller.signal);
  expect(searchWorkspace).toHaveBeenCalledWith({ root: "/alpha", query: "late-match", mode: "files", maxResults: 200, signal: controller.signal });
  expect(result.files).toEqual([{ path: "/alpha/late-match.ts", rel: "late-match.ts", name: "late-match.ts" }]);
});

it("preserves unusual filenames without line-delimited CLI parsing or whitespace trimming", async () => {
  vi.mocked(searchWorkspace).mockResolvedValue(outcome([" a:b\n雪.ts "]));
  expect((await loadWorkspaceFiles()).files[0]).toEqual({ path: "/alpha/ a:b\n雪.ts ", rel: " a:b\n雪.ts ", name: " a:b\n雪.ts " });
});

it("does not reuse a pre-query file-list cache after files change", async () => {
  vi.mocked(searchWorkspace).mockResolvedValueOnce(outcome(["before.ts"])).mockResolvedValueOnce(outcome(["after.ts"]));
  expect((await loadWorkspaceFiles()).files[0].name).toBe("before.ts");
  expect((await loadWorkspaceFiles()).files[0].name).toBe("after.ts");
  expect(searchWorkspace).toHaveBeenCalledTimes(2);
});

it("preserves every content match and exact paths from native structured results", async () => {
  const found = outcome(["a:b.ts", "a:b.ts"]);
  found.results[0] = { ...found.results[0], line: 7, column: 3, text: "  literal [text]" };
  found.results[1] = { ...found.results[1], line: 12, column: 1, text: "literal [text] again" };
  vi.mocked(searchWorkspace).mockResolvedValue(found);
  workspace.root = "/beta";
  const result = await searchWorkspaceContents("[text]", 50, "/alpha");
  expect(searchWorkspace).toHaveBeenCalledWith({ root: "/alpha", query: "[text]", mode: "contents", maxResults: 50, signal: undefined });
  expect(result.results).toEqual([
    { path: "/alpha/a:b.ts", rel: "a:b.ts", line: 7, text: "  literal [text]" },
    { path: "/alpha/a:b.ts", rel: "a:b.ts", line: 12, text: "literal [text] again" },
  ]);
});

it("surfaces partial scans and native errors instead of false exhaustive empty results", async () => {
  vi.mocked(searchWorkspace).mockResolvedValue({ ...outcome(), timedOut: true, truncated: true, reason: "Search reached its time limit.", errors: 1 });
  expect((await loadWorkspaceFiles()).notice).toContain("time limit");
  expect((await searchWorkspaceContents("needle")).notice).toContain("unreadable");
  vi.mocked(searchWorkspace).mockRejectedValue(new Error("Folder unavailable"));
  await expect(loadWorkspaceFiles()).rejects.toThrow("Folder unavailable");
  await expect(searchWorkspaceContents("needle")).rejects.toThrow("Folder unavailable");
});

it("never widens a missing workspace to the process directory or whole computer", async () => {
  workspace.root = "";
  expect((await loadWorkspaceFiles()).notice).toContain("Open a folder");
  expect((await searchWorkspaceContents("needle")).notice).toContain("Open a folder");
  expect(searchWorkspace).not.toHaveBeenCalled();
});
