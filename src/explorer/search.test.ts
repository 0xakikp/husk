import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { searchWorkspace, workspaceSearchNotice, type WorkspaceSearchOutcome } from "./search";

const outcome = (): WorkspaceSearchOutcome => ({
  results: [], truncated: false, timedOut: false, scannedFiles: 3,
  skippedFiles: 0, errors: 0, reason: null,
});

beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue(outcome()); });

it("sends one explicit root and exact filenames/query without shell or CLI dependencies", async () => {
  const query = "a:b\n'$(not executed)'";
  const result = { ...outcome(), results: [{ path: "/workspace/ a:b\n.ts ", rel: " a:b\n.ts ", name: " a:b\n.ts ", line: 2, column: 3, text: query }] };
  vi.mocked(invoke).mockResolvedValue(result);
  expect(await searchWorkspace({ root: "/workspace", query, mode: "contents" })).toEqual(result);
  expect(invoke).toHaveBeenCalledWith("workspace_search", { request: {
    id: expect.any(String), root: "/workspace", query, mode: "contents",
    includeHidden: false, includeIgnored: false, maxResults: 200,
  } });
});

it("makes ignore and hidden overrides explicit and bounds requested results", async () => {
  await searchWorkspace({ root: "/workspace", query: "", mode: "files", includeHidden: true, includeIgnored: true, maxResults: 9000 });
  expect(invoke).toHaveBeenCalledWith("workspace_search", { request: expect.objectContaining({
    includeHidden: true, includeIgnored: true, maxResults: 500,
  }) });
});

it("rejects a pre-cancelled search before starting native work", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(searchWorkspace({ root: "/workspace", query: "a", mode: "files", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  expect(invoke).not.toHaveBeenCalled();
});

it("cancels the actual native worker and ignores its late result", async () => {
  let finish!: (outcome: WorkspaceSearchOutcome) => void;
  vi.mocked(invoke).mockImplementation((command) => command === "workspace_search"
    ? new Promise((resolve) => { finish = resolve as typeof finish; }) : Promise.resolve(undefined));
  const controller = new AbortController();
  const pending = searchWorkspace({ root: "/workspace", query: "a", mode: "files", signal: controller.signal });
  const expected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
  const request = (vi.mocked(invoke).mock.calls[0][1] as { request: { id: string } }).request;
  controller.abort(); await expected;
  expect(invoke).toHaveBeenCalledWith("workspace_search_cancel", { id: request.id });
  finish(outcome());
});

it("preserves native failures as errors instead of an empty match set", async () => {
  vi.mocked(invoke).mockRejectedValue("Folder is unavailable");
  await expect(searchWorkspace({ root: "/workspace", query: "a", mode: "files" })).rejects.toThrow("Folder is unavailable");
  await expect(searchWorkspace({ root: "", query: "a", mode: "files" })).rejects.toThrow("Open a folder");
});

it("describes limits and skipped items without claiming complete coverage", () => {
  expect(workspaceSearchNotice(outcome())).toBeNull();
  expect(workspaceSearchNotice({ ...outcome(), timedOut: true })).toContain("time limit");
  expect(workspaceSearchNotice({ ...outcome(), truncated: true, reason: "Search reached its file limit.", errors: 2, skippedFiles: 1 }))
    .toBe("Search reached its file limit. 2 unreadable items were skipped. 1 binary, large, linked, or unsupported file was skipped.");
});
