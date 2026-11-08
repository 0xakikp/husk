// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { RepositorySnapshot } from "./client";
import type { HostedReview, ReviewProvider } from "./review";

const mock = vi.hoisted(() => ({ workspace: "/project", detect: vi.fn(), directional: vi.fn(), hosted: vi.fn(), patch: vi.fn(), openUrl: vi.fn() }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => mock.workspace, getWorkspaceRoot: () => mock.workspace }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mock.openUrl }));
vi.mock("./GitDiffView", () => ({ GitDiffView: ({ text, title }: { text: string; title: string }) => <pre aria-label={title}>{text}</pre> }));
vi.mock("./review", () => ({
  detectReviewProvider: mock.detect, loadDirectionalReview: mock.directional, loadHostedReview: mock.hosted, reviewCommitPatch: mock.patch,
  reviewBranch: (snapshot: RepositorySnapshot) => snapshot.branch,
  createReviewUrl: (provider: ReviewProvider, branch: string) => provider.webUrl ? `${provider.webUrl}/compare/${encodeURIComponent(branch)}` : null,
  reviewListUrl: (provider: ReviewProvider) => provider.webUrl ? `${provider.webUrl}/pulls` : null,
}));
import { GitReviewPanel } from "./GitReviewPanel";

const snapshot: RepositorySnapshot = { repoRoot: "/project", branch: "feature/review", detached: false, unborn: false, upstream: "origin/feature/review", upstreamRemote: "origin", upstreamRef: "refs/heads/feature/review", upstreamGone: false, ahead: 1, behind: 0, hasRemote: true, files: [] };
const provider: ReviewProvider = { kind: "github", remote: "origin", host: "github.com", repository: "team/project", webUrl: "https://github.com/team/project", supportsIssues: true, explanation: "Loaded only when requested." };
const hosted: HostedReview = { kind: "pull-request", pullRequest: { number: 42, title: "Useful change", url: "https://github.com/team/project/pull/42", state: "OPEN", draft: false, head: snapshot.branch, base: "main", decision: "REVIEW_REQUIRED", body: "<script>unsafe()</script>", checks: [{ name: "CI build", state: "SUCCESS", bucket: "pass" }], checksError: null } };
const commit = (letter = "a") => ({ hash: letter.repeat(40), author: "Developer", date: "2026-11-07T12:00:00+05:30", subject: `Change ${letter}` });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
let container: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mock.workspace = "/project";
  mock.detect.mockReset().mockResolvedValue(provider);
  mock.directional.mockReset().mockResolvedValue({ commits: [commit(), commit("b")], limited: false, head: "a".repeat(40), upstream: "b".repeat(40), direction: "outgoing" });
  mock.hosted.mockReset().mockResolvedValue(hosted);
  mock.patch.mockReset().mockResolvedValue("+Useful patch\n");
  mock.openUrl.mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (node: ReactNode = <GitReviewPanel snapshot={snapshot} mode="provider" onClose={() => {}} />) => { await act(async () => root.render(node)); };
const button = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
const click = async (label: string) => { const node = button(label); expect(node).toBeDefined(); await act(async () => node.click()); };

it("does not query provider accounts or open the browser on render or parent polling", async () => {
  await render(); await render(<GitReviewPanel snapshot={{ ...snapshot, ahead: 2 }} mode="provider" onClose={() => {}} />);
  expect(mock.detect).toHaveBeenCalledTimes(1); expect(mock.hosted).not.toHaveBeenCalled(); expect(mock.openUrl).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Only review metadata and checks are read");
  await click("Load review status"); expect(mock.hosted).toHaveBeenCalledTimes(1); expect(container.textContent).toContain("#42 Useful change"); expect(container.textContent).toContain("CI build");
});

it("renders review bodies as plain text and opens only explicit reviewed links", async () => {
  await render(); await click("Load review status");
  expect(container.querySelector("script")).toBeNull(); expect(container.textContent).toContain("<script>unsafe()</script>");
  expect(mock.openUrl).not.toHaveBeenCalled(); await click("Open pull request ↗"); expect(mock.openUrl).toHaveBeenCalledWith(hosted.kind === "pull-request" ? hosted.pullRequest.url : "");
  await click("Prepare pull request ↗"); expect(mock.openUrl).toHaveBeenLastCalledWith("https://github.com/team/project/compare/feature%2Freview");
});

it("reports provider failures without showing a false no-review or passing result", async () => {
  mock.hosted.mockRejectedValueOnce(new Error("Authentication required")); await render(); await click("Load review status");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Authentication required"); expect(container.textContent).not.toContain("No pull request was found"); expect(container.textContent).not.toContain("CI build");
  await click("Load review status"); expect(container.textContent).toContain("#42 Useful change");
});

it("distinguishes no checks from passing checks and failed checks loading", async () => {
  if (hosted.kind !== "pull-request") throw new Error("fixture");
  mock.hosted.mockResolvedValue({ ...hosted, pullRequest: { ...hosted.pullRequest, checks: [] } });
  await render(); await click("Load review status"); expect(container.textContent).toContain("This is not a passing-checks guarantee");
  mock.hosted.mockResolvedValue({ ...hosted, pullRequest: { ...hosted.pullRequest, checks: null, checksError: "Checks could not be loaded" } });
  await click("Refresh review status"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("Checks could not be loaded");
});

it("coalesces repeated provider clicks and aborts stale workspace requests", async () => {
  const pending = deferred<HostedReview>(); mock.hosted.mockReturnValue(pending.promise); await render();
  const target = button("Load review status"); await act(async () => { target.click(); target.click(); }); expect(mock.hosted).toHaveBeenCalledTimes(1);
  const signal = mock.hosted.mock.calls[0]![2] as AbortSignal;
  mock.workspace = "/other"; await render(<GitReviewPanel snapshot={{ ...snapshot, repoRoot: "/other", branch: "main" }} mode="provider" onClose={() => {}} />);
  expect(signal.aborted).toBe(true); await act(async () => pending.resolve(hosted)); expect(container.textContent).not.toContain("#42 Useful change");
});

it("does not use a stale repository snapshot after changing workspaces", async () => {
  mock.workspace = "/other"; await render(); expect(mock.detect).not.toHaveBeenCalled(); expect(container.textContent).toContain("workspace changed");
});

it("explains unsupported providers instead of offering misleading GitHub buttons", async () => {
  mock.detect.mockResolvedValue({ ...provider, kind: "unsupported", webUrl: null, supportsIssues: false, explanation: "This host has no configured review adapter." });
  await render(); expect(container.textContent).toContain("no configured review adapter"); expect(button("Load review status")).toBeUndefined(); expect(button("Prepare pull request ↗")).toBeUndefined(); expect(mock.hosted).not.toHaveBeenCalled();
});

it("offers browser-based GitLab review without claiming in-app checks", async () => {
  mock.detect.mockResolvedValue({ ...provider, kind: "gitlab", host: "gitlab.com", webUrl: "https://gitlab.com/team/project", supportsIssues: false, explanation: "In-app GitLab status and checks are not connected." });
  await render(); expect(button("Load review status")).toBeUndefined(); expect(button("Prepare merge request ↗")).toBeDefined(); expect(container.textContent).toContain("not connected"); expect(mock.hosted).not.toHaveBeenCalled();
});

it("reports browser opening failures without losing review information", async () => {
  mock.openUrl.mockRejectedValue(new Error("native detail")); await render(); await click("Open pull requests ↗");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not open your browser"); expect(container.textContent).not.toContain("native detail");
});

it("shows directional local commits and inspects only the explicitly selected hash", async () => {
  await render(<GitReviewPanel snapshot={snapshot} mode="outgoing" onClose={() => {}} />);
  expect(mock.directional).toHaveBeenCalledWith(snapshot, "outgoing", expect.any(AbortSignal)); expect(mock.detect).not.toHaveBeenCalled(); expect(mock.hosted).not.toHaveBeenCalled(); expect(mock.patch).not.toHaveBeenCalled();
  expect(container.textContent).toContain("No network request was made");
  await act(async () => container.querySelector<HTMLButtonElement>('.git-review-commits button')!.click());
  expect(mock.patch).toHaveBeenCalledWith(snapshot, commit().hash); expect(container.textContent).toContain("+Useful patch");
  await click("Close commit preview"); expect(container.textContent).not.toContain("+Useful patch");
});

it("ignores older patch results when the selected commit changes", async () => {
  const old = deferred<string>(); mock.patch.mockReturnValueOnce(old.promise).mockResolvedValueOnce("+New selected patch");
  await render(<GitReviewPanel snapshot={snapshot} mode="incoming" onClose={() => {}} />);
  const rows = container.querySelectorAll<HTMLButtonElement>('.git-review-commits button');
  await act(async () => rows[0]!.click()); await act(async () => rows[1]!.click()); await act(async () => old.resolve("+Old patch"));
  expect(container.textContent).toContain("+New selected patch"); expect(container.textContent).not.toContain("+Old patch");
});

it("retries local read failures and makes bounded history explicit", async () => {
  mock.directional.mockRejectedValueOnce(new Error("No upstream")); await render(<GitReviewPanel snapshot={snapshot} mode="incoming" onClose={() => {}} />);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("No upstream"); expect(container.textContent).not.toContain("0 incoming commits");
  mock.directional.mockResolvedValue({ commits: [commit()], limited: true, head: "a".repeat(40), upstream: "b".repeat(40), direction: "incoming" });
  await click("Retry"); expect(container.textContent).toContain("newest 100 commits"); expect(container.textContent).toContain("Change a");
});
