// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppliedEdit, PendingEdit } from "./pendingEdits";
import type { PendingMcpAction } from "./pendingActions";

const queues = vi.hoisted(() => ({
  pending: [] as PendingEdit[],
  applied: [] as AppliedEdit[],
  mcp: [] as PendingMcpAction[],
  editsListeners: new Set<() => void>(),
  mcpListeners: new Set<() => void>(),
}));

vi.mock("./pendingEdits", () => ({
  getPendingEdits: () => [...queues.pending],
  getAppliedEdits: () => [...queues.applied],
  subscribePendingEdits: (listener: () => void) => { queues.editsListeners.add(listener); return () => queues.editsListeners.delete(listener); },
  removePendingEdit: vi.fn((id: string) => { queues.pending = queues.pending.filter((item) => item.id !== id); queues.editsListeners.forEach((listener) => listener()); }),
  applyPendingEdit: vi.fn(async (edit: PendingEdit) => ({ ok: true, path: edit.path })),
  undoAppliedEdit: vi.fn(async (edit: AppliedEdit) => ({ ok: true, path: edit.path })),
}));
vi.mock("./pendingActions", () => ({
  getPendingMcpActions: () => [...queues.mcp],
  subscribePendingMcpActions: (listener: () => void) => { queues.mcpListeners.add(listener); return () => queues.mcpListeners.delete(listener); },
  removePendingMcpAction: vi.fn((id: string) => { queues.mcp = queues.mcp.filter((item) => item.id !== id); queues.mcpListeners.forEach((listener) => listener()); }),
}));
vi.mock("./actionBroker", () => ({ executeHuskAction: vi.fn(async () => ({ state: "error", summary: "Service rejected the tool call" })) }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiFileToolsEnabled: true, aiMcpToolsEnabled: true }) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import { AppliedEditsActivity, PendingEditsReview } from "./PendingEditsReview";
import { PendingMcpActionsReview } from "./PendingMcpActionsReview";
import { applyPendingEdit, undoAppliedEdit } from "./pendingEdits";
import { removePendingMcpAction } from "./pendingActions";
import { executeHuskAction } from "./actionBroker";
import { toast } from "../toast";

function pending(sessionId: string, suffix = ""): PendingEdit {
  return { id: `${sessionId}${suffix}`, sessionId, path: `/project/${sessionId}${suffix}.txt`, workspaceRoot: "/project", search: "old", replace: "new", timestamp: 1 };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  queues.pending = [];
  queues.applied = [];
  queues.mcp = [];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function click(label: string) {
  const button = Array.from(container.querySelectorAll("button")).find((value) => value.textContent === label);
  expect(button, `Expected a ${label} button`).toBeDefined();
  await act(async () => button!.click());
}

describe("session-scoped review UI", () => {
  it("switches pending edits immediately and applies only the newly selected chat", async () => {
    queues.pending = [pending("a"), pending("b"), { ...pending("legacy"), sessionId: undefined }];
    await act(async () => root.render(createElement(PendingEditsReview, { sessionId: "a" })));
    await click("review");
    expect(container.textContent).toContain("a.txt");
    await act(async () => root.render(createElement(PendingEditsReview, { sessionId: "b" })));
    expect(container.textContent).not.toContain("a.txt");
    expect(container.textContent).toContain("1 proposed edit");
    await click("review");
    expect(container.textContent).toContain("b.txt");
    expect(container.textContent).not.toContain("legacy.txt");
    await click("apply all");
    expect(applyPendingEdit).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyPendingEdit).mock.calls[0][0].sessionId).toBe("b");
  });

  it("lets users inspect every removed and added line before approval", async () => {
    queues.pending = [{ ...pending("a"), search: "1\n2\n3\n4\n5\n6\nlast removed", replace: "a\nb\nc\nd\ne\nf\nlast added" }];
    await act(async () => root.render(createElement(PendingEditsReview, { sessionId: "a" })));
    await click("review");
    expect(container.textContent).not.toContain("last removed");
    expect(container.textContent).not.toContain("last added");
    await click("show complete diff");
    expect(container.textContent).toContain("last removed");
    expect(container.textContent).toContain("last added");
    expect(applyPendingEdit).not.toHaveBeenCalled();
  });

  it("switches Undo to the selected chat without waiting for another edit event", async () => {
    queues.applied = ["a", "b"].map((sessionId) => ({ ...pending(sessionId), operation: "edit", workspaceRoot: "/project", before: "old", after: "new" }));
    await act(async () => root.render(createElement(AppliedEditsActivity, { sessionId: "a" })));
    await click("show diff");
    expect(container.textContent).toContain("a.txt");
    await act(async () => root.render(createElement(AppliedEditsActivity, { sessionId: "b" })));
    expect(container.textContent).not.toContain("a.txt");
    await click("undo latest");
    expect(vi.mocked(undoAppliedEdit).mock.calls[0][0].sessionId).toBe("b");
  });

  it("shows only the selected chat's MCP approvals and keeps failed actions for review", async () => {
    queues.mcp = ["a", "b"].map((sessionId) => ({ id: sessionId, sessionId, label: `Tool ${sessionId}`, timestamp: 1, request: { kind: "mcp.call", serverId: sessionId, toolName: "write", input: { chat: sessionId } } }));
    await act(async () => root.render(createElement(PendingMcpActionsReview, { sessionId: "a" })));
    await click("review");
    expect(container.textContent).toContain("Tool a");
    await act(async () => root.render(createElement(PendingMcpActionsReview, { sessionId: "b" })));
    expect(container.textContent).not.toContain("Tool a");
    await click("review");
    await click("approve & run");
    expect(executeHuskAction).toHaveBeenCalledWith(expect.objectContaining({ serverId: "b" }), expect.objectContaining({ sessionId: "b", confirmMcpCall: true }));
    expect(removePendingMcpAction).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ variant: "error", message: "Service rejected the tool call" }));
  });
});
