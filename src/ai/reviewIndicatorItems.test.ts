import { expect, it } from "vitest";
import { collectReviewItems, type TerminalReviewItem } from "./reviewIndicatorItems";
import type { PendingEdit } from "./pendingEdits";
import type { PendingMcpAction } from "./pendingActions";

const edit: PendingEdit = { id: "edit-1", sessionId: "a", path: "/project/add.sh", search: "before", replace: "after", timestamp: 1 };
const integration: PendingMcpAction = { id: "action-1", sessionId: "a", label: "Generated description", timestamp: 2, request: { kind: "mcp.call", serverId: "issues", toolName: "create_issue", input: {} } };
const terminal: TerminalReviewItem = { id: "run", sessionId: "a", command: "rm build.log", target: { ptyId: 1, isRemote: false, host: null, cwd: "/project" } };

it("counts only live entries owned by the current session, never unscoped or other chats", () => {
  const items = collectReviewItems("a", [edit, { ...edit, id: "foreign", sessionId: "b" }, { ...edit, id: "legacy", sessionId: undefined }], [integration, { ...integration, sessionId: "b" }], [terminal, { ...terminal, sessionId: "b" }]);
  expect(items.map((item) => [item.kind, item.id])).toEqual([["edit", "edit-1"], ["integration", "action-1"], ["terminal", "run"]]);
  expect(collectReviewItems("empty", [edit], [integration], [terminal])).toEqual([]);
});

it("uses exact file paths, remote host and actual integration identity", () => {
  const items = collectReviewItems("a", [{ ...edit, remoteHost: "prod", operation: "overwrite" }], [integration]);
  expect(items[0]).toMatchObject({ label: "Overwrite file", target: "SSH prod · /project/add.sh" });
  expect(items[1].target).toBe("issues · create_issue");
  expect(items[1].target).not.toContain("Generated description");
});

it("does not infer an unknown SSH host or folder", () => {
  const item = collectReviewItems("a", [], [], [{ ...terminal, id: "remote-run", target: { ptyId: 1, isRemote: true, host: null, cwd: "" } }])[0];
  expect(item.target).toBe("SSH host unknown · folder unknown");
});

it("shows both folders for a mismatch and the exact command without running it", () => {
  const item = collectReviewItems("a", [], [], [{ ...terminal, id: "workspace-run", workspacePath: "/other", productionTarget: "production" }])[0];
  expect(item).toMatchObject({ label: "Choose run folder", detail: "rm build.log", target: "Local terminal · /project → chat folder /other · protected target production" });
});
