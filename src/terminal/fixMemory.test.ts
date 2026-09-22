import { beforeEach, expect, it, vi, type Mock } from "vitest";
import { FIX_MEMORY_KEY, FixMemoryStore, MAX_FIX_MEMORY_BYTES, MAX_REMEMBERED_FIXES, fixErrorExcerpt, parseRememberedFixes } from "./fixMemory";
import type { ComparisonRunInput } from "./runComparison";

let raw: string | null;
let storage: { getItem: Mock<(key: string) => string | null>; setItem: Mock<(key: string, value: string) => void> };
let store: FixMemoryStore;
const base: ComparisonRunInput = { leafId: 1, ptyId: 11, cwd: "/project", remoteHost: null, command: "npm test", output: "Error: Cannot find module 'widget'", exitCode: 1, at: 100 };
function run(overrides: Partial<ComparisonRunInput> = {}) { store.record({ ...base, ...overrides }); }
function resolved() {
  run(); run({ command: "npm install", output: "installed", exitCode: 0, at: 200 });
  run({ output: "tests passed", exitCode: 0, at: 300 });
  return store.getSnapshot(1)!.candidate!;
}
function save(options: { includeError?: boolean; summary?: string } = {}) {
  const candidate = resolved();
  return store.save(1, candidate.id, { title: "Install dependencies", summary: options.summary ?? "Missing dependency", stepIds: candidate.steps.map((step) => step.id), includeError: options.includeError ?? false, confirmed: true });
}
beforeEach(() => {
  raw = null;
  storage = { getItem: vi.fn(() => raw), setItem: vi.fn((_key: string, value: string) => { raw = value; }) };
  store = new FixMemoryStore(() => storage, () => 1000);
});

it("keeps failure and successful steps ephemeral until explicit save after verification", () => {
  run(); expect(store.getSnapshot(1)?.candidate).toBeNull();
  run({ command: "npm install", exitCode: 0, at: 200 });
  expect(store.getSnapshot(1)?.candidate).toBeNull(); expect(storage.setItem).not.toHaveBeenCalled();
  run({ exitCode: 0, output: "tests passed", at: 300 });
  const candidate = store.getSnapshot(1)!.candidate!;
  expect(candidate.steps.map((step) => step.command)).toEqual(["npm install", "npm test"]);
  expect(storage.setItem).not.toHaveBeenCalled();
  store.save(1, candidate.id, { title: "Dependencies", summary: "", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: true });
  expect(storage.setItem).toHaveBeenCalledTimes(1); expect(raw).not.toContain("tests passed");
  expect(raw).not.toContain("Cannot find module"); expect(raw).toContain('"errorExcerpt":""');
});

it("requires actual resolution confirmation and keeps the exact verification command", () => {
  const candidate = resolved();
  const input = { title: "Dependencies", summary: "", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: false };
  expect(() => store.save(1, candidate.id, input)).toThrow("Confirm");
  expect(() => store.save(1, candidate.id, { ...input, confirmed: true, stepIds: [candidate.steps[0].id] })).toThrow("verification");
  expect(() => store.save(1, candidate.id, { ...input, confirmed: true, stepIds: [999] })).toThrow("captured fix");
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("allows excluding unrelated successful commands without changing their order or text", () => {
  run(); run({ command: "git status", exitCode: 0, at: 150 });
  run({ command: "npm install --ignore-scripts", exitCode: 0, at: 200 }); run({ exitCode: 0, at: 300 });
  const candidate = store.getSnapshot(1)!.candidate!;
  const kept = candidate.steps.slice(1).map((step) => step.id).reverse();
  const fix = store.save(1, candidate.id, { title: "Dependencies", summary: "", stepIds: kept, includeError: true, confirmed: true });
  expect(fix.commands).toEqual(["npm install --ignore-scripts", "npm test"]);
  expect(fix.errorExcerpt).toBe(base.output);
});

it("matches real saved fixes only for the same command, error fingerprint, directory and host", () => {
  const fix = save(); run({ at: 400 });
  expect(store.getSnapshot(1)?.matches.map((match) => match.id)).toEqual([fix.id]);
  for (const overrides of [{ command: "pnpm test" }, { output: "Error: Cannot find module 'different'" }, { cwd: "/elsewhere" }, { remoteHost: "prod.example" }]) {
    run({ ...overrides, at: 500 }); expect(store.getSnapshot(1)?.matches).toEqual([]);
  }
  run({ leafId: 2, ptyId: 22, at: 600 });
  expect(store.getSnapshot(2)?.matches.map((match) => match.id)).toEqual([fix.id]);
});

it("does not combine repair steps across PTY, cwd, remote target or explicit reconnect clear", () => {
  for (const change of [{ ptyId: 12 }, { cwd: "/other" }, { remoteHost: "prod" }]) {
    resolved(); store.clear(1); run(); run({ ...change, exitCode: 0, at: 200 });
    expect(store.getSnapshot(1)).toBeNull();
  }
  run(); store.clear(1); run({ exitCode: 0, at: 200 }); expect(store.getSnapshot(1)).toBeNull();
  run(); run({ exitCode: null, at: 200 }); expect(store.getSnapshot(1)).toBeNull();
  run(); run({ remoteHost: "", exitCode: 0, at: 200 }); expect(store.getSnapshot(1)).toBeNull();
});

it("refuses stale save targets and resets on a different failure", () => {
  const candidate = resolved(); run({ command: "cargo test", output: "FAIL", at: 400 });
  expect(store.getSnapshot(1)?.candidate).toBeNull();
  expect(() => store.save(1, candidate.id, { title: "old", summary: "", stepIds: [], includeError: false, confirmed: true })).toThrow("context changed");
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("fails closed on partial failure or verification capture", () => {
  run({ truncated: true }); run({ exitCode: 0, at: 200 }); expect(store.getSnapshot(1)).toBeNull();
  run(); run({ command: "npm install", exitCode: 0, at: 200 });
  run({ exitCode: 0, at: 300, truncated: true }); expect(store.getSnapshot(1)).toBeNull();
  expect(storage.setItem).not.toHaveBeenCalled();
});

it("bounds captured steps and makes omitted steps explicit; ignores navigation", () => {
  run(); run({ command: "ls -l", exitCode: 0, at: 101 });
  for (let index = 0; index < 10; index++) run({ command: `repair ${index}`, exitCode: 0, at: 110 + index });
  run({ exitCode: 0, at: 300 }); const candidate = store.getSnapshot(1)!.candidate!;
  expect(candidate.steps).toHaveLength(6); expect(candidate.omitted).toBe(5);
  expect(candidate.steps[0].command).toBe("repair 5");
  expect(fixErrorExcerpt("Error: " + "界".repeat(2048))).toBe("");
  expect(fixErrorExcerpt(Array.from({ length: 40 }, (_, index) => `Error ${index}`).join("\n")).split("\n")).toHaveLength(8);
});

it("refuses secrets in saved notes, selected commands and optional error excerpts", () => {
  expect(() => save({ summary: "password=super-private" })).toThrow("credentials");
  store.clear(1); run(); run({ command: "PASSWORD=super-private npm install", exitCode: 0, at: 200 }); run({ exitCode: 0, at: 300 });
  let candidate = store.getSnapshot(1)!.candidate!;
  const input = { title: "Fix", summary: "", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: true };
  expect(() => store.save(1, candidate.id, input)).toThrow("credentials");
  store.clear(1); run({ output: "Error password=super-private" }); run({ exitCode: 0, at: 300 });
  candidate = store.getSnapshot(1)!.candidate!;
  expect(() => store.save(1, candidate.id, { ...input, stepIds: candidate.steps.map((step) => step.id), includeError: true })).toThrow("credentials");
  expect(storage.setItem).not.toHaveBeenCalled();
  // The previewed secret is not secretly retained if the excerpt is excluded.
  store.save(1, candidate.id, { ...input, stepIds: candidate.steps.map((step) => step.id), includeError: false });
  expect(raw).not.toContain("super-private");
});

it("loads persisted fixes with validated shape and fails closed on corrupt, oversized or sensitive storage", () => {
  save(); expect(new FixMemoryStore(() => storage).getSaved()).toHaveLength(1);
  const good = JSON.parse(raw!);
  for (const invalid of ["{", "null", "[]", JSON.stringify({ version: 2, fixes: good.fixes }), " ".repeat(MAX_FIX_MEMORY_BYTES + 1), JSON.stringify({ version: 1, fixes: [...good.fixes, ...Array(MAX_REMEMBERED_FIXES).fill(good.fixes[0])] })]) {
    expect(parseRememberedFixes(invalid)).toEqual([]);
  }
  good.fixes[0].summary = "password=super-private";
  expect(parseRememberedFixes(JSON.stringify(good))).toEqual([]);
});

it("never silently evicts saved records when full and leaves storage unchanged on write failure", () => {
  const fix = save();
  raw = JSON.stringify({ version: 1, fixes: Array.from({ length: MAX_REMEMBERED_FIXES }, (_, index) => ({ ...fix, id: `fix-${index}` })) });
  store = new FixMemoryStore(() => storage, () => 2000); storage.setItem.mockClear();
  expect(() => save()).toThrow("memory is full"); expect(storage.setItem).not.toHaveBeenCalled();
  expect(store.getSaved()).toHaveLength(MAX_REMEMBERED_FIXES);
  store.delete("fix-0"); expect(store.getSaved()).toHaveLength(MAX_REMEMBERED_FIXES - 1);
  const before = raw;
  storage.setItem.mockImplementation(() => { throw new Error("quota"); });
  expect(() => store.delete("fix-1")).toThrow("unavailable or full");
  expect(raw).toBe(before); expect(store.getSaved()).toHaveLength(MAX_REMEMBERED_FIXES - 1);
});

it("deletes only on request and immediately removes matches", () => {
  const fix = save(); run({ at: 400 }); expect(store.getSnapshot(1)?.matches).toHaveLength(1);
  storage.setItem.mockClear(); store.dismiss(1); expect(storage.setItem).not.toHaveBeenCalled();
  run({ at: 500 }); store.delete(fix.id);
  expect(store.getSnapshot(1)?.matches).toEqual([]); expect(store.getSaved()).toEqual([]);
  expect(storage.setItem).toHaveBeenCalledWith(FIX_MEMORY_KEY, JSON.stringify({ version: 1, fixes: [] }));
});
