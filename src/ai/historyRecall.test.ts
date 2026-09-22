import { expect, it } from "vitest";
import {
  HISTORY_RECALL_MAX_BYTES, HISTORY_RECALL_MAX_COMMANDS, historyRecallMetadata, historyRecallPrompt,
  parseHistoryRecall, prepareHistoryRecall, type HistoryRecallRow,
} from "./historyRecall";

const rows: HistoryRecallRow[] = [
  { command: "git status", timestamp: 1700000000, source: "Local shell history" },
  { command: "ssh -L 5432:localhost:5432 db-server", timestamp: 1700000010, source: "Local shell history" },
  { command: "kubectl port-forward svc/postgres 5432:5432", timestamp: null, host: "recorded-host" },
];

it("ranks plausible old commands into the reviewed sample without changing their text", () => {
  const recent = Array.from({ length: 100 }, (_, index) => ({ command: `echo ${index}`, timestamp: null }));
  const snapshot = prepareHistoryRecall([...recent, ...rows], "the command I used to forward Postgres");
  expect(snapshot.candidates[0].command).toBe(rows[2].command);
  expect(snapshot.candidates.some((candidate) => candidate.command === rows[1].command)).toBe(true);
  expect(snapshot.candidates.length).toBe(HISTORY_RECALL_MAX_COMMANDS);
});

it("excludes likely credentials in commands and metadata before review", () => {
  const snapshot = prepareHistoryRecall([
    ...rows, { command: "export TOKEN=secret-token-value", timestamp: null },
    { command: "echo hello", timestamp: null, source: "password=source-secret-value" },
  ], "token");
  expect(snapshot.sensitiveExcluded).toBe(2);
  expect(JSON.stringify(snapshot.candidates)).not.toContain("secret-token-value");
  expect(JSON.stringify(snapshot.candidates)).not.toContain("source-secret-value");
});

it("caps both candidate count and JSON UTF-8 bytes, excluding oversized commands whole", () => {
  const snapshot = prepareHistoryRecall(Array.from({ length: 200 }, (_, index) => ({ command: `echo ${index} ${"😀".repeat(350)}`, timestamp: null })), "echo");
  expect(snapshot.candidates.length).toBeLessThanOrEqual(HISTORY_RECALL_MAX_COMMANDS);
  expect(new TextEncoder().encode(JSON.stringify(snapshot.candidates)).byteLength).toBeLessThanOrEqual(HISTORY_RECALL_MAX_BYTES);
  expect(snapshot.omitted).toBeGreaterThan(0);
  expect(prepareHistoryRecall([{ command: "x".repeat(3000), timestamp: null }], "x").candidates).toEqual([]);
});

it("freezes actual metadata, never treating an ssh destination as an execution host", () => {
  const snapshot = prepareHistoryRecall(rows, "forward");
  const row = snapshot.candidates.find((candidate) => candidate.command === rows[1].command)!;
  expect(row.host).toBeUndefined();
  expect(historyRecallMetadata(row)).toContain("Local shell history · Host not recorded");
  const source = { command: "original", timestamp: null };
  const frozen = prepareHistoryRecall([source], "original").candidates[0]; source.command = "changed";
  expect(frozen.command).toBe("original");
});

it("does not invent unknown or invalid dates", () => {
  const snapshot = prepareHistoryRecall([{ command: "pwd", timestamp: Number.NaN }], "pwd");
  expect(snapshot.candidates[0].timestamp).toBeNull();
  expect(historyRecallMetadata(snapshot.candidates[0])).toBe("Date not recorded · Source not recorded · Host not recorded");
});

it("returns exactly the frozen saved rows, deduplicating model-selected IDs", () => {
  const candidates = prepareHistoryRecall(rows, "forward").candidates;
  const id = candidates[0].id;
  const matches = parseHistoryRecall(JSON.stringify({ matches: [id, id] }), candidates);
  expect(matches).toEqual([candidates[0]]);
  expect(matches[0]).toBe(candidates[0]);
  expect(parseHistoryRecall('{"matches":[]}', candidates)).toEqual([]);
});

it.each([
  '{"matches":["invented"]}', '{"matches":["git status"]}', '{"matches":[1]}',
  '{"matches":[],"command":"rm -rf /tmp/test"}', '{"matches":[{"id":"h1"}]}',
  '{"matches":["h1","h1","h1","h1","h1","h1","h1","h1","h1"]}',
  "not JSON",
])("rejects generated commands, fabricated IDs and malformed results: %s", (response) => {
  expect(() => parseHistoryRecall(response, prepareHistoryRecall(rows, "forward").candidates)).toThrow();
});

it("includes only reviewed candidates in the prompt and rejects empty/oversized questions", () => {
  const candidates = prepareHistoryRecall(rows, "forward").candidates.slice(0, 1);
  const prompt = JSON.parse(historyRecallPrompt("forward Postgres", candidates));
  expect(prompt).toEqual({ question: "forward Postgres", candidates });
  expect(() => historyRecallPrompt("", candidates)).toThrow();
  expect(() => historyRecallPrompt("😀".repeat(1000), candidates)).toThrow();
  expect(() => historyRecallPrompt("forward", [])).toThrow();
});

it("bounds local ranking even when an oversized query bypasses the input limit", () => {
  const prefix = "git ".repeat(512);
  expect(prepareHistoryRecall(rows, `${prefix}${"postgres ".repeat(10000)}`)).toEqual(prepareHistoryRecall(rows, prefix));
});
