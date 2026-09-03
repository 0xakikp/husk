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
  it("uses the compact default-port form", () => {
    const saved = connection();
    expect(sshCommandForConnection(saved)).toBe("ssh 'deploy@example.com'");
    expect(sshConnectionAddress(saved)).toBe("deploy@example.com");
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
