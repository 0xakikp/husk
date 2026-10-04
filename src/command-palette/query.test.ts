import { expect, it } from "vitest";
import { parseQuery, scopeQuery } from "./query";

it.each([
  ["files: config", "file", "config"],
  ["grep: exact content", "grep", "exact content"],
  ["chats: prior discussion", "session", "prior discussion"],
  ["wall: mountain", "wallpaper", "mountain"],
  ["2fa: example", "totp", "example"],
  ["> new terminal", "command", "new terminal"],
] as const)("parses %s", (raw, kind, query) => {
  expect(parseQuery(raw)).toEqual({ kind, query });
});

it("replaces aliases or the same scope without dropping the search", () => {
  expect(scopeQuery("file", "notes: project config")).toBe("files: project config");
  expect(scopeQuery("file", "files: project config")).toBe("files: project config");
  expect(scopeQuery("grep", "f: project config")).toBe("grep: project config");
  expect(scopeQuery(null, "> new terminal")).toBe("new terminal");
});

it("preserves URLs and Windows paths as text", () => {
  expect(scopeQuery("clipboard", "https://example.test/page")).toBe("clip: https://example.test/page");
  expect(parseQuery("C:\\workspace\\file.txt")).toEqual({ kind: null, query: "C:\\workspace\\file.txt" });
});
