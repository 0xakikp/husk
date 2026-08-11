import { describe, expect, it } from "vitest";
import { parseWorkspaceFileReference } from "./fileReferences";

describe("workspace file references", () => {
  it("accepts a relative path with an optional line", () => {
    expect(parseWorkspaceFileReference("src/ai/client.ts:88")).toEqual({
      relativePath: "src/ai/client.ts",
      line: 88,
    });
  });

  it("accepts a root file and removes a harmless ./ prefix", () => {
    expect(parseWorkspaceFileReference("./README.md")).toEqual({ relativePath: "README.md", line: undefined });
  });

  it("rejects absolute, parent-relative, and non-path text", () => {
    expect(parseWorkspaceFileReference("/etc/passwd")).toBeNull();
    expect(parseWorkspaceFileReference("../secrets.txt")).toBeNull();
    expect(parseWorkspaceFileReference("pnpm test")).toBeNull();
  });
});
