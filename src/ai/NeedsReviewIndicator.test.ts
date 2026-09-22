// @vitest-environment happy-dom
import { act, createElement, createRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./actionBroker", () => ({ executeHuskAction: vi.fn() }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true, aiFileToolsEnabled: true, aiMcpToolsEnabled: true }) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("./pendingEdits", async (load) => ({ ...await load<typeof import("./pendingEdits")>(), applyPendingEdit: vi.fn() }));
import { NeedsReviewIndicator } from "./NeedsReviewIndicator";
import { PendingEditsReview } from "./PendingEditsReview";
import { PendingMcpActionsReview } from "./PendingMcpActionsReview";
import { addPendingEdit, applyPendingEdit, clearPendingEdits, removePendingEdit } from "./pendingEdits";
import { addPendingMcpAction, getPendingMcpActions, removePendingMcpAction } from "./pendingActions";
import { executeHuskAction } from "./actionBroker";
import { revealReviewItem } from "./reviewNavigation";
import type { TerminalReviewItem } from "./reviewIndicatorItems";

let root: Root;
let container: HTMLDivElement;
let composerRef: RefObject<HTMLDivElement | null>;
const addEdit = (sessionId = "a", path = "/project/add.sh") => addPendingEdit({ sessionId, path, workspaceRoot: "/project", search: "before", replace: "after" });
const addAction = (sessionId = "a") => addPendingMcpAction({ sessionId, label: "New issue", request: { kind: "mcp.call", serverId: "issues", toolName: "create_issue", input: { title: "Test" } } });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearPendingEdits(); getPendingMcpActions().forEach((item) => removePendingMcpAction(item.id));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container); composerRef = createRef();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(sessionId = "a", terminals: TerminalReviewItem[] = [], otherComposer = false) {
  await act(async () => root.render(createElement("div", {},
    createElement("div", { className: "composer-panel", ref: composerRef },
      createElement(NeedsReviewIndicator, { sessionId, composerRef, terminalItems: terminals }),
      createElement(PendingEditsReview, { sessionId }),
      createElement(PendingMcpActionsReview, { sessionId }),
      ...terminals.map((item) => createElement("div", { key: item.id, tabIndex: -1, "data-review-item": item.id, "data-review-kind": "terminal", "data-review-session": item.sessionId }, createElement("button", { onClick: () => executeHuskAction({ kind: "mcp.call", serverId: "must-not-run", toolName: "run", input: {} }, { fileToolsEnabled: false, mcpToolsEnabled: false }) }, "Run"))),
    ),
    otherComposer ? createElement("div", { className: "composer-panel", "data-other-composer": true }, createElement(PendingEditsReview, { sessionId }), createElement(PendingMcpActionsReview, { sessionId })) : null,
  )));
}
async function click(selector: string) { const button = document.querySelector<HTMLButtonElement>(selector); expect(button).not.toBeNull(); await act(async () => button!.click()); }

it("is absent at zero, follows real pending queues and never counts another session", async () => {
  addEdit("b"); addAction("b"); await render(); expect(document.querySelector(".needs-review-trigger")).toBeNull();
  let first!: ReturnType<typeof addEdit>;
  await act(async () => { first = addEdit(); addAction(); });
  expect(document.querySelector(".needs-review-trigger")?.textContent).toBe("Review · 2");
  await act(async () => removePendingEdit(first.id)); expect(document.querySelector(".needs-review-trigger")?.textContent).toBe("Review · 1");
  await click(".needs-review-trigger");
  await act(async () => getPendingMcpActions().filter((item) => item.sessionId === "a").forEach((item) => removePendingMcpAction(item.id)));
  expect(document.querySelector(".needs-review-trigger")).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("opens exactly the requested file card in the originating composer without applying", async () => {
  addEdit("a", "/project/first.sh"); const second = addEdit("a", "/project/second.sh");
  await render("a", [], true); await click(".needs-review-trigger");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Local · /project/second.sh");
  await click(".needs-review-popover li:nth-child(2) button");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const card = composerRef.current?.querySelector<HTMLElement>(`[data-review-item="${second.id}"]`);
  expect(card).not.toBeNull(); expect(document.activeElement).toBe(card);
  expect(document.querySelector("[data-other-composer] .pe-wrap")).toBeNull();
  expect(applyPendingEdit).not.toHaveBeenCalled(); expect(executeHuskAction).not.toHaveBeenCalled();
});

it("opens integration input for review without running or discarding the action", async () => {
  const action = addAction(); await render(); await click(".needs-review-trigger"); await click(".needs-review-item");
  expect(document.activeElement?.getAttribute("data-review-item")).toBe(action.id);
  expect(document.activeElement?.textContent).toContain('"title": "Test"');
  expect(getPendingMcpActions()).toHaveLength(1); expect(executeHuskAction).not.toHaveBeenCalled();
});

it("navigates a pending command to its existing card and never activates Run", async () => {
  const terminal: TerminalReviewItem = { id: "remote-run", sessionId: "a", command: "systemctl restart api", target: { ptyId: 2, isRemote: true, host: "prod", cwd: "/srv" } };
  await render("a", [terminal]); await click(".needs-review-trigger");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("SSH prod · /srv");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("systemctl restart api");
  await click(".needs-review-item"); expect(document.activeElement?.getAttribute("data-review-item")).toBe("remote-run");
  expect(executeHuskAction).not.toHaveBeenCalled();
});

it("closes immediately on session change and ignores stale command approvals", async () => {
  addEdit("a"); addEdit("b", "/project/other.sh"); await render(); await click(".needs-review-trigger");
  await render("b", [{ id: "run", sessionId: "a", command: "old", target: { ptyId: 1, isRemote: false, host: null, cwd: "/project" } }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull(); expect(document.querySelector(".needs-review-trigger")?.textContent).toBe("Review · 1");
  await click(".needs-review-trigger"); expect(document.querySelector('[role="dialog"]')?.textContent).toContain("other.sh"); expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("old");
});

it("supports arrow navigation and Escape returning focus to the trigger", async () => {
  addEdit(); addAction(); await render(); await click(".needs-review-trigger");
  const buttons = [...document.querySelectorAll(".needs-review-item")]; expect(document.activeElement).toBe(buttons[0]);
  await act(async () => buttons[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))); expect(document.activeElement).toBe(buttons[1]);
  await act(async () => buttons[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(document.querySelector(".needs-review-trigger"));
});

it("ignores navigation for foreign sessions and unknown queue IDs", async () => {
  const edit = addEdit(); await render();
  await act(async () => revealReviewItem(composerRef.current!, "b", { kind: "edit", id: edit.id, label: "", target: "" }));
  expect(document.querySelector(".pe-wrap")).toBeNull();
  await act(async () => revealReviewItem(composerRef.current!, "a", { kind: "edit", id: "gone", label: "", target: "" }));
  expect(document.querySelector(".pe-wrap")).toBeNull(); expect(applyPendingEdit).not.toHaveBeenCalled();
});

it("handles a queue becoming nonempty after mount and closes on outside click", async () => {
  await render(); let edit!: ReturnType<typeof addEdit>;
  await act(async () => { edit = addEdit(); });
  await click(".needs-review-trigger");
  await act(async () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))); expect(document.querySelector('[role="dialog"]')).toBeNull();
  await click(".needs-review-trigger"); await click(".needs-review-item"); expect(document.activeElement?.getAttribute("data-review-item")).toBe(edit.id);
});
