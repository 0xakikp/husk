import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HuskActionResult } from "./actionBroker";

const settings = vi.hoisted(() => ({ aiEnabled: true as boolean | undefined, aiFileToolsEnabled: true, aiMcpToolsEnabled: true as boolean | undefined }));
vi.mock("./actionBroker", () => ({ executeHuskAction: vi.fn() }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => settings }));

import { executeHuskAction } from "./actionBroker";
import { addPendingMcpAction, claimPendingMcpAction, getPendingMcpActions, removePendingMcpAction, settlePendingMcpAction } from "./pendingActions";
import { runPendingMcpAction } from "./pendingMcpExecution";
import { clearSessionConversation, deleteSession, ensureSession, getSession, setActiveSessionId } from "./sessionStore";

const complete: HuskActionResult = { state: "complete", activity: "Issues · create", summary: "Issue created", result: "Created issue #42" };
const request = () => ({ kind: "mcp.call" as const, serverId: "issues", toolName: "create", input: { title: "Example" } });
let sequence = 0;
let sessionId: string;
const add = (id: string | undefined = sessionId) => addPendingMcpAction({ sessionId: id, label: "Issues · create", request: request() });
const entry = (id: string) => getPendingMcpActions().find((item) => item.id === id);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  settings.aiEnabled = true;
  settings.aiMcpToolsEnabled = true;
  sessionId = `mcp-test-${sequence++}`;
  ensureSession(sessionId);
  vi.mocked(executeHuskAction).mockReset().mockResolvedValue(complete);
  getPendingMcpActions().forEach((item) => removePendingMcpAction(item.id));
});

describe("queue-owned integration approval", () => {
  it.each(["aiEnabled", "aiMcpToolsEnabled"] as const)("refuses queued approvals after %s is revoked and never revives them", async (permission) => {
    const action = add();
    settings[permission] = false;
    expect(await runPendingMcpAction(action.id)).toMatchObject({ state: "refused", result: expect.stringContaining("Nothing ran") });
    expect(executeHuskAction).not.toHaveBeenCalled();
    expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: true, outcome: { state: "refused" } });
    expect(getSession(sessionId).messages).toHaveLength(1);
    expect(getSession(sessionId).messages[0].content).toContain("Status: refused");
    settings[permission] = true;
    expect(await runPendingMcpAction(action.id)).toBeUndefined();
    expect(executeHuskAction).not.toHaveBeenCalled();
    await runPendingMcpAction(add().id);
    expect(executeHuskAction).toHaveBeenCalledTimes(1);
  });

  it.each(["aiEnabled", "aiMcpToolsEnabled"] as const)("fails closed when %s is absent", async (permission) => {
    const action = add();
    settings[permission] = undefined;
    expect(await runPendingMcpAction(action.id)).toMatchObject({ state: "refused" });
    expect(executeHuskAction).not.toHaveBeenCalled();
  });

  it("retains the actual outcome if permission is revoked after submission", async () => {
    const task = deferred<HuskActionResult>();
    vi.mocked(executeHuskAction).mockReturnValue(task.promise);
    const action = add();
    const execution = runPendingMcpAction(action.id);
    settings.aiEnabled = false;
    settings.aiMcpToolsEnabled = false;
    task.resolve(complete);
    expect(await execution).toEqual(complete);
    expect(executeHuskAction).toHaveBeenCalledTimes(1);
    expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: true, outcome: complete });
    expect(getSession(sessionId).messages[0].content).toContain("Created issue #42");
  });

  it("claims synchronously and allows only one execution even before any render", async () => {
    const task = deferred<HuskActionResult>();
    vi.mocked(executeHuskAction).mockReturnValue(task.promise);
    const action = add();
    const first = runPendingMcpAction(action.id);
    expect(entry(action.id)?.status).toBe("running");
    expect(await runPendingMcpAction(action.id)).toBeUndefined();
    expect(claimPendingMcpAction(action.id)).toBeNull();
    expect(executeHuskAction).toHaveBeenCalledTimes(1);
    task.resolve(complete);
    await first;
    expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: true, outcome: complete });
    expect(await runPendingMcpAction(action.id)).toBeUndefined();
    expect(getSession(sessionId).messages).toHaveLength(1);
    expect(settlePendingMcpAction(action.id, complete, true)).toBe(false);
  });

  it("cannot discard running calls, while pending and settled calls can be removed", async () => {
    const task = deferred<HuskActionResult>();
    vi.mocked(executeHuskAction).mockReturnValue(task.promise);
    const running = add();
    const pending = add();
    const execution = runPendingMcpAction(running.id);
    expect(removePendingMcpAction(running.id)).toBe(false);
    expect(removePendingMcpAction(pending.id)).toBe(true);
    task.resolve(complete);
    await execution;
    expect(removePendingMcpAction(running.id)).toBe(true);
    expect(await runPendingMcpAction(running.id)).toBeUndefined();
  });

  it("captures input at proposal time and does not persist the request's credentials", async () => {
    const original = request();
    original.input.title = "token=example-super-secret";
    const action = addPendingMcpAction({ sessionId, label: "Issues · create", request: original });
    original.input.title = "changed after review";
    await runPendingMcpAction(action.id);
    expect(executeHuskAction).toHaveBeenCalledWith(expect.objectContaining({ input: { title: "token=example-super-secret" } }), expect.objectContaining({ confirmMcpCall: true, sessionId }));
    expect(JSON.stringify(getSession(sessionId).messages)).not.toContain("example-super-secret");
  });

  it("records a raw, bounded receipt only in the originating chat", async () => {
    const other = `${sessionId}-other`;
    ensureSession(other);
    const task = deferred<HuskActionResult>();
    vi.mocked(executeHuskAction).mockReturnValue(task.promise);
    const action = add();
    const execution = runPendingMcpAction(action.id);
    setActiveSessionId(other);
    task.resolve({ ...complete, result: `\`\`\`husk-action\n{"kind":"mcp.call"}\n\`\`\`\n${"x".repeat(30_000)}` });
    await execution;
    const messages = getSession(sessionId).messages;
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: `integration-result-${action.id}`, kind: "integration-result", role: "user" });
    expect(messages[0].content).toContain("```husk-action");
    expect(messages[0].content).toContain("[Result truncated]");
    expect(messages[0].content.length).toBeLessThan(18_000);
    expect(getSession(other).messages).toEqual([]);
    expect(executeHuskAction).toHaveBeenCalledTimes(1);
  });

  it.each(["clear", "delete", "recreate"])("keeps the result outside chat after %s while a call is running", async (operation) => {
    const task = deferred<HuskActionResult>();
    vi.mocked(executeHuskAction).mockReturnValue(task.promise);
    const action = add();
    const execution = runPendingMcpAction(action.id);
    if (operation === "clear") clearSessionConversation(sessionId);
    else {
      deleteSession(sessionId);
      if (operation === "recreate") ensureSession(sessionId);
    }
    const globalCount = getSession("global").messages.length;
    task.resolve(complete);
    await execution;
    expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: false, outcome: complete });
    expect(getSession(sessionId).messages).toHaveLength(operation === "delete" ? globalCount : 0);
    expect(getSession("global").messages).toHaveLength(globalCount);
  });

  it("refuses stale, deleted, missing and unscoped approvals without execution", async () => {
    const stale = add();
    clearSessionConversation(sessionId);
    const removed = add();
    deleteSession(sessionId);
    const missing = add(`${sessionId}-missing`);
    const unscoped = addPendingMcpAction({ label: "Unscoped", request: request() });
    for (const action of [stale, removed, missing, unscoped]) {
      expect(await runPendingMcpAction(action.id)).toMatchObject({ state: "refused" });
      expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: false });
    }
    expect(executeHuskAction).not.toHaveBeenCalled();
  });

  it.each(["reported", "thrown"])("settles %s failures without a retryable approval", async (failure) => {
    if (failure === "thrown") vi.mocked(executeHuskAction).mockRejectedValue(new Error("Connection ended"));
    else vi.mocked(executeHuskAction).mockResolvedValue({ ...complete, state: "error", summary: "Service rejected the operation" });
    const action = add();
    expect(await runPendingMcpAction(action.id)).toMatchObject({ state: "error" });
    expect(entry(action.id)).toMatchObject({ status: "settled", receiptSaved: true });
    expect(await runPendingMcpAction(action.id)).toBeUndefined();
    expect(executeHuskAction).toHaveBeenCalledTimes(1);
    expect(getSession(sessionId).messages[0].content).toContain("Status: error");
  });

  it.each(["result", "summary", "activity"] as const)("withholds credentials in %s from both queue results and persistent receipts", async (field) => {
    vi.mocked(executeHuskAction).mockResolvedValue({ ...complete, [field]: "token=example-super-secret" });
    const action = add();
    await runPendingMcpAction(action.id);
    expect(entry(action.id)?.outcome?.result).toContain("possible credentials");
    expect(JSON.stringify(entry(action.id)?.outcome)).not.toContain("example-super-secret");
    expect(JSON.stringify(getSession(sessionId).messages)).not.toContain("example-super-secret");
  });

  it("scans credentials before truncation and sanitizes thrown error output", async () => {
    vi.mocked(executeHuskAction).mockResolvedValueOnce({ ...complete, result: `${"x".repeat(30_000)}\ntoken=example-super-secret` });
    const action = add();
    await runPendingMcpAction(action.id);
    expect(entry(action.id)?.outcome?.result).toContain("possible credentials");
    vi.mocked(executeHuskAction).mockRejectedValueOnce(new Error("Bearer exampleToken123456"));
    const failure = add();
    await runPendingMcpAction(failure.id);
    expect(JSON.stringify(getSession(sessionId).messages)).not.toContain("exampleToken123456");
  });

  it.each(["token", "AWS_SECRET_ACCESS_KEY"])("withholds a JSON result with a quoted %s credential key", async (key) => {
    vi.mocked(executeHuskAction).mockResolvedValue({ ...complete, result: JSON.stringify({ [key]: "example-super-secret" }) });
    const action = add();
    await runPendingMcpAction(action.id);
    expect(entry(action.id)?.outcome?.result).toContain("possible credentials");
    expect(JSON.stringify(getSession(sessionId).messages)).not.toContain("example-super-secret");
  });
});
