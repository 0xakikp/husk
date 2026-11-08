// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ branches: vi.fn(), remotes: vi.fn(), stashes: vi.fn(), create: vi.fn(), switch: vi.fn(), publish: vi.fn(), upstream: vi.fn(), save: vi.fn(), inspect: vi.fn(), apply: vi.fn() }));
vi.mock("./workspaceActions", () => ({ listBranches: mock.branches, listRemotes: mock.remotes, listStashes: mock.stashes, createBranch: mock.create, switchBranch: mock.switch, publishBranch: mock.publish, setBranchUpstream: mock.upstream, saveStash: mock.save, inspectStash: mock.inspect, applyStash: mock.apply, displayRemoteUrl: (url: string) => url }));
import { RepositoryActions, type RepositoryActionsProps } from "./RepositoryActions";
import type { RepositorySnapshot } from "./client";
const clean: RepositorySnapshot = { repoRoot: "/repo", branch: "main", unborn: false, detached: false, upstream: null, upstreamGone: false, ahead: 0, behind: 0, hasRemote: true, files: [] };
const branch = (name: string, worktreePath: string | null = null) => ({ ref: `refs/heads/${name}`, name, oid: "a".repeat(40), kind: "local", upstream: null, worktreePath });
const stash = { oid: "b".repeat(40), selector: "stash@{0}", subject: "Saved work", date: "2026-11-07" };
let host: HTMLDivElement; let root: Root; let snapshot: RepositorySnapshot;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks(); snapshot = { ...clean };
  mock.branches.mockReset().mockResolvedValue([branch("main", "/repo"), branch("feature"), branch("elsewhere", "/other-worktree")]);
  mock.remotes.mockReset().mockResolvedValue([{ name: "origin", fetchUrls: ["https://example.test/repo"], pushUrls: ["https://example.test/repo"] }]);
  mock.stashes.mockReset().mockResolvedValue([stash]); mock.inspect.mockReset().mockResolvedValue("+restored content");
  for (const fn of [mock.create, mock.switch, mock.publish, mock.upstream, mock.save, mock.apply]) fn.mockReset().mockResolvedValue("");
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (kind: RepositoryActionsProps["kind"]) => { await act(async () => root.render(<RepositoryActions snapshot={snapshot} kind={kind} onClose={() => {}} onChanged={() => {}} runAction={async (_label, action, after) => { await action(snapshot); after?.(); }} />)); };
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === text)!;
const change = async (selector: string, value: string) => { const node = host.querySelector<HTMLInputElement | HTMLSelectElement>(selector)!; await act(async () => {
  Object.getOwnPropertyDescriptor(node.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(node, value);
  node.dispatchEvent(new Event(node.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}); };
it("requires reviewed destination approval and clears it when destination changes", async () => {
  await render("publish"); expect(mock.publish).not.toHaveBeenCalled(); expect(button("Publish branch").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await change('[aria-label="Publish destination branch"]', "feature/review"); expect(button("Publish branch").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await act(async () => button("Publish branch").click());
  expect(mock.publish).toHaveBeenCalledWith({ branch: "main", remote: "origin", destination: "feature/review", expectedPushUrls: ["https://example.test/repo"] }, "/repo");
});
it("blocks branch switching with worktree changes and labels other-worktree branches", async () => {
  snapshot = { ...clean, files: [{ path: "a", index: " ", work: "M", staged: false, unstaged: true, conflicted: false }] }; await render("branches");
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Switch local branch"]')!;
  expect(select.disabled).toBe(true); expect([...select.options].find((option) => option.value.endsWith("elsewhere"))?.disabled).toBe(true);
  expect(mock.switch).not.toHaveBeenCalled();
});
it("creates a branch only after explicit form submission", async () => {
  await render("branches"); await change('[aria-label="New branch name"]', "feature/new"); expect(mock.create).not.toHaveBeenCalled();
  await act(async () => button("Create & switch").click()); expect(mock.create).toHaveBeenCalledWith("feature/new", "/repo", undefined);
});
it("inspects a stash before applying its stable OID and keeps the saved copy", async () => {
  await render("stash"); await act(async () => host.querySelector<HTMLButtonElement>('.git-stash-list button')!.click());
  expect(mock.inspect).toHaveBeenCalledWith(stash.oid, "/repo"); expect(mock.apply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("stash is kept"); await act(async () => button("Apply & keep stash").click());
  expect(mock.apply).toHaveBeenCalledWith(stash.oid, "/repo");
});
it("keeps reads failing visibly disabled until an explicit retry succeeds", async () => {
  mock.remotes.mockRejectedValueOnce(new Error("Cannot read remotes")); await render("publish");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Cannot read remotes"); expect(button("Publish branch").disabled).toBe(true);
  await act(async () => button("Refresh list").click()); expect(host.querySelector('[role="alert"]')).toBeNull();
});
it("prevents repeated publish submissions while a request is pending", async () => {
  let finish!: () => void; mock.publish.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  await render("publish"); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await act(async () => { button("Publish branch").click(); button("Publish branch").click(); });
  expect(mock.publish).toHaveBeenCalledTimes(1); await act(async () => finish());
});
