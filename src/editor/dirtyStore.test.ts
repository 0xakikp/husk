import { afterEach, expect, it } from "vitest";
import { clearState, getFileState, markDeleted, markModified, markNew, markSaved } from "./dirtyStore";

const path = "/vault/dirty-store-test.md";
afterEach(() => clearState(path));

it("returns to clean when undo reaches the latest saved version", () => {
  markSaved(path, 1);
  markModified(path, 2);
  expect(getFileState(path)).toBe("modified");
  markModified(path, 1);
  expect(getFileState(path)).toBe("clean");
  markSaved(path, 3);
  markModified(path, 1);
  expect(getFileState(path)).toBe("modified");
  markModified(path, 3);
  expect(getFileState(path)).toBe("clean");
});

it("records the persisted baseline without marking newer edits clean", () => {
  markSaved(path, 1);
  markModified(path, 3);
  markSaved(path, 2, 3);
  expect(getFileState(path)).toBe("modified");
  markModified(path, 2);
  expect(getFileState(path)).toBe("clean");
});

it("keeps new and deleted markers until a real save", () => {
  markNew(path);
  markModified(path, 2);
  expect(getFileState(path)).toBe("new");
  markSaved(path, 2);
  expect(getFileState(path)).toBe("clean");
  markDeleted(path);
  markModified(path, 3);
  expect(getFileState(path)).toBe("deleted");
  markSaved(path, 3);
  expect(getFileState(path)).toBe("clean");
});
