import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HuskActionContext } from "./actionBroker";

const fixtures = vi.hoisted(() => ({
  files: new Map<string, string>(),
  session: { id: "chat", workspacePath: "/workspace", workspaceEditAccess: true },
  readOnlyMcp: true,
}));
vi.mock("../fs", () => ({
  readDirScoped: vi.fn(async () => []),
  readFileScoped: vi.fn(async (path: string) => {
    if (!fixtures.files.has(path)) throw new Error("No such file or directory (os error 2)");
    return fixtures.files.get(path)!;
  }),
  writeNewFileScoped: vi.fn(async (path: string, content: string) => { fixtures.files.set(path, content); }),
  writeFileScoped: vi.fn(async (path: string, content: string) => { fixtures.files.set(path, content); }),
  deleteFileScoped: vi.fn(async (path: string) => { fixtures.files.delete(path); }),
  createDirScoped: vi.fn(async () => {}),
}));
vi.mock("./sessionStore", () => ({ getAllSessions: () => [fixtures.session] }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true, aiFileToolsEnabled: true }) }));
vi.mock("./terminalContext", () => ({ getActiveRemoteTerminal: () => ({ isRemote: false }) }));
vi.mock("../remote/remoteFs", () => ({ sshReadDirScoped: vi.fn(), sshReadFileScoped: vi.fn() }));
vi.mock("./projectLens", () => ({ loadProjectLensSnapshot: vi.fn() }));
vi.mock("./remoteProjectLens", () => ({ loadRemoteProjectLensSnapshot: vi.fn() }));
vi.mock("../mcp/store", () => ({ loadMcpServers: () => [{ id: "server", name: "Integration", enabled: true, readOnly: fixtures.readOnlyMcp }] }));
vi.mock("../mcp/client", () => ({ getAllMcpTools: () => [{ serverId: "server", name: "tool" }], callMcpTool: vi.fn() }));

import { executeHuskAction } from "./actionBroker";
import { applyPendingEdit, clearPendingEdits, getAppliedEdits, getPendingEdits, undoAppliedEdit } from "./pendingEdits";
import { getPendingMcpActions, removePendingMcpAction } from "./pendingActions";
import { createDirScoped, readFileScoped, writeFileScoped, writeNewFileScoped } from "../fs";
import { callMcpTool } from "../mcp/client";

let sequence = 0;
const context = (): HuskActionContext => ({ sessionId: fixtures.session.id, workspaceRoot: "/workspace", workspaceEditAccess: true, fileToolsEnabled: true, mcpToolsEnabled: true });

beforeEach(() => {
  clearPendingEdits();
  getPendingMcpActions().forEach((action) => removePendingMcpAction(action.id));
  fixtures.files.clear();
  fixtures.session = { id: `broker-chat-${sequence++}`, workspacePath: "/workspace", workspaceEditAccess: true };
  fixtures.readOnlyMcp = true;
});

describe("workspace action permission boundary", () => {
  it("refuses new-file and surgical-edit requests while workspace edits are off", async () => {
    for (const request of [
      { kind: "workspace.write" as const, path: "new.sh", content: "echo hi" },
      { kind: "workspace.edit" as const, path: "old.sh", search: "old", replace: "new" },
    ]) {
      expect(await executeHuskAction(request, { ...context(), workspaceEditAccess: false, autoApply: true })).toMatchObject({ state: "refused" });
    }
    expect(readFileScoped).not.toHaveBeenCalled();
    expect(getPendingEdits()).toEqual([]);
    expect(writeNewFileScoped).not.toHaveBeenCalled();
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it("queues a new file without writing until it is approved and records an undoable creation", async () => {
    const script = "echo $$ '$&'\n";
    expect(await executeHuskAction({ kind: "workspace.write", path: "new.sh", content: script }, context())).toMatchObject({ state: "queued" });
    expect(getPendingEdits()).toHaveLength(1);
    expect(getPendingEdits()[0]).toMatchObject({ operation: "create", sessionId: fixtures.session.id, workspaceRoot: "/workspace" });
    expect(writeNewFileScoped).not.toHaveBeenCalled();
    expect(createDirScoped).not.toHaveBeenCalled();
    expect(await applyPendingEdit(getPendingEdits()[0])).toMatchObject({ ok: true });
    expect(fixtures.files.get("/workspace/new.sh")).toBe(script);
    const applied = getAppliedEdits(fixtures.session.id);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ operation: "create", before: null, after: script });
    expect(await undoAppliedEdit(applied[0])).toMatchObject({ ok: true });
    expect(fixtures.files.has("/workspace/new.sh")).toBe(false);
  });

  it("allows eligible auto-apply only with the current chat's matching write permission", async () => {
    fixtures.session.workspaceEditAccess = false;
    const request = { kind: "workspace.write" as const, path: "new.txt", content: "created" };
    expect(await executeHuskAction(request, { ...context(), autoApply: true })).toMatchObject({ state: "error" });
    expect(writeNewFileScoped).not.toHaveBeenCalled();
    clearPendingEdits();
    fixtures.session.workspaceEditAccess = true;
    fixtures.session.workspacePath = "/another-project";
    expect(await executeHuskAction(request, { ...context(), autoApply: true })).toMatchObject({ state: "error" });
    expect(writeNewFileScoped).not.toHaveBeenCalled();
    clearPendingEdits();
    fixtures.session.workspacePath = "/workspace";
    expect(await executeHuskAction(request, { ...context(), autoApply: true })).toMatchObject({ state: "complete" });
    expect(getAppliedEdits(fixtures.session.id)).toHaveLength(1);
    expect(getPendingEdits()).toEqual([]);
  });

  it("keeps protected files and complete overwrites in review even with auto-apply enabled", async () => {
    expect(await executeHuskAction({ kind: "workspace.write", path: "package.json", content: "{}" }, { ...context(), autoApply: true })).toMatchObject({ state: "queued" });
    fixtures.files.set("/workspace/app.ts", "old content");
    expect(await executeHuskAction({ kind: "workspace.write", path: "app.ts", content: "replacement" }, { ...context(), autoApply: true })).toMatchObject({ state: "queued" });
    expect(getPendingEdits()[1].operation).toBe("overwrite");
    expect(writeNewFileScoped).not.toHaveBeenCalled();
    expect(writeFileScoped).not.toHaveBeenCalled();
  });

  it.each(["Permission denied", "file exceeds the read size limit", "symlink target is outside the workspace"])(
    "does not interpret a read error as a missing file: %s", async (message) => {
      vi.mocked(readFileScoped).mockRejectedValueOnce(new Error(message));
      expect(await executeHuskAction({ kind: "workspace.write", path: "file.txt", content: "new" }, context())).toMatchObject({ state: "error" });
      expect(getPendingEdits()).toEqual([]);
      expect(writeNewFileScoped).not.toHaveBeenCalled();
    },
  );

  it("does not enqueue or write after cancellation arrives during the existence read", async () => {
    const cancelled = new AbortController();
    vi.mocked(readFileScoped).mockImplementationOnce(async () => { cancelled.abort(); throw new Error("No such file or directory"); });
    const request = { kind: "workspace.write" as const, path: "new.txt", content: "must not write" };
    expect(await executeHuskAction(request, { ...context(), autoApply: true, signal: cancelled.signal })).toMatchObject({ state: "error" });
    expect(await executeHuskAction(request, { ...context(), signal: cancelled.signal })).toMatchObject({ state: "refused" });
    expect(readFileScoped).toHaveBeenCalledTimes(1);
    expect(getPendingEdits()).toEqual([]);
    expect(writeNewFileScoped).not.toHaveBeenCalled();
  });
});

describe("MCP action results", () => {
  it("preserves an integration's isError result instead of claiming completion", async () => {
    vi.mocked(callMcpTool).mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: "Permission denied by service" }] });
    expect(await executeHuskAction({ kind: "mcp.call", serverId: "server", toolName: "tool", input: {} }, context())).toMatchObject({ state: "error", result: "Permission denied by service" });
  });

  it("does not contact a mutating integration before explicit approval", async () => {
    fixtures.readOnlyMcp = false;
    const request = { kind: "mcp.call" as const, serverId: "server", toolName: "tool", input: { value: "change" } };
    expect(await executeHuskAction(request, context())).toMatchObject({ state: "queued" });
    expect(callMcpTool).not.toHaveBeenCalled();
    expect(getPendingMcpActions()[0]).toMatchObject({ sessionId: fixtures.session.id, request });
  });
});
