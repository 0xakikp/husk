import { expect, it } from "vitest";
import { searchHistory } from "./historySearch";

const commands = (entries: string[], query = "", sort: "newest" | "relevance" = "newest") => searchHistory(entries, query, sort).matches.map((match) => match.command);

it("preserves newest-first order while browsing and searching, regardless of command length", () => {
  const entries = ["git log --all --decorate --oneline", "sudo git status", "git", "git log"];
  expect(commands(entries)).toEqual(entries);
  expect(commands(entries, "git")).toEqual(entries);
});
it("offers explicit relevance ordering with exact matches first and recency within each tier", () => {
  const entries = ["sudo git status", "git log --all --decorate", "git", "git log"];
  expect(commands(entries, "git", "relevance")).toEqual(["git", "git log --all --decorate", "git log", "sudo git status"]);
});
it("does not cap results at sixteen or rank long prefixes below shorter substrings", () => {
  const entries = Array.from({ length: 125 }, (_, index) => `git show revision-${125 - index}`);
  expect(commands(entries, "git")).toEqual(entries);
  expect(commands(["git " + "x".repeat(2000), "sudo git"], "git", "relevance")[0]).toMatch(/^git /);
});
it("matches case-insensitive fragments in any order and sorts highlight positions", () => {
  const result = searchHistory(["kubectl logs api --namespace=prod", "kubectl get pods"], "PROD logs");
  expect(result.matches).toHaveLength(1);
  expect(result.matches[0].kind).toBe("terms");
  expect(result.matches[0].matchIndices.map((index) => result.matches[0].command[index]).join("")).toBe("logsprod");
});
it("only offers fuzzy fallback when there are no literal matches", () => {
  expect(commands(["gxxixxt", "git status"], "git")).toEqual(["git status"]);
  const result = searchHistory(["git status", "get stuff", "pwd"], "gts");
  expect(result.approximate).toBe(true);
  expect(result.matches.map((match) => match.command)).toEqual(["git status", "get stuff"]);
  expect(searchHistory(["pwd"], "xyz")).toEqual({ matches: [], approximate: false });
});
it("keeps the newest duplicate and never mutates command text or the source array", () => {
  const entries = ["printf 'first\\nsecond'", "pwd", "pwd", "", "  "];
  expect(commands(entries)).toEqual([entries[0], "pwd"]);
  expect(entries).toHaveLength(5);
});
