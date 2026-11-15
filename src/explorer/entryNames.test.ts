import { expect, it } from "vitest";
import { displayEntryName, entryNameError } from "./entryNames";
it("accepts dotfiles, spaces and legitimate repeated dots", () => {
  for (const name of [".env", "two words.txt", "version..backup", "package.json"]) expect(entryNameError(name)).toBeNull();
});
it("makes control and bidi characters visible without changing ordinary names", () => {
  expect(displayEntryName("two words.txt")).toBe("two words.txt");
  expect(displayEntryName("line\nname\u202e.txt")).toBe("line\\u000aname\\u202e.txt");
});
it("rejects paths, traversal components and control characters", () => {
  for (const name of ["", " ", ".", "..", "../secret", "a/b", "a\\b", "name\nother", "a\0b"]) expect(entryNameError(name)).not.toBeNull();
});
