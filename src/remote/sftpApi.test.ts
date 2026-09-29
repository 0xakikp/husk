import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
import { invoke } from "@tauri-apps/api/core";
import { sftpConnect, sftpCopy, sftpDownload, sftpDownloadDir, sftpRename, sftpUpload, sftpUploadDir } from "./sftpApi";

beforeEach(() => { vi.mocked(invoke).mockClear(); });

it("passes native connection identity, public target, transient credentials and verified fingerprint separately", async () => {
  const target = { host: "alias", user: "dev", port: 2200 };
  await sftpConnect("sftp-session-fixture", target, { passphrase: "transient-test-value" }, "SHA256:verified");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("sftp_connect", { host: "sftp-session-fixture", target, credentials: { passphrase: "transient-test-value" }, expectedFingerprint: "SHA256:verified" });
});

it("does not assume initial fingerprint approval or credentials", async () => {
  await sftpConnect("session", { host: "alias" });
  expect(invoke).toHaveBeenCalledExactlyOnceWith("sftp_connect", { host: "session", target: { host: "alias" }, credentials: {}, expectedFingerprint: undefined });
});

it("defaults all transfer and remote copy/move APIs to no overwrite", async () => {
  await sftpUpload("session", "/local/file", "./remote", "one");
  await sftpDownload("session", "./remote", "/local/file", "two");
  await sftpUploadDir("session", "/local/folder", ".", "three");
  await sftpDownloadDir("session", "./folder", "/local", "four");
  await sftpCopy("session", "./from", "./to");
  await sftpRename("session", "./from", "./to");
  expect(invoke).toHaveBeenCalledTimes(6);
  for (const [, payload] of vi.mocked(invoke).mock.calls) expect(payload).toEqual(expect.objectContaining({ host: "session", allowOverwrite: false }));
  expect(invoke).toHaveBeenCalledWith("sftp_upload_dir", expect.objectContaining({ conflictMode: "merge" }));
});

it("passes overwrite permission only when the caller explicitly opts in", async () => {
  await sftpUpload("session", "/local/file", "./remote", "one", true, true);
  await sftpDownload("session", "./remote", "/local/file", "two", false, true);
  await sftpUploadDir("session", "/local/folder", ".", "three", true, "merge", true);
  await sftpDownloadDir("session", "./folder", "/local", "four", true, true);
  await sftpCopy("session", "./from", "./to", true);
  await sftpRename("session", "./from", "./to", true);
  for (const [, payload] of vi.mocked(invoke).mock.calls) expect(payload).toEqual(expect.objectContaining({ allowOverwrite: true }));
});
