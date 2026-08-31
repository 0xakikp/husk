import { describe, expect, it } from "vitest";
import { parseRemoteShellTarget } from "./remoteShell";

describe("parseRemoteShellTarget", () => {
  it("recognizes common ssh and mosh destinations", () => {
    expect(parseRemoteShellTarget("ssh prod")).toBe("prod");
    expect(parseRemoteShellTarget("ssh -p 2222 user@example.com")).toBe("user@example.com");
    expect(parseRemoteShellTarget("command ssh -J bastion 'root@10.0.0.8'")).toBe("root@10.0.0.8");
    expect(parseRemoteShellTarget("mosh --ssh 'ssh -p 22' devbox")).toBe("devbox");
  });

  it("does not treat options or unrelated commands as a host", () => {
    expect(parseRemoteShellTarget("ssh -o BatchMode=yes")).toBeNull();
    expect(parseRemoteShellTarget("curl https://example.com")).toBeNull();
    expect(parseRemoteShellTarget("ssh -- -oProxyCommand=bad")).toBeNull();
  });
});
