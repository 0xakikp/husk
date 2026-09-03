import { describe, expect, it } from "vitest";
import {
  explorerTransferError,
  isExplorerPathWithin,
  joinExplorerPath,
  parentExplorerPath,
  replaceExplorerPath,
} from "./pathOperations";

describe("explorer path operations", () => {
  it("joins and finds parents without breaking the filesystem root", () => {
    expect(joinExplorerPath("/", "tmp")).toBe("/tmp");
    expect(joinExplorerPath("/work/", "src")).toBe("/work/src");
    expect(parentExplorerPath("/work/src/index.ts")).toBe("/work/src");
    expect(parentExplorerPath("/work")).toBe("/");
  });

  it("uses path boundaries when matching and replacing descendants", () => {
    expect(isExplorerPathWithin("/work/app/src", "/work/app")).toBe(true);
    expect(isExplorerPathWithin("/work/application", "/work/app")).toBe(false);
    expect(replaceExplorerPath("/work/app/src/a.ts", "/work/app", "/work/new")).toBe("/work/new/src/a.ts");
  });

  it("rejects no-op, out-of-workspace, and recursive destinations", () => {
    const file = { path: "/work/a.ts", name: "a.ts", isDir: false };
    const folder = { path: "/work/src", name: "src", isDir: true };
    expect(explorerTransferError(file, "/work", "/work")).toMatch(/already/);
    expect(explorerTransferError(file, "/elsewhere", "/work")).toMatch(/inside/);
    expect(explorerTransferError(folder, "/work/src/nested", "/work")).toMatch(/inside itself/);
    expect(explorerTransferError(file, "/work/src", "/work")).toBeNull();
  });
});
