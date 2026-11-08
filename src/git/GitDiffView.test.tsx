// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./client", () => ({ runGit: vi.fn(), runGitOutput: vi.fn(), literalGitPaths: vi.fn() }));
vi.mock("@radix-ui/react-dialog", () => ({ Root: ({ children }: { children: ReactNode }) => <div>{children}</div>, Portal: ({ children }: { children: ReactNode }) => <div>{children}</div>, Content: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>, Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>, Close: ({ children }: { children: ReactNode }) => <button>{children}</button> }));
import { GitDiffView, type GitDiffViewProps } from "./GitDiffView";
const text = "diff --git a/a.txt b/a.txt\nindex 123abcd..456abcd 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-before\n+after\n";
let host: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (props: Partial<GitDiffViewProps> = {}) => { await act(async () => root.render(<GitDiffView text={text} {...props} />)); };
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!;
it("shows read-only colored changes and old/new line numbers without offering mutations by default", async () => {
  await render(); expect(host.textContent).toContain("Read-only review");
  expect(host.querySelector(".git-diff-line-addition")?.textContent).toContain("+after");
  expect(host.querySelector(".git-diff-line-deletion")?.textContent).toContain("-before");
  expect(host.querySelectorAll(".git-diff-stage")).toHaveLength(0);
  expect(host.querySelector('[aria-label="1 added lines, 1 removed lines"]')).not.toBeNull();
});
it("opens the full review and forwards Open file only on explicit click", async () => {
  const open = vi.fn(); await render({ onOpenFile: open, title: "a.txt" }); expect(open).not.toHaveBeenCalled();
  await act(async () => button("Open file").click()); expect(open).toHaveBeenCalledTimes(1);
  await act(async () => button("Expand diff").click()); expect(host.querySelector('[role="dialog"] h2')?.textContent).toBe("a.txt");
});
it("stages only an explicitly clicked hunk and prevents repeated clicks while pending", async () => {
  let finish!: () => void; const stage = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render({ onStageHunk: stage }); const target = button("Stage hunk 1");
  await act(async () => { target.click(); target.click(); }); expect(stage).toHaveBeenCalledTimes(1); expect(stage).toHaveBeenCalledWith(0); expect(target.disabled).toBe(true);
  await act(async () => finish()); expect(target.disabled).toBe(false);
});
it("shows native staging errors and keeps unsupported previews read only", async () => {
  const stage = vi.fn().mockRejectedValue(new Error("File changed; refresh")); await render({ onStageHunk: stage });
  await act(async () => button("Stage hunk 1").click()); expect(host.querySelector('[role="alert"]')?.textContent).toContain("File changed");
  await render({ text: "Binary files differ\n", onStageHunk: stage }); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.querySelectorAll(".git-diff-stage")).toHaveLength(0);
});
it("respects parent operation guards and bounds large rendered diffs", async () => {
  const stage = vi.fn(); await render({ onStageHunk: stage, stagingDisabled: true });
  expect(button("Stage hunk 1").disabled).toBe(true); await act(async () => button("Stage hunk 1").click()); expect(stage).not.toHaveBeenCalled();
  await render({ text: "line\n".repeat(7000), onStageHunk: stage }); expect(host.querySelectorAll(".git-diff-line")).toHaveLength(6000); expect(host.textContent).toContain("hunk staging is disabled");
});
