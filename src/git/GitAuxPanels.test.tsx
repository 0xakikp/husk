// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ cwd: "/project", structuredLog: vi.fn(), log: vi.fn(), hasGhCli: vi.fn(), listIssues: vi.fn(), copy: vi.fn(), openUrl: vi.fn() }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => mock.cwd }));
vi.mock("./client", () => ({ structuredLog: mock.structuredLog, log: mock.log, hasGhCli: mock.hasGhCli, listIssues: mock.listIssues }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: mock.copy }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mock.openUrl }));
vi.mock("../components/Modal", () => ({ Modal: ({ children, title, onClose }: { children: ReactNode; title: string; onClose: () => void }) => <div role="dialog" aria-label={title}><button onClick={onClose}>Close</button>{children}</div> }));
vi.mock("./GitCommitChanges", () => ({ GitCommitChanges: ({ hash, cwd }: { hash: string; cwd: string }) => <div>Commit patch: {hash} in {cwd}</div> }));

import { GitGraphPanel } from "./GitGraphPanel";
import { IssuesPanel } from "./IssuesPanel";
import { GitHistoryDialog } from "./GitHistoryDialog";

let host: HTMLDivElement;
let root: Root;
const commit = (index = 1) => ({ hash: index.toString(16).padStart(40, "a"), shortHash: `abcd${index}`, subject: `Change ${index}`, authorName: "Developer", authorEmail: "dev@example.com", date: "2026-11-06", filesChanged: 2, insertions: 5, deletions: 1 });
const issue = (number = 42) => ({ number, title: `Fix ${number}`, url: `https://github.com/team/project/issues/${number}`, author: { login: "developer" }, state: "OPEN", createdAt: "2026-11-06T10:00:00Z", labels: [{ name: "bug", color: "ff0000" }] });
const deferred = <T,>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.cwd = "/project";
  mock.structuredLog.mockReset().mockResolvedValue([commit()]);
  mock.log.mockReset().mockResolvedValue("* abc123 (HEAD -> main) Commit");
  mock.hasGhCli.mockReset().mockResolvedValue(true);
  mock.listIssues.mockReset().mockResolvedValue({ kind: "ok", issues: [issue()] });
  mock.copy.mockReset().mockResolvedValue(undefined);
  mock.openUrl.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (component: ReactNode) => { await act(async () => root.render(component)); };
const graph = () => render(<GitGraphPanel onClose={() => {}} />);
const issues = () => render(<IssuesPanel onClose={() => {}} />);
const history = () => render(<GitHistoryDialog onClose={() => {}} />);
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
const click = async (label: string) => { const target = button(label); expect(target).toBeDefined(); await act(async () => target.click()); };
const search = async (value: string) => { const input = host.querySelector<HTMLInputElement>('input[type="search"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }); };

it("labels the commit list honestly and copies full hashes only on explicit action", async () => {
  await graph(); expect(mock.structuredLog).toHaveBeenCalledWith(30, "/project");
  expect(host.textContent).toContain("Commit history"); expect(host.textContent).not.toContain("Git Graph");
  expect(mock.copy).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  expect(host.textContent).toContain("2 files changed"); await click("Copy commit hash");
  expect(host.textContent).toContain(`Commit patch: ${commit().hash} in /project`);
  expect(mock.copy).toHaveBeenCalledWith(commit().hash); expect(button("Copied hash")).toBeDefined();
});

it("allows retry after clipboard failure without exposing internal error details", async () => {
  mock.copy.mockRejectedValueOnce(new Error("internal secret")); await graph();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click());
  await click("Copy commit hash"); expect(host.textContent).toContain("Could not copy"); expect(host.textContent).not.toContain("internal secret");
  await click("Copy commit hash"); expect(button("Copied hash")).toBeDefined();
});

it("offers bounded load-more instead of falsely claiming 30 commits are all history", async () => {
  mock.structuredLog.mockResolvedValue(Array.from({ length: 30 }, (_, index) => commit(index + 1)));
  await graph(); expect(host.textContent).not.toContain("End of current branch history"); await click("Load 30 more commits");
  expect(mock.structuredLog).toHaveBeenLastCalledWith(60, "/project");
});

it("searches loaded commits and explains when only the loaded subset has no matches", async () => {
  mock.structuredLog.mockResolvedValue([commit(1), commit(2)]); await graph(); await search("Change 2");
  expect(host.textContent).toContain("1 matches"); expect(host.textContent).not.toContain("Change 1");
  await search("absent"); expect(host.textContent).toContain("No matching commits in the loaded history");
});

it("surfaces Git failures with retry instead of claiming there are no commits", async () => {
  mock.structuredLog.mockRejectedValueOnce(new Error("Permission denied")); await graph();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Permission denied");
  expect(host.textContent).not.toContain("No commits yet"); await click("Retry"); expect(host.textContent).toContain("Change 1");
});

it("ignores old workspace commit reads and clears old history immediately", async () => {
  const pending = deferred<ReturnType<typeof commit>[]>(); mock.structuredLog.mockReturnValueOnce(pending.promise);
  await graph(); mock.cwd = "/other"; mock.structuredLog.mockResolvedValue([commit(2)]); await graph();
  expect(mock.structuredLog).toHaveBeenLastCalledWith(30, "/other");
  await act(async () => pending.resolve([commit(1)])); expect(host.textContent).not.toContain("Change 1"); expect(host.textContent).toContain("Change 2");
});

it("does not query a fallback directory without a workspace", async () => {
  mock.cwd = ""; await graph(); expect(mock.structuredLog).not.toHaveBeenCalled(); expect(host.textContent).toContain("Choose a local project folder");
  await issues(); expect(mock.hasGhCli).not.toHaveBeenCalled(); expect(mock.listIssues).not.toHaveBeenCalled();
  await history(); expect(mock.log).not.toHaveBeenCalled();
});

it("opens the actual repository issue using the native browser only after clicking", async () => {
  await issues(); expect(mock.listIssues).toHaveBeenCalledWith("/project", 30); expect(mock.openUrl).not.toHaveBeenCalled();
  expect(host.querySelector("a")).toBeNull(); await click("Open issue #42: Fix 42 in browser");
  expect(mock.openUrl).toHaveBeenCalledWith("https://github.com/team/project/issues/42");
});

it("supports enterprise issue URLs and deleted authors", async () => {
  mock.listIssues.mockResolvedValue({ kind: "ok", issues: [{ ...issue(), author: null, url: "https://git.company.example/team/project/issues/42" }] });
  await issues(); expect(host.textContent).toContain("Deleted user"); await click("Open issue #42: Fix 42 in browser");
  expect(mock.openUrl).toHaveBeenCalledWith("https://git.company.example/team/project/issues/42");
});

it("disables invalid issue links and keeps label text readable", async () => {
  mock.listIssues.mockResolvedValue({ kind: "ok", issues: [{ ...issue(), url: "javascript:alert(1)", labels: [{ name: "readable", color: "broken" }] }] });
  await issues(); expect(button("Open issue #42: Fix 42 in browser").disabled).toBe(true); expect(host.textContent).toContain("Issue link unavailable");
  expect(host.textContent).toContain("readable"); expect(mock.openUrl).not.toHaveBeenCalled();
});

it("reports failed browser opening without claiming success", async () => {
  mock.openUrl.mockRejectedValueOnce(new Error("internal")); await issues(); await click("Open issue #42: Fix 42 in browser");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not open the issue");
});

it("shows CLI setup and query errors honestly with retry", async () => {
  mock.hasGhCli.mockResolvedValueOnce(false); await issues(); expect(mock.listIssues).not.toHaveBeenCalled(); expect(host.textContent).toContain("gh auth login");
  mock.listIssues.mockResolvedValueOnce({ kind: "error", message: "Not a GitHub repository" }); await click("Retry"); expect(host.textContent).toContain("Not a GitHub repository");
  expect(host.textContent).not.toContain("No open issues"); await click("Retry"); expect(host.textContent).toContain("Fix 42");
});

it("does not start a stale GitHub query after closing or switching before CLI detection finishes", async () => {
  const pending = deferred<boolean>(); mock.hasGhCli.mockReturnValueOnce(pending.promise); await issues();
  mock.cwd = "/other"; await issues(); expect(mock.listIssues).toHaveBeenCalledTimes(1); expect(mock.listIssues).toHaveBeenCalledWith("/other", 30);
  await act(async () => pending.resolve(true)); expect(mock.listIssues).toHaveBeenCalledTimes(1);
});

it("ignores late issue responses from another workspace", async () => {
  const pending = deferred<unknown>(); mock.listIssues.mockReturnValueOnce(pending.promise); await issues();
  mock.cwd = "/other"; mock.listIssues.mockResolvedValue({ kind: "ok", issues: [issue(99)] }); await issues();
  await act(async () => pending.resolve({ kind: "ok", issues: [issue(42)] })); expect(host.textContent).toContain("Fix 99"); expect(host.textContent).not.toContain("Fix 42");
});

it("loads additional issues without inventing an end-of-list claim", async () => {
  mock.listIssues.mockResolvedValue({ kind: "ok", issues: Array.from({ length: 30 }, (_, index) => issue(index + 1)) }); await issues();
  await click("Load 30 more issues"); expect(mock.listIssues).toHaveBeenLastCalledWith("/project", 60);
});

it("keeps the actual text graph in the history dialog and reports the bounded window", async () => {
  await history(); expect(mock.log).toHaveBeenCalledWith(80, "/project");
  expect(host.querySelector("pre")?.textContent).toContain("* abc123 (HEAD -> main)"); expect(host.textContent).toContain("up to 80 commits");
});

it("makes dialog failures retryable and follows workspace changes", async () => {
  mock.log.mockRejectedValueOnce(new Error("Repository inaccessible")); await history(); expect(host.textContent).toContain("Could not load history");
  await click("Retry"); expect(host.querySelector("pre")).not.toBeNull();
  mock.cwd = "/other"; mock.log.mockResolvedValue(""); await history(); expect(mock.log).toHaveBeenLastCalledWith(80, "/other"); expect(host.textContent).toContain("No commits yet");
});
