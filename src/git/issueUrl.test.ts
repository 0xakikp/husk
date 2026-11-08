import { expect, it } from "vitest";
import { safeIssueUrl } from "./issueUrl";

it("preserves actual GitHub and enterprise issue links", () => {
  expect(safeIssueUrl("https://github.com/team/project/issues/42", 42)).toBe("https://github.com/team/project/issues/42");
  expect(safeIssueUrl("https://git.company.example/team/project/issues/42", 42)).toBe("https://git.company.example/team/project/issues/42");
});

it.each([
  "javascript:alert(1)", "file:///tmp/secret", "http://github.com/a/b/issues/42",
  "https://user:pass@github.com/a/b/issues/42", "https://github.com/issues/42",
  "https://github.com/a/b/issues/43", "https://github.com/a/b/pull/42", "not a url", "",
])("refuses unsafe or unrelated issue URL %s", (url) => {
  expect(safeIssueUrl(url, 42)).toBeNull();
});

it("rejects missing URLs and malformed issue numbers", () => {
  expect(safeIssueUrl(null, 42)).toBeNull();
  expect(safeIssueUrl("https://github.com/a/b/issues/0", 0)).toBeNull();
  expect(safeIssueUrl("https://github.com/a/b/issues/1.2", 1.2)).toBeNull();
});
