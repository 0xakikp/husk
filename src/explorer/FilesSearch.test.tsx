// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ search: vi.fn() }));
vi.mock("./search", async (original) => ({ ...await original<typeof import("./search")>(), searchWorkspace: mock.search }));
import { FilesSearch } from "./FilesSearch";
import type { WorkspaceSearchOutcome } from "./search";

const outcome = (patch: Partial<WorkspaceSearchOutcome> = {}): WorkspaceSearchOutcome => ({ results: [], truncated: false, timedOut: false, scannedFiles: 12, skippedFiles: 0, errors: 0, reason: null, ...patch });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((yes) => { resolve = yes; }); return { promise, resolve }; };
let host: HTMLDivElement; let root: Root; let props: ComponentProps<typeof FilesSearch>;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.useFakeTimers(); mock.search.mockReset().mockResolvedValue(outcome());
  props = { root: "/repo", includeHidden: false, refreshKey: 0, onClose: vi.fn(), onOpenFile: vi.fn(), onOpenFileAtLine: vi.fn() };
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
const render = async (patch: Partial<typeof props> = {}) => { props = { ...props, ...patch }; await act(async () => root.render(<FilesSearch {...props} />)); };
const input = async (value: string) => { await act(async () => { const node = host.querySelector<HTMLInputElement>('input[type="search"]')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(node, value); node.dispatchEvent(new Event("input", { bubbles: true })); }); };
const advance = async () => { await act(async () => { vi.advanceTimersByTime(200); }); };
const click = async (label: string) => { const node = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent === label || node.getAttribute("aria-label") === label)!; expect(node).toBeDefined(); await act(async () => node.click()); };

it("searches recursively with explicit name/content and independent hidden/ignored options", async () => {
  await render(); await input("  app.ts  "); expect(mock.search).not.toHaveBeenCalled(); await advance();
  expect(mock.search).toHaveBeenLastCalledWith(expect.objectContaining({ root: "/repo", query: "app.ts", mode: "files", includeHidden: false, includeIgnored: false, maxResults: 200 }));
  await click("Contents"); await render({ includeHidden: true }); await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()); await advance();
  expect(mock.search).toHaveBeenLastCalledWith(expect.objectContaining({ mode: "contents", includeHidden: true, includeIgnored: true })); expect(host.textContent).toContain("Hidden included");
});

it("aborts stale searches and ignores their late results", async () => {
  const pending = deferred<WorkspaceSearchOutcome>(); mock.search.mockReturnValueOnce(pending.promise); await render(); await input("old"); await advance();
  const signal = mock.search.mock.calls[0][0].signal as AbortSignal;
  await input("new"); expect(signal.aborted).toBe(true); await advance();
  await act(async () => pending.resolve(outcome({ results: [{ path: "/repo/old", rel: "old", name: "OLD RESULT", line: null, column: null, text: null }] })));
  expect(host.textContent).not.toContain("OLD RESULT"); expect(host.textContent).toContain("No matches in this folder");
});

it("cancels native work while the sidebar is inactive and resumes the current query", async () => {
  mock.search.mockReturnValue(new Promise(() => {})); await render(); await input("needle"); await advance(); const signal = mock.search.mock.calls[0][0].signal as AbortSignal;
  await render({ active: false }); expect(signal.aborted).toBe(true); await advance(); expect(mock.search).toHaveBeenCalledTimes(1);
  await render({ active: true }); await advance(); expect(mock.search).toHaveBeenCalledTimes(2);
});

it("distinguishes partial no-matches from a complete empty search", async () => {
  mock.search.mockResolvedValue(outcome({ timedOut: true, errors: 1, skippedFiles: 2, reason: "Search reached its time limit." }));
  await render(); await input("needle"); await advance();
  expect(host.textContent).toContain("No matches in the searched portion"); expect(host.textContent).not.toContain("No matches in this folder with these options");
  expect(host.textContent).toContain("time limit"); expect(host.textContent).toContain("1 unreadable item"); expect(host.textContent).toContain("2 binary, large, linked");
});

it("reports search errors with retry instead of claiming no results", async () => {
  mock.search.mockRejectedValueOnce(new Error("Folder unavailable")); await render(); await input("needle"); await advance();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Folder unavailable"); expect(host.textContent).not.toContain("No matches");
  await click("Retry search"); await advance(); expect(mock.search).toHaveBeenCalledTimes(2); expect(host.textContent).toContain("No matches in this folder");
});

it("opens a content match at its exact line and a filename match normally", async () => {
  mock.search.mockResolvedValue(outcome({ results: [
    { path: "/repo/src/app.ts", rel: "src/app.ts", name: "app.ts", line: 42, column: 3, text: "const needle = 1;" },
    { path: "/repo/file.ts", rel: "file.ts", name: "file.ts", line: null, column: null, text: null },
  ] })); await render(); await input("needle"); await advance();
  const results = host.querySelectorAll<HTMLButtonElement>(".files-search-result");
  await act(async () => results[0].click()); expect(props.onOpenFileAtLine).toHaveBeenCalledWith("/repo/src/app.ts", "app.ts", 42);
  await act(async () => results[1].click()); expect(props.onOpenFile).toHaveBeenCalledWith("/repo/file.ts", "file.ts");
});

it("cancels on unmount, exposes a clear close action, and accepts Escape", async () => {
  mock.search.mockReturnValue(new Promise(() => {})); await render(); await input("needle"); await advance(); const signal = mock.search.mock.calls[0][0].signal as AbortSignal;
  await act(async () => host.querySelector("input")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }))); expect(props.onClose).toHaveBeenCalledTimes(1);
  await click("Close search and clear query"); expect(props.onClose).toHaveBeenCalledTimes(2);
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
});
