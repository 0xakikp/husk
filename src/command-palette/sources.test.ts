import { afterEach, beforeEach, expect, it, vi } from "vitest";

const workspace = vi.hoisted(() => ({ root: "/alpha" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../workspace/store", () => ({ getWorkspaceRoot: () => workspace.root }));
vi.mock("../tools", () => ({ detectInstalled: vi.fn(async () => new Set<string>()) }));
vi.mock("../jobs/client", () => ({ bgList: vi.fn(async () => []) }));
vi.mock("../docker/client", () => ({ listContainers: vi.fn(async () => []) }));
vi.mock("../kubernetes/client", () => ({ listContexts: vi.fn(async () => []), currentContext: vi.fn(async () => "") }));
vi.mock("../notes/store", () => ({
  ensureNotesDirectory: vi.fn(), loadNotesTree: vi.fn(), getPinnedNotes: () => [],
  getRecentNotes: () => [], isNoteFile: () => true,
}));
vi.mock("../workflows/store", () => ({ loadWorkflows: () => [] }));

import { invoke } from "@tauri-apps/api/core";
import { detectInstalled } from "../tools";
import {
  invalidateLauncherCache, loadWorkspaceFiles, searchWorkspaceContents,
  subscribeLauncherCache, workspaceFilesCacheKey,
} from "./sources";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const output = (stdout: string) => ({ stdout, stderr: "", exit_code: 0 });

beforeEach(() => {
  workspace.root = "/alpha";
  invalidateLauncherCache();
  vi.mocked(invoke).mockReset();
  vi.mocked(detectInstalled).mockResolvedValue(new Set());
});
afterEach(() => vi.useRealTimers());

it("keys file caches by captured workspace and deduplicates concurrent cold loads", async () => {
  const pending = deferred<ReturnType<typeof output>>();
  vi.mocked(invoke).mockImplementation(async (_command, args) => (args as Record<string, unknown> | undefined)?.cwd === "/alpha" ? pending.promise : output("beta.ts\n"));
  const first = loadWorkspaceFiles();
  const duplicate = loadWorkspaceFiles();
  workspace.root = "/beta";
  expect(await loadWorkspaceFiles()).toEqual([{ path: "/beta/beta.ts", rel: "beta.ts", name: "beta.ts" }]);
  pending.resolve(output("alpha.ts\n"));
  const alpha = await first;
  expect(await duplicate).toBe(alpha);
  expect(alpha[0].path).toBe("/alpha/alpha.ts");
  expect(vi.mocked(invoke).mock.calls.filter(([, args]) => (args as Record<string, unknown> | undefined)?.cwd === "/alpha")).toHaveLength(1);
  expect((await loadWorkspaceFiles())[0].path).toBe("/beta/beta.ts");
});

it("publishes refreshed file data while preserving stale results for the same root only", async () => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockResolvedValueOnce(output("before.ts\n"));
  const before = await loadWorkspaceFiles("/alpha");
  await vi.advanceTimersByTimeAsync(60_001);
  const pending = deferred<ReturnType<typeof output>>();
  vi.mocked(invoke).mockReturnValueOnce(pending.promise);
  const notified = deferred<string>();
  const unsubscribe = subscribeLauncherCache((key) => notified.resolve(key));
  expect(await loadWorkspaceFiles("/alpha")).toBe(before);
  pending.resolve(output("after.ts\n"));
  expect(await notified.promise).toBe(workspaceFilesCacheKey("/alpha"));
  expect((await loadWorkspaceFiles("/alpha"))[0].path).toBe("/alpha/after.ts");
  unsubscribe();
});

it("does not repopulate an invalidated cache with late old loads", async () => {
  const old = deferred<ReturnType<typeof output>>();
  vi.mocked(invoke).mockReturnValueOnce(old.promise);
  const first = loadWorkspaceFiles("/alpha");
  // Let the optional-tool check settle so the native fake is in flight.
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  invalidateLauncherCache();
  vi.mocked(invoke).mockResolvedValueOnce(output("new.ts\n"));
  const latest = await loadWorkspaceFiles("/alpha");
  old.resolve(output("old.ts\n"));
  await first;
  expect(await loadWorkspaceFiles("/alpha")).toBe(latest);
  expect(latest[0].path).toBe("/alpha/new.ts");
});

it("runs literal grep inside the explicitly captured root after a workspace switch", async () => {
  vi.mocked(detectInstalled).mockResolvedValue(new Set(["rg"]));
  vi.mocked(invoke).mockResolvedValue(output("./src/example.ts:7:literal [text]\n"));
  workspace.root = "/beta";
  const result = await searchWorkspaceContents("[text]", 50, "/alpha");
  expect(invoke).toHaveBeenCalledWith("shell_run_command", expect.objectContaining({
    cwd: "/alpha", program: "rg", args: expect.arrayContaining(["-F", "-e", "[text]"]),
  }));
  expect(result.results[0]).toEqual({ path: "/alpha/src/example.ts", rel: "src/example.ts", line: 7, text: "literal [text]" });
});
