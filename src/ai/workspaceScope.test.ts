import { describe, expect, it } from "vitest";
import {
  currentTerminalWorkspace,
  isPathInWorkspace,
  normalizeWorkspacePath,
  resolveWorkspacePath,
  workspaceResolutionApplies,
  workspaceDisplayName,
} from "./workspaceScope";

describe("AI workspace scopes", () => {
  it("normalizes roots and checks a real path boundary", () => {
    expect(normalizeWorkspacePath("/work/husk/")).toBe("/work/husk");
    expect(isPathInWorkspace("/work/husk/src/App.tsx", "/work/husk")).toBe(true);
    expect(isPathInWorkspace("/work/husk-other/App.tsx", "/work/husk")).toBe(false);
  });

  it("resolves only paths inside the selected workspace", () => {
    expect(resolveWorkspacePath(".", "/work/husk")).toBe("/work/husk");
    expect(resolveWorkspacePath("./", "/work/husk")).toBe("/work/husk");
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

  it("uses the live terminal directory when the resolved root is stale", () => {
    expect(currentTerminalWorkspace("/tmp/husk-pilot-demo", "/work/kelex-download-engine"))
      .toBe("/tmp/husk-pilot-demo");
    expect(currentTerminalWorkspace("/work/husk/src", "/work/husk"))
      .toBe("/work/husk");
  });

  it("keeps an async resolution requested through a filesystem alias", () => {
    expect(workspaceResolutionApplies(
      "/tmp/husk-pilot-demo",
      "/private/tmp/husk-pilot-demo",
      "/tmp/husk-pilot-demo",
    )).toBe(true);
    expect(workspaceResolutionApplies(
      "/work/old-project",
      "/work/old-project",
      "/work/new-project",
    )).toBe(false);
  });

  it("normalizes Windows drive roots and resolves local file references", () => {
    expect(normalizeWorkspacePath("c:\\Users\\demo\\project\\")).toBe("C:/Users/demo/project");
    expect(normalizeWorkspacePath("c:\\")).toBe("C:/");
    expect(resolveWorkspacePath("src\\main.ts", "C:\\Users\\demo\\project")).toBe("C:/Users/demo/project/src/main.ts");
    expect(resolveWorkspacePath(".\\README.md", "C:\\Users\\demo\\project")).toBe("C:/Users/demo/project/README.md");
    expect(isPathInWorkspace("c:\\users\\DEMO\\project\\src\\main.ts", "C:\\Users\\demo\\project")).toBe(true);
    expect(workspaceDisplayName("C:\\Users\\demo\\project")).toBe("project");
  });

  it("enforces Windows drive, directory, and traversal boundaries", () => {
    const root = "C:\\Users\\demo\\project";
    expect(resolveWorkspacePath("..\\secrets.txt", root)).toBeNull();
    expect(resolveWorkspacePath("D:\\Users\\demo\\project\\file.txt", root)).toBeNull();
    expect(resolveWorkspacePath("C:\\Users\\demo\\project-other\\file.txt", root)).toBeNull();
    expect(resolveWorkspacePath("C:relative.txt", root)).toBeNull();
    expect(resolveWorkspacePath("file.txt:secret", root)).toBeNull();
    expect(normalizeWorkspacePath("\\\\?\\C:\\Users\\demo\\project")).toBe("");
    expect(normalizeWorkspacePath("\\\\.\\PhysicalDrive0")).toBe("");
  });

  it("supports UNC workspaces while preserving share boundaries", () => {
    expect(normalizeWorkspacePath("\\\\server\\share\\project\\")).toBe("//server/share/project");
    expect(resolveWorkspacePath("src\\file.ts", "\\\\server\\share\\project")).toBe("//server/share/project/src/file.ts");
    expect(isPathInWorkspace("//SERVER/SHARE/project/file.ts", "\\\\server\\share\\project")).toBe(true);
    expect(resolveWorkspacePath("\\\\server\\other-share\\file.ts", "\\\\server\\share")).toBeNull();
    expect(normalizeWorkspacePath("\\\\server")).toBe("");
  });
});
