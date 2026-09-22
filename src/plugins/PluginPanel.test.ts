// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ cwd: "/project", leaf: 1, remote: false, targetCwd: "/project" }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => fixture.cwd }));
vi.mock("../terminal/registry", () => ({ getActiveTerminalLeafId: () => fixture.leaf }));
vi.mock("../terminal/stageScreenCommand", () => ({
  captureScreenCommandTarget: () => ({ ptyId: 1, cwd: fixture.targetCwd, isRemote: fixture.remote, host: fixture.remote ? "server" : null, scopeToken: "verified:1" }),
  stageScreenCommand: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("./loader", () => ({ runView: vi.fn() }));
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { stageScreenCommand } from "../terminal/stageScreenCommand";
import { runView, type PluginRows } from "./loader";
import { PluginPanel } from "./PluginPanel";
import type { Plugin } from "./types";

const plugin: Plugin = { id: "test", name: "Test tool", views: [
  { title: "First", command: "tool list", format: "json", refresh: 2, actions: [{ label: "Inspect", command: "tool inspect {ID}", run: true }] },
  { title: "Second", command: "tool list second", format: "json" },
] };
const rows: PluginRows = { columns: ["ID", "Status"], rows: [{ ID: "alpha", Status: "ready" }], status: "ok" };
let root: Root; let container: HTMLDivElement;
const legacyRun = vi.fn(); const legacyType = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(fixture, { cwd: "/project", targetCwd: "/project", leaf: 1, remote: false });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.mocked(runView).mockReset().mockResolvedValue(rows);
  vi.mocked(stageScreenCommand).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(active = true, value = plugin) {
  await act(async () => root.render(createElement(PluginPanel, { plugin: value, active, onBack: vi.fn(), onRunCommand: legacyRun, onTypeCommand: legacyType })));
}
function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((node) => node.textContent === text || node.getAttribute("aria-label") === text);
  expect(found, text).toBeDefined(); return found!;
}
async function click(text: string) { await act(async () => button(text).click()); }
async function review() { await click("Run view locally"); await click("▸alpha"); await click("Review: Inspect"); }

it("does nothing until explicit consent, then renders labelled fields", async () => {
  await render(); expect(runView).not.toHaveBeenCalled();
  expect(container.textContent).toContain("/project"); expect(container.textContent).toContain("tool list");
  await click("Run view locally"); expect(runView).toHaveBeenCalledTimes(1);
  await click("▸alpha"); expect(container.querySelector("dl")?.textContent).toContain("Statusready");
  expect(legacyRun).not.toHaveBeenCalled(); expect(legacyType).not.toHaveBeenCalled();
});
it("requires a local workspace before running", async () => {
  fixture.cwd = ""; await render(); expect(button("Run view locally").disabled).toBe(true);
  expect(runView).not.toHaveBeenCalled();
});
it("previews legacy run actions and stages only into the captured local target", async () => {
  await render(); await review();
  expect(stageScreenCommand).not.toHaveBeenCalled(); expect(legacyRun).not.toHaveBeenCalled();
  expect(container.querySelector('[aria-label="Custom tool action preview"]')?.textContent).toContain("'tool' 'inspect' 'alpha'");
  await click("Stage only");
  expect(stageScreenCommand).toHaveBeenCalledWith(1, expect.objectContaining({ cwd: "/project", scopeToken: "verified:1" }), "'tool' 'inspect' 'alpha'");
  expect(container.textContent).toContain("staged without Enter");
});
it.each(["ssh", "directory", "changed leaf"])("blocks staging to an unsafe target: %s", async (kind) => {
  if (kind === "ssh") fixture.remote = true;
  if (kind === "directory") fixture.targetCwd = "/other";
  await render(); await review();
  if (kind === "changed leaf") fixture.leaf = 2;
  await click("Stage only"); expect(stageScreenCommand).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
});
it("copies a preview without staging or executing", async () => {
  await render(); await review(); await click("Copy command");
  expect(writeText).toHaveBeenCalledWith("'tool' 'inspect' 'alpha'");
  expect(stageScreenCommand).not.toHaveBeenCalled(); expect(legacyRun).not.toHaveBeenCalled();
  await click("Close preview"); expect(container.querySelector('[aria-label="Custom tool action preview"]')).toBeNull();
});
it("discards late rows and gates the next view until the old request settles", async () => {
  let resolve!: (rows: PluginRows) => void;
  vi.mocked(runView).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render(); await click("Run view locally");
  const signal = vi.mocked(runView).mock.calls[0][2]!.signal!;
  await click("Second"); expect(signal.aborted).toBe(true);
  expect(button("Run view locally").disabled).toBe(true);
  await act(async () => resolve(rows));
  expect(container.textContent).not.toContain("alpha"); expect(runView).toHaveBeenCalledTimes(1);
  await click("Run view locally"); expect(runView).toHaveBeenCalledTimes(2);
  expect(vi.mocked(runView).mock.calls[1][0].title).toBe("Second");
});
it("invalidates consent and previews when the directory or definition changes", async () => {
  await render(); await review(); fixture.cwd = "/different"; await render();
  expect(button("Run view locally").disabled).toBe(false); expect(container.textContent).not.toContain("alpha");
  await click("Run view locally");
  await render(true, { ...plugin, views: [{ ...plugin.views[0], command: "tool different" }] });
  expect(container.querySelector('[aria-label="Custom tool action preview"]')).toBeNull();
  expect(button("Run view locally")).toBeDefined(); expect(runView).toHaveBeenCalledTimes(2);
});
it("keeps failed refresh data visibly stale with actions disabled", async () => {
  await render(); await click("Run view locally");
  vi.mocked(runView).mockResolvedValueOnce({ rows: [], columns: [], error: "disconnected", status: "error" });
  await click("Refresh locally"); await click("▸alpha");
  expect(button("Review: Inspect").disabled).toBe(true);
  expect(container.textContent).toContain("stale"); expect(container.textContent).toContain("disconnected");
});
it("runs timers only after opt-in, pauses while hidden, and never overlaps a request", async () => {
  vi.useFakeTimers(); await render(); await click("Run view locally");
  await act(async () => vi.advanceTimersByTimeAsync(6000)); expect(runView).toHaveBeenCalledTimes(1);
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  let resolve!: (rows: PluginRows) => void;
  vi.mocked(runView).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await act(async () => vi.advanceTimersByTimeAsync(6000)); expect(runView).toHaveBeenCalledTimes(2);
  await render(false); await act(async () => vi.advanceTimersByTimeAsync(6000)); expect(runView).toHaveBeenCalledTimes(2);
  expect(vi.mocked(runView).mock.calls[1][2]!.signal!.aborted).toBe(true);
  await act(async () => resolve(rows));
  await render(true);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(6000)); expect(runView).toHaveBeenCalledTimes(2);
});
