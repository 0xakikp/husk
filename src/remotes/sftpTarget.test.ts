import { describe, expect, it } from "vitest";
import type { SshConnection } from "../remote/connectionManager";
import { decodeSftpTarget, encodeSftpTarget, parseSshFileTarget, sftpTargetFromConnection, sftpTargetLabel, validateSftpTarget } from "./sftpTarget";

describe("SFTP public target metadata", () => {
  it("round trips connection details without serializing credentials or unrelated profile data", () => {
    const target = { host: "prod-alias", user: "engineer", port: 2222, identityFile: "/keys/deploy key", authType: "key" as const, jumpHost: "bastion", password: "never-export", passphrase: "never-export-either", privateKey: "private-key-bytes", arbitrary: "ignored" };
    const encoded = encodeSftpTarget(target);
    expect(decodeURIComponent(encoded)).not.toMatch(/never-export|private-key-bytes|arbitrary|password|passphrase/);
    expect(decodeSftpTarget(encoded)).toEqual({ host: "prod-alias", user: "engineer", port: 2222, identityFile: "/keys/deploy key", authType: "key", jumpHost: "bastion" });
  });

  it("extracts only public settings from a saved profile", () => {
    const profile: SshConnection = { id: "test", name: "Production", host: "prod.example", port: 2200, user: "dev", authType: "key", privateKeyPath: "/fixture/key", passphrase: "secret", password: "secret", jumpHost: "jump.example", tags: [], connectCount: 1 };
    expect(sftpTargetFromConnection(profile)).toEqual({ host: "prod.example", port: 2200, user: "dev", authType: "key", identityFile: "/fixture/key", jumpHost: "jump.example" });
    expect(sftpTargetFromConnection({ ...profile, authType: "password" })).not.toHaveProperty("identityFile");
  });

  it("decodes existing aliases and literal user-host references", () => {
    expect(decodeSftpTarget("prod-alias")).toEqual({ host: "prod-alias" });
    expect(decodeSftpTarget("dev@host.example")).toEqual({ host: "host.example", user: "dev" });
    expect(sftpTargetLabel({ host: "host.example", user: "dev", port: 2222 })).toBe("dev@host.example:2222");
  });

  it.each([
    null, {}, { host: "" }, { host: "-oProxyCommand=bad" }, { host: "bad host" },
    { host: "good", user: "-root" }, { host: "good", user: "a@b" },
    { host: "good", port: 0 }, { host: "good", port: 65536 }, { host: "good", port: 22.5 },
    { host: "good", port: "22" }, { host: "good", identityFile: "bad\nkey" },
    { host: "good", jumpHost: "bad\rhost" }, { host: "good", authType: "unsupported" },
  ])("rejects invalid connection details: %j", (target) => {
    expect(() => validateSftpTarget(target)).toThrow();
  });

  it("rejects malformed encoded references", () => {
    expect(() => decodeSftpTarget("husk-sftp:%zz")).toThrow();
    expect(() => decodeSftpTarget("husk-sftp:%7B%7D")).toThrow();
  });
});

describe("strict terminal SSH target inference", () => {
  it.each([
    ["ssh dev@host.example", { host: "host.example", user: "dev" }],
    ["command /usr/bin/ssh -vv -tt -p 2222 -l dev prod", { host: "prod", port: 2222, user: "dev" }],
    ["/bin/ssh -p2200 -ldev -i '/fixture/key with spaces' prod", { host: "prod", port: 2200, user: "dev", identityFile: "/fixture/key with spaces", authType: "key" }],
    ["ssh -- dev@[2001:db8::1]", { host: "[2001:db8::1]", user: "dev" }],
    ["ssh -J jump.example dev@prod", { host: "prod", user: "dev", jumpHost: "jump.example" }],
  ])("infers only literal supported SSH metadata from %s", (command, target) => {
    expect(parseSshFileTarget(command as string)).toEqual(target);
  });

  it.each([
    "", "ssh", "ssh -p", "ssh -p nope host", "ssh -p0 host", "ssh -p65536 host", "ssh -p22 -p23 host",
    "ssh -l alice bob@host", "ssh -i key1 -i key2 host", "ssh -J one -J two host",
    "ssh -o ProxyCommand=proxy host", "ssh -F alternate-config host", "ssh -A host", "ssh -L 8000:localhost:80 host", "ssh host ls", "ssh host ssh inner",
    "ssh host; ls", "ssh host && whoami", "ssh host | tee output", "ssh host > output", "ssh $DESTINATION", "ssh `hostname`", "ssh $(hostname)", "ssh host\nexit",
    "ssh 'unterminated", "ssh host\\", "sudo ssh host", "mosh host", "kubectl exec -it pod -- sh", "ssh user@host@other",
  ])("declines ambiguous, unsupported, or shell-expanded command %s", (command) => {
    expect(parseSshFileTarget(command)).toBeNull();
  });

  it("does not interpret app-internal encoded metadata as a literal ssh destination", () => {
    expect(parseSshFileTarget(`ssh ${encodeSftpTarget({ host: "actual-host", user: "dev" })}`)).toBeNull();
  });
});
