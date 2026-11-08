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
vi.mock("./sessionStore", () => ({
  getAllSessions: () => [fixtures.session],
  conversationIdentity: (session: { id: string; createdAt?: number }) => `${session.id}:${session.createdAt ?? 0}`,
}));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true, aiFileToolsEnabled: true }) }));
vi.mock("./terminalContext", () => ({ getActiveRemoteTerminal: vi.fn(() => ({ isRemote: false })) }));
vi.mock("../remote/remoteFs", () => ({ sshReadDirScoped: vi.fn(), sshReadFileScoped: vi.fn() }));
vi.mock("./projectLens", () => ({ loadProjectLensSnapshot: vi.fn() }));
vi.mock("./remoteProjectLens", () => ({ loadRemoteProjectLensSnapshot: vi.fn() }));
vi.mock("./codebaseSearch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./codebaseSearch")>();
  return { ...actual, buildCodebaseIndex: vi.fn(async () => new Map()), searchCodebase: vi.fn(() => []) };
});
vi.mock("../mcp/store", () => ({ loadMcpServers: () => [{ id: "server", name: "Integration", enabled: true, readOnly: fixtures.readOnlyMcp }] }));
vi.mock("../mcp/client", () => ({ getAllMcpTools: () => [{ serverId: "server", name: "tool" }], callMcpTool: vi.fn() }));

import { executeHuskAction } from "./actionBroker";
import { applyPendingEdit, clearPendingEdits, getAppliedEdits, getPendingEdits, undoAppliedEdit } from "./pendingEdits";
import { getPendingMcpActions, removePendingMcpAction } from "./pendingActions";
import { createDirScoped, readFileScoped, writeFileScoped, writeNewFileScoped } from "../fs";
import { callMcpTool } from "../mcp/client";
import { loadProjectLensSnapshot, type ProjectLensSnapshot } from "./projectLens";
import { loadRemoteProjectLensSnapshot } from "./remoteProjectLens";
import { getActiveRemoteTerminal } from "./terminalContext";
import { sshReadFileScoped } from "../remote/remoteFs";
import { searchCodebase } from "./codebaseSearch";

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

describe("model-facing sensitive tool results", () => {
  const fakeToken = "ghp_" + "exampleForTestsOnlyNotARealToken123456";
  const guidance = /attach a reviewed, redacted excerpt/i;
  const snapshot = (content: string, sources = ["README.md"]): ProjectLensSnapshot => ({
    root: "/workspace", name: "project", generatedAt: 1, stack: [], scripts: [], topLevel: [],
    git: { isRepository: false, branch: "", changedFiles: 0 }, sources, context: content,
  });

  it.each([".env", ".env.production", "config/credentials.json", ".ssh/id_ed25519", "secrets.txt"])(
    "refuses sensitive filename %s before reading its content", async (path) => {
      fixtures.files.set(`/workspace/${path}`, "PORT=3000");
      const result = await executeHuskAction({ kind: "workspace.read", path }, context());
      expect(result).toMatchObject({ state: "refused", summary: "Sensitive file needs review", activity: "read file" });
      expect(result.result).toMatch(guidance);
      expect(result.result).toContain("did not read");
      expect(readFileScoped).not.toHaveBeenCalled();
    },
  );

  it("withholds secrets in an innocuously named file, without returning the raw output", async () => {
    fixtures.files.set("/workspace/readme.txt", `Docs\n${fakeToken}`);
    const result = await executeHuskAction({ kind: "workspace.read", path: "readme.txt" }, context());
    expect(result).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld", activity: "read file" });
    expect(result.result).toMatch(guidance);
    expect(result.result).toContain("Do not repeat");
    expect(result.result).toContain("best-effort");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
    expect(readFileScoped).toHaveBeenCalledTimes(1);
  });

  it("scans the complete returned file rather than only an initial preview", async () => {
    fixtures.files.set("/workspace/readme.txt", "ordinary text\n".repeat(10_000) + fakeToken);
    const result = await executeHuskAction({ kind: "workspace.read", path: "readme.txt" }, context());
    expect(result.summary).toBe("Completed; sensitive output withheld");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("keeps ordinary file results unchanged", async () => {
    fixtures.files.set("/workspace/app.ts", "export const answer = 42;\n");
    expect(await executeHuskAction({ kind: "workspace.read", path: "app.ts" }, context())).toEqual({
      state: "complete", summary: "Read app.ts", result: "export const answer = 42;\n", activity: "read file",
    });
  });

  it.each(["token", "DATABASE_PASSWORD"])("withholds a quoted JSON %s credential from file and MCP results", async (key) => {
    const value = "example-sensitive-value";
    const content = JSON.stringify({ [key]: value });
    fixtures.files.set("/workspace/config.json", content);
    const fileResult = await executeHuskAction({ kind: "workspace.read", path: "config.json" }, context());
    expect(fileResult.summary).toBe("Completed; sensitive output withheld");
    expect(JSON.stringify(fileResult)).not.toContain(value);
    vi.mocked(callMcpTool).mockResolvedValueOnce({ [key]: value });
    const mcpResult = await executeHuskAction({ kind: "mcp.call", serverId: "server", toolName: "tool", input: {} }, context());
    expect(mcpResult).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld" });
    expect(JSON.stringify(mcpResult)).not.toContain(value);
    expect(callMcpTool).toHaveBeenCalledTimes(1);
  });

  it("does not leak a secret contained in a filesystem error", async () => {
    vi.mocked(readFileScoped).mockRejectedValueOnce(new Error(`Read failed: ${fakeToken}`));
    const result = await executeHuskAction({ kind: "workspace.read", path: "app.ts" }, context());
    expect(result).toMatchObject({ state: "error", summary: "Failed; sensitive output withheld" });
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("protects remote named files and remote file payloads using the same boundary", async () => {
    vi.mocked(getActiveRemoteTerminal).mockReturnValue({ isRemote: true, host: "dev.example" });
    const remoteContext = { ...context(), remoteWorkspace: { kind: "ssh" as const, host: "dev.example", path: "/srv/project" } };
    expect(await executeHuskAction({ kind: "workspace.read", path: ".env" }, remoteContext)).toMatchObject({ state: "refused" });
    expect(sshReadFileScoped).not.toHaveBeenCalled();
    vi.mocked(sshReadFileScoped).mockResolvedValueOnce(fakeToken);
    const result = await executeHuskAction({ kind: "workspace.read", path: "notes.txt" }, remoteContext);
    expect(result.summary).toBe("Completed; sensitive output withheld");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("withholds sensitive Project Lens excerpts before they reach the planning model", async () => {
    vi.mocked(loadProjectLensSnapshot).mockResolvedValueOnce(snapshot(`README excerpt: ${fakeToken}`));
    const result = await executeHuskAction({ kind: "workspace.inspect" }, context());
    expect(result).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld", activity: "Project Lens" });
    expect(result.result).toMatch(guidance);
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("checks Project Lens source names even when no known secret pattern appears", async () => {
    vi.mocked(loadProjectLensSnapshot).mockResolvedValueOnce(snapshot("PORT=3000", [".env.production"]));
    expect(await executeHuskAction({ kind: "workspace.inspect" }, context())).toMatchObject({ summary: "Completed; sensitive output withheld" });
  });

  it("protects remote Project Lens output too", async () => {
    vi.mocked(getActiveRemoteTerminal).mockReturnValue({ isRemote: true, host: "dev.example" });
    vi.mocked(loadRemoteProjectLensSnapshot).mockResolvedValueOnce(snapshot(`README excerpt: ${fakeToken}`));
    const result = await executeHuskAction({ kind: "workspace.inspect" }, {
      ...context(), remoteWorkspace: { kind: "ssh", host: "dev.example", path: "/srv/project" },
    });
    expect(result.summary).toBe("Completed; sensitive output withheld");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("keeps ordinary Project Lens results unchanged", async () => {
    vi.mocked(loadProjectLensSnapshot).mockResolvedValueOnce(snapshot("This is a TypeScript project."));
    expect(await executeHuskAction({ kind: "workspace.inspect" }, context())).toEqual({
      state: "complete", summary: "Inspected project", result: "This is a TypeScript project.", activity: "Project Lens",
    });
  });

  it("withholds search snippets containing sensitive text", async () => {
    vi.mocked(searchCodebase).mockReturnValueOnce([{ path: "app.ts", score: 1, matches: [{ line: 1, text: fakeToken }], snippet: fakeToken }]);
    const result = await executeHuskAction({ kind: "workspace.search", query: "configuration" }, context());
    expect(result).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld", activity: "search workspace" });
    expect(result.result).toMatch(guidance);
    expect(JSON.stringify(result)).not.toContain(fakeToken);
  });

  it("checks source filenames in search results independently of their snippets", async () => {
    vi.mocked(searchCodebase).mockReturnValueOnce([{ path: "config/credentials.json", score: 1, matches: [], snippet: '{"region":"us-east-1"}' }]);
    expect(await executeHuskAction({ kind: "workspace.search", query: "region" }, context())).toMatchObject({ summary: "Completed; sensitive output withheld" });
  });

  it("keeps ordinary search output unchanged", async () => {
    vi.mocked(searchCodebase).mockReturnValueOnce([]);
    expect(await executeHuskAction({ kind: "workspace.search", query: "missing" }, context())).toEqual({
      state: "complete", summary: "Searched workspace for missing", result: "No matching files found in the codebase.", activity: "search workspace",
    });
  });

  it.each([true, false])("withholds completed MCP output without rerunning it (readOnly=%s)", async (readOnly) => {
    fixtures.readOnlyMcp = readOnly;
    vi.mocked(callMcpTool).mockResolvedValueOnce({ content: [{ type: "text", text: `Operation receipt: ${fakeToken}` }] });
    const result = await executeHuskAction({ kind: "mcp.call", serverId: "server", toolName: "tool", input: {} }, { ...context(), confirmMcpCall: !readOnly });
    expect(result).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld", activity: "MCP action" });
    expect(result.result).toContain("action completed");
    expect(result.result).toContain("Do not repeat");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
    expect(callMcpTool).toHaveBeenCalledTimes(1);
    expect(getPendingMcpActions()).toEqual([]);
  });

  it("preserves failed MCP outcome while withholding sensitive failure details", async () => {
    vi.mocked(callMcpTool).mockResolvedValueOnce({ isError: true, content: [{ type: "text", text: `Authentication rejected: ${fakeToken}` }] });
    const result = await executeHuskAction({ kind: "mcp.call", serverId: "server", toolName: "tool", input: {} }, context());
    expect(result).toMatchObject({ state: "error", summary: "Failed; sensitive output withheld" });
    expect(result.result).toContain("may already have had side effects");
    expect(result.result).toContain("Do not repeat");
    expect(JSON.stringify(result)).not.toContain(fakeToken);
    expect(callMcpTool).toHaveBeenCalledTimes(1);
  });

  it("protects structured MCP outputs and thrown transport errors", async () => {
    const request = { kind: "mcp.call" as const, serverId: "server", toolName: "tool", input: {} };
    vi.mocked(callMcpTool).mockResolvedValueOnce({ credential: fakeToken });
    const structured = await executeHuskAction(request, context());
    expect(structured).toMatchObject({ state: "complete", summary: "Completed; sensitive output withheld" });
    expect(JSON.stringify(structured)).not.toContain(fakeToken);
    vi.mocked(callMcpTool).mockRejectedValueOnce(new Error(`Transport error with ${fakeToken}`));
    const failed = await executeHuskAction(request, context());
    expect(failed).toMatchObject({ state: "error", summary: "Failed; sensitive output withheld" });
    expect(JSON.stringify(failed)).not.toContain(fakeToken);
  });

  it("keeps ordinary MCP result content and completion unchanged", async () => {
    vi.mocked(callMcpTool).mockResolvedValueOnce({ content: [{ type: "text", text: "Created issue 123." }] });
    expect(await executeHuskAction({ kind: "mcp.call", serverId: "server", toolName: "tool", input: {} }, context())).toEqual({
      state: "complete", summary: "Integration · tool completed", result: "Created issue 123.", activity: "Integration · tool",
    });
  });
});
