import { describe, expect, it } from "vitest";
import {
  isPathInWorkspace,
  normalizeWorkspacePath,
  resolveWorkspacePath,
  workspaceDisplayName,
} from "./workspaceScope";

describe("AI workspace scopes", () => {
  it("normalizes roots and checks a real path boundary", () => {
    expect(normalizeWorkspacePath("/work/husk/")).toBe("/work/husk");
    expect(isPathInWorkspace("/work/husk/src/App.tsx", "/work/husk")).toBe(true);
    expect(isPathInWorkspace("/work/husk-other/App.tsx", "/work/husk")).toBe(false);
  });

  it("resolves only paths inside the selected workspace", () => {
    expect(resolveWorkspacePath("src/App.tsx", "/work/husk")).toBe("/work/husk/src/App.tsx");
    expect(resolveWorkspacePath("./README.md", "/work/husk")).toBe("/work/husk/README.md");
    expect(resolveWorkspacePath("/work/husk/src/App.tsx", "/work/husk")).toBe("/work/husk/src/App.tsx");
    expect(resolveWorkspacePath("../.ssh/config", "/work/husk")).toBeNull();
    expect(resolveWorkspacePath("/etc/hosts", "/work/husk")).toBeNull();
  });

  it("uses a compact label without discarding the stored absolute path", () => {
    expect(workspaceDisplayName("/work/husk")).toBe("husk");
    expect(workspaceDisplayName("")).toBe("No workspace");
  });
});
