import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingEdit } from "./pendingEdits";

const fixtures = vi.hoisted(() => ({
  content: "prefix old suffix",
  session: { id: "chat", workspacePath: "/workspace", workspaceEditAccess: true, remoteWorkspace: undefined as undefined | { kind: "ssh"; host: string; path: string } },
  remote: { isRemote: false, host: "server" },
  fileToolsEnabled: true,
}));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true, aiFileToolsEnabled: fixtures.fileToolsEnabled }) }));
vi.mock("./sessionStore", () => ({ getAllSessions: () => [fixtures.session] }));
vi.mock("./terminalContext", () => ({ getActiveRemoteTerminal: () => fixtures.remote }));
vi.mock("../fs", () => ({
  readFileScoped: vi.fn(async () => fixtures.content),
  writeFileScoped: vi.fn(async (_path: string, content: string) => { fixtures.content = content; }),
  writeNewFileScoped: vi.fn(async (_path: string, content: string) => { fixtures.content = content; }),
  deleteFileScoped: vi.fn(async () => {}),
  createDirScoped: vi.fn(async () => {}),
}));
vi.mock("../remote/remoteFs", () => ({
  sshReadFileScoped: vi.fn(async () => fixtures.content),
  sshWriteFileScoped: vi.fn(async (_host: string, _root: string, _path: string, content: string) => { fixtures.content = content; }),
  sshCreateFileScoped: vi.fn(async () => {}),
  sshDeleteFileScoped: vi.fn(async () => {}),
}));

import { applyPendingEdit, getAppliedEdits, replaceVerifiedEdit, undoAppliedEdit } from "./pendingEdits";
import { createDirScoped, readFileScoped, writeFileScoped, writeNewFileScoped } from "../fs";
import { sshReadFileScoped, sshWriteFileScoped } from "../remote/remoteFs";

let sequence = 0;
function edit(overrides: Partial<PendingEdit> = {}): PendingEdit {
  return { id: "edit", sessionId: fixtures.session.id, workspaceRoot: "/workspace", path: "/workspace/file.txt", operation: "edit", search: "old", replace: "new", timestamp: 1, ...overrides };
}

beforeEach(() => {
  fixtures.content = "prefix old suffix";
  fixtures.fileToolsEnabled = true;
  fixtures.session = { id: `edit-chat-${sequence++}`, workspacePath: "/workspace", workspaceEditAccess: true, remoteWorkspace: undefined };
  fixtures.remote = { isRemote: false, host: "server" };
});

describe("verified edit application", () => {
  it("refuses existing proposals after file tools are disabled globally", async () => {
    fixtures.fileToolsEnabled = false;
    expect(await applyPendingEdit(edit())).toMatchObject({ ok: false, reason: expect.stringContaining("disabled") });
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it("rechecks the SSH host after reading a remote file", async () => {
    fixtures.remote.isRemote = true;
    fixtures.session.remoteWorkspace = { kind: "ssh", host: "server", path: "/workspace" };
    vi.mocked(sshReadFileScoped).mockImplementationOnce(async () => { fixtures.remote.host = "other-server"; return fixtures.content; });
    expect(await applyPendingEdit(edit({ remoteHost: "server" }))).toMatchObject({ ok: false, reason: expect.stringContaining("SSH host changed") });
    expect(sshWriteFileScoped).not.toHaveBeenCalled();
  });
  it.each([false, true])("inserts replacement text literally, including JavaScript replacement tokens (remote=%s)", async (remote) => {
    const replacement = "echo $$ '$&' '$`' \"$'\" '$1'";
    const proposal = edit({ replace: replacement, ...(remote ? { remoteHost: "server" } : {}) });
    if (remote) {
      fixtures.remote.isRemote = true;
      fixtures.session.remoteWorkspace = { kind: "ssh", host: "server", path: "/workspace" };
    }
    expect(await applyPendingEdit(proposal)).toMatchObject({ ok: true });
    expect(fixtures.content).toBe(`prefix ${replacement} suffix`);
    expect(getAppliedEdits(fixtures.session.id)[0]).toMatchObject({ before: "prefix old suffix", after: `prefix ${replacement} suffix` });
    expect(await undoAppliedEdit(getAppliedEdits(fixtures.session.id)[0])).toMatchObject({ ok: true });
    expect(fixtures.content).toBe("prefix old suffix");
  });

  it.each([
    { content: "old and old", search: "old", reason: "more than once" },
    { content: "aaa", search: "aa", reason: "more than once" },
    { content: "unchanged", search: "", reason: "empty search" },
    { content: "newer version", search: "old", reason: "file changed" },
  ])("refuses an unsafe surgical replacement: $reason ($content)", async ({ content, search, reason }) => {
    fixtures.content = content;
    expect(await applyPendingEdit(edit({ search }))).toMatchObject({ ok: false, reason: expect.stringContaining(reason) });
    expect(writeFileScoped).not.toHaveBeenCalled();
    expect(sshWriteFileScoped).not.toHaveBeenCalled();
  });

  it("only permits a full overwrite when the complete reviewed original still matches", () => {
    expect(replaceVerifiedEdit("", { operation: "overwrite", search: "", replace: "echo $$" })).toBe("echo $$");
    expect(() => replaceVerifiedEdit("new content", { operation: "overwrite", search: "old content", replace: "replacement" })).toThrow("file changed");
  });

  it("rechecks permission after a read and refuses writes when the user disabled edits", async () => {
    vi.mocked(readFileScoped).mockImplementationOnce(async () => { fixtures.session.workspaceEditAccess = false; return fixtures.content; });
    expect(await applyPendingEdit(edit())).toMatchObject({ ok: false, reason: expect.stringContaining("disabled") });
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it("refuses a queued edit after the chat changes to another workspace", async () => {
    const proposal = edit();
    fixtures.session.workspacePath = "/other-project";
    expect(await applyPendingEdit(proposal)).toMatchObject({ ok: false, reason: expect.stringContaining("workspace changed") });
    expect(readFileScoped).not.toHaveBeenCalled();
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it("stops before writing when cancellation arrives during the file read", async () => {
    const controller = new AbortController();
    vi.mocked(readFileScoped).mockImplementationOnce(async () => { controller.abort(); return fixtures.content; });
    expect(await applyPendingEdit(edit(), { signal: controller.signal })).toMatchObject({ ok: false, reason: expect.stringContaining("cancelled") });
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it("stops new-file creation when cancellation arrives while preparing the parent folder", async () => {
    const controller = new AbortController();
    vi.mocked(createDirScoped).mockImplementationOnce(async () => { controller.abort(); });
    expect(await applyPendingEdit(edit({ operation: "create", search: "", replace: "new file" }), { signal: controller.signal })).toMatchObject({ ok: false, reason: expect.stringContaining("cancelled") });
    expect(writeNewFileScoped).not.toHaveBeenCalled();
  });

  it("does not write back a remote file if the native layer rejects a truncated/oversized read", async () => {
    fixtures.remote.isRemote = true;
    fixtures.session.remoteWorkspace = { kind: "ssh", host: "server", path: "/workspace" };
    vi.mocked(sshReadFileScoped).mockRejectedValueOnce(new Error("File exceeds maximum read size"));
    expect(await applyPendingEdit(edit({ remoteHost: "server" }))).toMatchObject({ ok: false, reason: expect.stringContaining("maximum read size") });
    expect(sshWriteFileScoped).not.toHaveBeenCalled();
    expect(getAppliedEdits(fixtures.session.id)).toEqual([]);
  });

  it("does not undo over a user's subsequent file change", async () => {
    expect(await applyPendingEdit(edit())).toMatchObject({ ok: true });
    fixtures.content = "user changed this afterward";
    vi.mocked(writeFileScoped).mockClear();
    expect(await undoAppliedEdit(getAppliedEdits(fixtures.session.id)[0])).toMatchObject({ ok: false, reason: expect.stringContaining("cannot be undone safely") });
    expect(writeFileScoped).not.toHaveBeenCalled();
  });
});
