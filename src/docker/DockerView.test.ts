// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./client", () => ({ checkDocker: vi.fn(), listContainers: vi.fn(), listImages: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./DockerDetailPanel", () => ({ DockerDetailPanel: () => null }));
vi.mock("../components/Modal", () => ({ Modal: ({ children, headerActions }: { children: ReactNode; headerActions: ReactNode }) => createElement("div", {}, headerActions, children) }));
import { checkDocker, listContainers, listImages } from "./client";
import { DockerView } from "./DockerView";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  vi.mocked(checkDocker).mockReset().mockResolvedValue(true);
  vi.mocked(listContainers).mockReset().mockResolvedValue([]); vi.mocked(listImages).mockReset().mockResolvedValue([]);
  vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(active = true) { await act(async () => root.render(createElement(DockerView, { inline: true, active }))); }
it("keeps local connection scope available without an expanded explanation", async () => {
  await render(false);
  const scope = container.querySelector("details");
  expect(scope?.open).toBe(false);
  expect(scope?.querySelector("summary")?.textContent).toBe("Local Docker configuration");
  expect(scope?.textContent).toContain("not the active SSH terminal");
  expect(scope?.textContent).toContain("daemon may be remote");
  expect(checkDocker).not.toHaveBeenCalled();
});
it("does not poll hidden panels or a hidden window", async () => {
  await render(false); await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(checkDocker).not.toHaveBeenCalled();
  await render(); expect(checkDocker).toHaveBeenCalledTimes(1);
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(checkDocker).toHaveBeenCalledTimes(1);
});
it("does not overlap refreshes or accept a hidden panel's late response", async () => {
  let resolve!: (value: boolean) => void;
  vi.mocked(checkDocker).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render(); await act(async () => vi.advanceTimersByTimeAsync(15000)); expect(checkDocker).toHaveBeenCalledTimes(1);
  await render(false); await act(async () => resolve(true)); expect(listContainers).not.toHaveBeenCalled();
  await render(); expect(listContainers).toHaveBeenCalledTimes(1);
});
it("shows failed refresh as an error rather than swallowing it", async () => {
  vi.mocked(listContainers).mockRejectedValueOnce(new Error("daemon disconnected")); await render();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("daemon disconnected");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click());
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
it("waits for all native refresh calls even after one fails", async () => {
  let resolve!: (value: []) => void;
  vi.mocked(listContainers).mockRejectedValueOnce(new Error("containers failed"));
  vi.mocked(listImages).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render(); await act(async () => vi.advanceTimersByTimeAsync(15000));
  expect(checkDocker).toHaveBeenCalledTimes(1);
  await act(async () => resolve([]));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("containers failed");
});
