import { describe, expect, it } from "vitest";
import {
  normalizeRemoteHost,
  normalizeRemoteWorkspace,
  resolveRemoteWorkspacePath,
} from "./remoteWorkspace";

describe("remote workspace scope", () => {
  it("accepts ordinary SSH targets and absolute roots", () => {
    expect(normalizeRemoteHost("deploy@prod-1")).toBe("deploy@prod-1");
    expect(normalizeRemoteWorkspace({ kind: "ssh", host: "prod", path: "/srv/app/" }))
      .toEqual({ kind: "ssh", host: "prod", path: "/srv/app" });
  });

  it("rejects option-like or shell-bearing SSH targets", () => {
    expect(normalizeRemoteHost("-oProxyCommand=bad")).toBe("");
    expect(normalizeRemoteHost("prod; touch /tmp/x")).toBe("");
  });

  it("keeps every resolved path inside the selected root", () => {
    expect(resolveRemoteWorkspacePath("src/main.ts", "/srv/app")).toBe("/srv/app/src/main.ts");
    expect(resolveRemoteWorkspacePath("/srv/app/README.md", "/srv/app")).toBe("/srv/app/README.md");
    expect(resolveRemoteWorkspacePath("../../etc/passwd", "/srv/app")).toBeNull();
    expect(resolveRemoteWorkspacePath("/etc/passwd", "/srv/app")).toBeNull();
    expect(resolveRemoteWorkspacePath("etc/hosts", "/")).toBe("/etc/hosts");
  });
});
