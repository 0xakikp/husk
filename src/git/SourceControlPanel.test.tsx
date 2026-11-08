// @vitest-environment happy-dom
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ workspace: "/repo", snapshot: vi.fn(), stage: vi.fn(), unstage: vi.fn(), commit: vi.fn(), push: vi.fn(), pull: vi.fn(), fetch: vi.fn(), diff: vi.fn(), untracked: vi.fn(), copy: vi.fn(), toast: vi.fn(), provider: vi.fn(), stageHunk: vi.fn(), canStage: vi.fn() }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => mock.workspace, getWorkspaceRoot: () => mock.workspace }));
vi.mock("../toast", () => ({ toast: mock.toast }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mock.copy }));
vi.mock("../components/Modal", () => ({ Modal: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("./GitGraphPanel", () => ({ GitGraphPanel: ({ onClose }: { onClose: () => void }) => <div>Local history view<button onClick={onClose}>Back</button></div> }));
vi.mock("./IssuesPanel", () => ({ IssuesPanel: () => <div>Local issues view</div> }));
vi.mock("./review", () => ({ detectReviewProvider: mock.provider }));
vi.mock("./patches", () => ({ canStageDiffHunks: mock.canStage, stageDiffHunk: mock.stageHunk, readConflictVersions: async () => ({ base: "base", ours: "ours", theirs: "theirs" }) }));
vi.mock("./GitDiffView", () => ({ GitDiffView: ({ text, onOpenFile, onStageHunk }: { text: string; onOpenFile?: () => void; onStageHunk?: (index: number) => Promise<void> }) => <div><pre>{text}</pre>{onOpenFile && <button onClick={onOpenFile}>Open file</button>}{onStageHunk && <button onClick={() => void onStageHunk(0)}>Stage change</button>}</div> }));
vi.mock("./RepositoryActions", () => ({ RepositoryActions: ({ kind, onClose }: { kind: string; onClose: () => void }) => <div>Repository workflow: {kind}<button onClick={onClose}>Back to Git</button></div> }));
vi.mock("./GitReviewPanel", () => ({ GitReviewPanel: ({ mode, onClose }: { mode: string; onClose: () => void }) => <div>Review workflow: {mode}<button onClick={onClose}>Back to Git</button></div> }));
vi.mock("./client", () => ({ repositorySnapshot: mock.snapshot, stageFiles: mock.stage, unstageFiles: mock.unstage, commit: mock.commit, push: mock.push, pull: mock.pull, fetch: mock.fetch, diffFile: mock.diff, diffUntrackedFile: mock.untracked,
  filePaths: (file: { path: string; originalPath?: string }) => file.originalPath ? [file.path, file.originalPath] : [file.path], stagePaths: (file: { path: string }) => [file.path],
}));
import { SourceControlPanel } from "./SourceControlPanel";
import type { GitFile, RepositorySnapshot } from "./client";
const file = (path: string, index = " ", work = "M"): GitFile => ({ path, index, work, staged: index !== " " && index !== "?" && index !== "U", unstaged: work !== " ", conflicted: index === "U" || work === "U" });
const repo = (files: GitFile[] = [file("modified.ts")], patch: Partial<RepositorySnapshot> = {}): RepositorySnapshot => ({ repoRoot: "/repo", branch: "feature", detached: false, unborn: false, upstream: "team/review", upstreamGone: false, ahead: 2, behind: 0, hasRemote: true, files, ...patch });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
let host: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mock.workspace = "/repo"; vi.clearAllMocks();
  mock.snapshot.mockReset().mockResolvedValue(repo());
  for (const fn of [mock.stage, mock.unstage, mock.commit, mock.push, mock.pull, mock.fetch, mock.copy]) fn.mockReset().mockResolvedValue("");
  mock.diff.mockReset().mockResolvedValue("-before\n+after"); mock.untracked.mockReset().mockResolvedValue("+new file");
  mock.provider.mockReset().mockResolvedValue({ kind: "none", supportsIssues: false });
  mock.stageHunk.mockReset().mockResolvedValue(undefined); mock.canStage.mockReset().mockReturnValue(false);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async (props: Partial<ComponentProps<typeof SourceControlPanel>> = {}) => { await act(async () => root.render(<SourceControlPanel inline {...props} />)); };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
const click = async (label: string) => {
  const target = button(label); expect(target).toBeDefined();
  const menu = target.closest<HTMLDetailsElement>("details.git-more");
  if (menu && !menu.open) await act(async () => menu.querySelector<HTMLElement>("summary")!.click());
  await act(async () => target.click());
};
const input = async (value: string, selector = "textarea") => {
  const node = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  await act(async () => { Object.getOwnPropertyDescriptor(selector === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); });
};

it("shows actual upstream and separately exposes both sides of a partially staged file", async () => {
  mock.snapshot.mockResolvedValue(repo([file("partial.ts", "M", "M")])); await render();
  expect(host.textContent).toContain("team/review · ↑2 ↓0"); expect(host.textContent).not.toContain("origin/");
  expect(host.textContent).toContain("1 staged · 1 unstaged");
  await click("View staged diff for partial.ts"); expect(mock.diff).toHaveBeenLastCalledWith("partial.ts", true, "/repo", undefined);
  await click("View working diff for partial.ts"); expect(mock.diff).toHaveBeenLastCalledWith("partial.ts", false, "/repo", undefined);
  expect(mock.stage).not.toHaveBeenCalled();
});
it("shows loading and real errors instead of a clean working tree", async () => {
  const pending = deferred<RepositorySnapshot>(); mock.snapshot.mockReturnValueOnce(pending.promise); await render();
  expect(host.textContent).toContain("Loading repository"); expect(host.textContent).not.toContain("Working tree clean");
  await act(async () => pending.reject(new Error("Cannot read Git index")));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Cannot read Git index");
  await click("Retry"); expect(host.textContent).toContain("modified.ts");
});
it("does not probe a fallback cwd without an open project", async () => {
  mock.workspace = ""; await render(); expect(mock.snapshot).not.toHaveBeenCalled(); expect(host.textContent).toContain("Open a local folder"); expect(button("Push")).toBeUndefined();
});
it("preserves commit drafts by workspace and ignores late reads from another folder", async () => {
  await render(); await input("Repo A draft"); const pending = deferred<RepositorySnapshot>(); mock.snapshot.mockReturnValueOnce(pending.promise);
  await click("Refresh Git"); mock.workspace = "/other"; mock.snapshot.mockResolvedValue(repo([], { repoRoot: "/other", branch: "other" })); await render();
  expect(host.querySelector("textarea")?.value).toBe(""); await input("Repo B draft");
  await act(async () => pending.resolve(repo([file("stale.ts")]))); expect(host.textContent).not.toContain("stale.ts");
  mock.workspace = "/repo"; mock.snapshot.mockResolvedValue(repo()); await render(); expect(host.querySelector("textarea")?.value).toBe("Repo A draft");
});
it("stages one bounded list atomically and locks repeated clicks", async () => {
  mock.snapshot.mockResolvedValue(repo([file("one.ts"), file("two.ts")])); const pending = deferred<string>(); mock.stage.mockReturnValue(pending.promise);
  await render(); const stage = button("Stage all"); await act(async () => { stage.click(); stage.click(); });
  expect(mock.stage).toHaveBeenCalledTimes(1); expect(mock.stage).toHaveBeenCalledWith(["one.ts", "two.ts"], "/repo");
  expect(button("Stage all").disabled).toBe(true); await act(async () => pending.resolve(""));
});
it("aborts a mutation if the workspace changes during its preflight", async () => {
  await render(); const pending = deferred<RepositorySnapshot>(); mock.snapshot.mockReturnValueOnce(pending.promise);
  await click("Stage modified.ts"); mock.workspace = "/other"; mock.snapshot.mockResolvedValue(repo([], { repoRoot: "/other" })); await render();
  await act(async () => pending.resolve(repo())); expect(mock.stage).not.toHaveBeenCalled();
});
it("refuses to silently apply an action to a branch checked out after the UI loaded", async () => {
  await render(); mock.snapshot.mockResolvedValue(repo([file("modified.ts")], { branch: "different" })); await click("Stage modified.ts");
  expect(mock.stage).not.toHaveBeenCalled(); expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("branch changed") }));
});
it("applies button guards to the keyboard commit shortcut too", async () => {
  await render(); await input("A message"); const area = host.querySelector("textarea")!;
  await act(async () => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
  expect(mock.commit).not.toHaveBeenCalled();
  mock.snapshot.mockResolvedValue(repo([file("staged.ts", "M", " ")])); await click("Refresh Git");
  await act(async () => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, isComposing: true, bubbles: true })));
  expect(mock.commit).not.toHaveBeenCalled();
  await act(async () => area.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true })));
  expect(mock.commit).toHaveBeenCalledWith("A message", "/repo"); expect(host.querySelector("textarea")?.value).toBe("");
});
it("does not erase a new message typed while a commit is running", async () => {
  mock.snapshot.mockResolvedValue(repo([file("staged.ts", "M", " ")])); const pending = deferred<string>(); mock.commit.mockReturnValueOnce(pending.promise);
  await render(); await input("First message"); await click("Commit staged"); await input("Next message");
  await act(async () => pending.resolve("")); expect(host.querySelector("textarea")?.value).toBe("Next message");
});
it("checks the staged list again immediately before committing", async () => {
  mock.snapshot.mockResolvedValue(repo([file("staged.ts", "M", " ")])); await render(); await input("Message");
  mock.snapshot.mockResolvedValue(repo([file("unexpected.ts", "A", " ")])); await click("Commit staged");
  expect(mock.commit).not.toHaveBeenCalled(); expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("staged file list changed") }));
});
it("isolates conflicts from bulk staging and requires explicit resolution review", async () => {
  mock.snapshot.mockResolvedValue(repo([file("conflict.ts", "U", "U"), file("safe.ts")])); await render(); await input("Blocked commit");
  expect(button("Commit staged").disabled).toBe(true); await click("Stage all"); expect(mock.stage).toHaveBeenCalledWith(["safe.ts"], "/repo");
  mock.stage.mockClear(); await click("Resolve conflict.ts"); expect(mock.stage).not.toHaveBeenCalled();
  await act(async () => { await vi.waitFor(() => expect(host.textContent).toContain("removing conflict markers")); });
  await click("Cancel"); expect(mock.stage).not.toHaveBeenCalled();
  await click("Resolve conflict.ts"); expect(button("Mark resolved").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Mark resolved"); expect(mock.stage).toHaveBeenCalledWith(["conflict.ts"], "/repo");
});
it("refuses to bulk-stage a file that became conflicted after it was displayed", async () => {
  await render();
  mock.snapshot.mockResolvedValue(repo([file("modified.ts", "U", "U")]));
  await click("Stage all");
  expect(mock.stage).not.toHaveBeenCalled();
  expect(mock.toast).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("now has conflicts") }));
  expect(host.textContent).toContain("Resolve conflicts before committing");
});
it("provides explicit untracked previews and ignores stale diff results", async () => {
  mock.snapshot.mockResolvedValue(repo([file("new.txt", "?", "?"), file("modified.ts")])); await render();
  const old = deferred<string>(); mock.diff.mockReturnValueOnce(old.promise); await click("View working diff for modified.ts");
  await click("View working diff for new.txt"); expect(mock.untracked).toHaveBeenCalledWith("new.txt", "/repo");
  await act(async () => old.resolve("stale diff")); expect(host.querySelector("pre")?.textContent).toBe("+new file");
  await click("Copy path"); expect(mock.copy).toHaveBeenCalledWith("new.txt");
});
it("gates push/pull on actual upstream and a clean working tree, not a fabricated origin", async () => {
  await render(); expect(button("Push ↑2").disabled).toBe(false); expect(button("Pull").disabled).toBe(true);
  mock.snapshot.mockResolvedValue(repo([], { upstream: null, ahead: 0 })); await click("Refresh Git");
  expect(host.textContent).toContain("No upstream configured"); expect(button("Push")).toBeUndefined(); expect(button("Publish branch").disabled).toBe(false); expect(button("Pull").disabled).toBe(true);
});
it("stops polling hidden panels and refreshes when made active", async () => {
  vi.useFakeTimers(); await render({ active: false }); expect(mock.snapshot).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(15_000)); expect(mock.snapshot).not.toHaveBeenCalled();
  await render({ active: true }); expect(mock.snapshot).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTime(10_000)); expect(mock.snapshot).toHaveBeenCalledTimes(2);
  await render({ active: false }); await act(async () => vi.advanceTimersByTime(15_000)); expect(mock.snapshot).toHaveBeenCalledTimes(2);
});
it("opens a read-only history view when no parent navigation callback exists", async () => {
  await render(); await input("Keep draft"); await click("Commit history"); expect(host.textContent).toContain("Local history view");
  expect(mock.stage).not.toHaveBeenCalled(); expect(mock.commit).not.toHaveBeenCalled(); await click("Back"); expect(host.querySelector("textarea")?.value).toBe("Keep draft");
});
it("filters the displayed files without changing the bulk action's explicit all-files meaning", async () => {
  mock.snapshot.mockResolvedValue(repo([file("one.ts"), file("two.ts")])); await render(); await input("one", 'input[type="search"]');
  expect(host.textContent).toContain("one.ts"); expect(host.textContent).not.toContain("two.ts");
});
it("opens branch, publishing and stash workflows without performing writes", async () => {
  await render(); await input("Keep my draft");
  await click("Branches: feature"); expect(host.textContent).toContain("Repository workflow: branches"); await click("Back to Git");
  await click("Publish / tracking…"); expect(host.textContent).toContain("Repository workflow: publish"); await click("Back to Git");
  await click("Stashes…"); expect(host.textContent).toContain("Repository workflow: stash"); await click("Back to Git");
  expect(host.querySelector("textarea")?.value).toBe("Keep my draft"); expect(mock.push).not.toHaveBeenCalled(); expect(mock.stage).not.toHaveBeenCalled();
});
it("provides incoming/outgoing review and shows issues only for a supported provider", async () => {
  mock.snapshot.mockResolvedValue(repo([], { ahead: 2, behind: 3 })); await render();
  expect(button("GitHub issues")).toBeUndefined(); await click("Review 2 outgoing"); expect(host.textContent).toContain("Review workflow: outgoing"); await click("Back to Git");
  await click("Review 3 incoming"); expect(host.textContent).toContain("Review workflow: incoming"); await click("Back to Git");
  expect(button("Push ↑2").disabled).toBe(true); expect(button("Pull ↓3").disabled).toBe(false);
  mock.provider.mockResolvedValue({ kind: "github", supportsIssues: true }); mock.snapshot.mockResolvedValue(repo([], { branch: "next" })); await click("Refresh Git");
  expect(button("GitHub issues")).toBeDefined();
});
it("opens the reviewed local file and stages only the chosen hunk through preflight", async () => {
  const onOpenFile = vi.fn(); mock.canStage.mockReturnValue(true); await render({ onOpenFile });
  await click("View working diff for modified.ts"); await click("Open file"); expect(onOpenFile).toHaveBeenCalledWith("/repo/modified.ts", "modified.ts");
  await click("Stage change"); expect(mock.stageHunk).toHaveBeenCalledWith(expect.objectContaining({ path: "modified.ts" }), "-before\n+after", 0, "/repo");
  expect(mock.stage).not.toHaveBeenCalled();
});
