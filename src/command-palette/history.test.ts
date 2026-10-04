// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(() => { localStorage.clear(); vi.resetModules(); });
afterEach(() => { vi.restoreAllMocks(); });

it("returns unique command history newest-first, independent of frequency", async () => {
  const history = await import("./history");
  history.recordCommandUse("old"); history.recordCommandUse("old");
  history.recordCommandUse("new");
  expect(history.getCommandHistory()).toEqual(["new", "old"]);
  const copy = history.getCommandHistory(); copy.reverse();
  expect(history.getCommandHistory()).toEqual(["new", "old"]);
  history.recordCommandUse("old");
  expect(history.getCommandHistory()).toEqual(["old", "new"]);
});

it("bounds history to twenty recent commands and restores it from storage", async () => {
  const history = await import("./history");
  for (let index = 0; index < 22; index++) history.recordCommandUse("command" + index);
  expect(history.getCommandHistory()).toHaveLength(20);
  expect(history.getCommandHistory()[0]).toBe("command21");
  vi.resetModules();
  expect((await import("./history")).getCommandHistory()).toEqual(history.getCommandHistory());
});

it("ignores malformed stored records and deduplicates valid recent IDs", async () => {
  localStorage.setItem("huskv2.cmd-palette.history", JSON.stringify({
    records: { valid: { count: 2, lastUsed: Date.now() }, negative: { count: -1, lastUsed: 0 }, bad: "bad", missing: {} },
    recent: ["valid", null, 3, "valid", "missing"],
  }));
  const history = await import("./history");
  expect(history.getCommandHistory()).toEqual(["valid", "missing"]);
  expect(history.getFrecencyScore("valid")).toBeGreaterThan(0);
  expect(history.getFrecencyScore("negative")).toBe(0);
  expect(history.getFrecencyScore("bad")).toBe(0);
  expect(history.getFrecencyScore("missing")).toBe(0);
});

it("handles prototype-like IDs without inheriting or mutating object properties", async () => {
  const history = await import("./history");
  expect(history.getFrecencyScore("__proto__")).toBe(0);
  history.recordCommandUse("__proto__"); history.recordCommandUse("constructor");
  expect(history.getFrecencyScore("__proto__")).toBeGreaterThan(0);
  expect(history.getCommandHistory()).toEqual(["constructor", "__proto__"]);
  vi.resetModules();
  expect((await import("./history")).getCommandHistory()).toEqual(["constructor", "__proto__"]);
});

it("bounds frequency records and prevents future timestamps or clock rollback from distorting scores", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(10_000_000);
  const records = Object.fromEntries(Array.from({ length: 502 }, (_, index) => [
    "command" + index, { count: 1, lastUsed: index },
  ]));
  records.future = { count: 2_000_000, lastUsed: 20_000_000 };
  localStorage.setItem("huskv2.cmd-palette.history", JSON.stringify({ records, recent: [] }));
  const history = await import("./history");
  expect(history.getFrecencyScore("command0")).toBe(0);
  expect(history.getFrecencyScore("future")).toBe(1_000_000);
  now.mockReturnValue(6_400_000);
  expect(history.getFrecencyScore("future")).toBe(1_000_000);
  history.recordCommandUse("new");
  const stored = JSON.parse(localStorage.getItem("huskv2.cmd-palette.history")!);
  expect(Object.keys(stored.records)).toHaveLength(500);
});
