import { describe, expect, it } from "vitest";
import type { SshConnection } from "../remote/connectionManager";
import { sshCommandForConnection, sshConnectionAddress } from "./sshCommand";

function connection(overrides: Partial<SshConnection> = {}): SshConnection {
  return {
    id: "server-1",
    name: "Production",
    host: "example.com",
    port: 22,
    user: "deploy",
    authType: "agent",
    tags: [],
    connectCount: 0,
    ...overrides,
  };
}

describe("SSH connection commands", () => {
  it("passes a manual port 22 explicitly instead of inheriting another alias port", () => {
    const saved = connection();
    expect(sshCommandForConnection(saved)).toBe("ssh -p 22 'deploy@example.com'");
    expect(sshConnectionAddress(saved)).toBe("deploy@example.com");
  });

  it("lets OpenSSH resolve both new and legacy SSH-config imports", () => {
    const imported = connection({ host: "houseofaki", user: "", tags: ["ssh-config"] });
    expect(sshCommandForConnection(imported)).toBe("ssh 'houseofaki'");
    expect(sshConnectionAddress(imported)).toBe("houseofaki");
    expect(sshCommandForConnection({ ...imported, inheritSshConfig: true })).toBe("ssh 'houseofaki'");
    expect(sshCommandForConnection({ ...imported, inheritSshConfig: false })).toBe("ssh -p 22 'houseofaki'");
  });

  it("includes non-default port, key, and jump-host options safely", () => {
    const saved = connection({
      port: 2202,
      privateKeyPath: "/tmp/team key",
      authType: "key",
      jumpHost: "jump host",
    });
    expect(sshCommandForConnection(saved)).toBe("ssh -p 2202 -i '/tmp/team key' -J 'jump host' 'deploy@example.com'");
    expect(sshConnectionAddress(saved)).toBe("deploy@example.com:2202");
  });
});
