// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
const wf = { id: "wf_1", name: "Check", steps: ["git status"], stopOnError: true };
beforeEach(() => { vi.resetModules(); vi.mocked(invoke).mockReset(); localStorage.clear(); });
it("publishes only after durable save and preserves the prior state on failure", async () => {
  const store = await import("./store");
  vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ items: [wf] })); await store.initialiseWorkflowStore();
  let resolve!: () => void; vi.mocked(invoke).mockReturnValueOnce(new Promise((done) => { resolve = () => done(undefined); }));
  const next = [{ ...wf, name: "Changed" }]; const saved = store.saveWorkflows(next);
  await Promise.resolve(); expect(store.loadWorkflows()[0].name).toBe("Check");
  resolve(); await saved; expect(store.loadWorkflows()[0].name).toBe("Changed");
  vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
  await expect(store.saveWorkflows([wf])).rejects.toThrow("disk full");
  expect(store.loadWorkflows()[0].name).toBe("Changed"); expect(JSON.parse(localStorage.getItem("huskv2.runbooks")!)[0].name).toBe("Changed");
});
it("serializes saves and rejects a queued stale collection", async () => {
  const store = await import("./store"); vi.mocked(invoke).mockResolvedValueOnce(JSON.stringify({ items: [wf] })); await store.initialiseWorkflowStore();
  vi.mocked(invoke).mockResolvedValue(undefined);
  const first = store.saveWorkflows([{ ...wf, name: "First" }]);
  const stale = store.saveWorkflows([{ ...wf, name: "Stale" }]);
  const assertion = expect(stale).rejects.toThrow("changed while saving");
  await first; await assertion; expect(store.loadWorkflows()[0].name).toBe("First");
});
it("never overwrites unreadable durable data with an empty fallback", async () => {
  const store = await import("./store"); vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.mocked(invoke).mockResolvedValueOnce("{broken"); await store.initialiseWorkflowStore();
  vi.mocked(invoke).mockClear(); await expect(store.saveWorkflows([wf])).rejects.toThrow("could not be loaded");
  expect(invoke).not.toHaveBeenCalled(); expect(store.getWorkflowLoadError()).toBeTruthy();
});
