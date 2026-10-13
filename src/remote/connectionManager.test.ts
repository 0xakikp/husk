import { describe, expect, it } from "vitest";
import { connectionInheritsSshConfig, type SshConnection } from "./connectionManager";

const legacy: SshConnection = {
  id: "imported", name: "Home", host: "houseofaki", port: 22, user: "",
  authType: "agent", tags: ["ssh-config"], connectCount: 0,
};

describe("SSH-config profile inheritance", () => {
  it("recognizes only the untouched legacy import shape", () => {
    expect(connectionInheritsSshConfig(legacy)).toBe(true);
    expect(connectionInheritsSshConfig({ ...legacy, name: "Renamed", color: "#3b82f6", connectCount: 10 })).toBe(true);
  });

  it.each<Partial<SshConnection>>([
    { tags: [] }, { user: "deploy" }, { port: 1243 }, { authType: "key" },
    { authType: "password" }, { privateKeyPath: "/fixture/key" }, { jumpHost: "bastion" },
    { password: "saved-password" }, { passphrase: "saved-passphrase" },
  ])("preserves customized legacy and manual profile settings: %j", (custom) => {
    expect(connectionInheritsSshConfig({ ...legacy, ...custom })).toBe(false);
  });

  it("honors the explicit inheritance choice rather than re-inferring it from tags", () => {
    expect(connectionInheritsSshConfig({ ...legacy, inheritSshConfig: false })).toBe(false);
    expect(connectionInheritsSshConfig({ ...legacy, inheritSshConfig: true, user: "inactive-manual-user", port: 1243, tags: [] })).toBe(true);
  });
});
