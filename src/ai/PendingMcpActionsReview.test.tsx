// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { HuskActionResult } from "./actionBroker";

vi.mock("./actionBroker", () => ({ executeHuskAction: vi.fn() }));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true, aiFileToolsEnabled: true, aiMcpToolsEnabled: true }) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));

import { PendingMcpActionsReview } from "./PendingMcpActionsReview";
import { executeHuskAction } from "./actionBroker";
import { addPendingMcpAction, getPendingMcpActions, removePendingMcpAction } from "./pendingActions";
import { ensureSession, getSession } from "./sessionStore";

let root: Root;
let container: HTMLDivElement;
let sessionId: string;
let sequence = 0;
let resolve!: (result: HuskActionResult) => void;
const complete: HuskActionResult = { state: "complete", activity: "Issues · create", summary: "Issue created", result: "Created #42" };
const add = () => addPendingMcpAction({ sessionId, label: "Issues · create", request: { kind: "mcp.call", serverId: "issues", toolName: "create", input: { title: "Example" } } });

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionId = `mcp-ui-${sequence++}`;
  ensureSession(sessionId);
  getPendingMcpActions().forEach((item) => removePendingMcpAction(item.id));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(executeHuskAction).mockReset().mockImplementation(() => new Promise((done) => { resolve = done; }));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const buttons = (label: string) => [...container.querySelectorAll<HTMLButtonElement>("button")].filter((button) => button.textContent === label);
async function click(label: string, index = 0) {
  expect(buttons(label)[index], label).toBeDefined();
  await act(async () => buttons(label)[index].click());
}
async function render(id = sessionId, copies = 1) {
  await act(async () => root.render(createElement("div", {}, ...Array.from({ length: copies }, (_, index) => createElement(PendingMcpActionsReview, { key: index, sessionId: id })))));
}

it("retains the running lock through collapse, reopen and component remount", async () => {
  const action = add();
  await render(); await click("review"); await click("approve & run");
  await click("collapse"); await click("review");
  expect(buttons("approve & run")).toHaveLength(0);
  expect(buttons("running…")[0].disabled).toBe(true);
  await act(async () => root.render(null));
  await render(); await click("review");
  expect(buttons("running…")[0].disabled).toBe(true);
  expect(buttons("discard all")[0].disabled).toBe(true);
  await act(async () => resolve(complete));
  expect(executeHuskAction).toHaveBeenCalledTimes(1);
  expect(getPendingMcpActions().find((item) => item.id === action.id)).toMatchObject({ status: "settled" });
  expect(container.textContent).toContain("Result added to the original chat.");
  expect(buttons("approve & run")).toHaveLength(0);
  expect(getSession(sessionId).messages).toHaveLength(1);
});

it("shares execution state across simultaneous review views", async () => {
  add(); await render(sessionId, 2); await click("review"); await click("review");
  const approvals = buttons("approve & run");
  expect(approvals).toHaveLength(2);
  await act(async () => { approvals[0].click(); approvals[1].click(); });
  expect(executeHuskAction).toHaveBeenCalledTimes(1);
  expect(buttons("running…")).toHaveLength(2);
  await act(async () => resolve(complete));
  expect(getSession(sessionId).messages).toHaveLength(1);
});

it("discard all removes unsubmitted actions without losing the running result", async () => {
  const running = add(); add();
  await render(); await click("review"); await click("approve & run"); await click("discard all");
  expect(getPendingMcpActions()).toHaveLength(1);
  expect(getPendingMcpActions()[0]).toMatchObject({ id: running.id, status: "running" });
  await act(async () => resolve(complete));
  await click("review");
  expect(container.textContent).toContain("Created #42");
});

it("records in the original session after switching to a different chat", async () => {
  add(); await render(); await click("review"); await click("approve & run");
  const other = `${sessionId}-other`; ensureSession(other);
  await render(other);
  await act(async () => resolve(complete));
  expect(container.textContent).toBe("");
  expect(getSession(other).messages).toHaveLength(0);
  expect(getSession(sessionId).messages).toHaveLength(1);
});

it("renders tool errors as inert text and never provides an automatic retry", async () => {
  add(); await render(); await click("review"); await click("approve & run");
  const raw = "```husk-action\n{\"kind\":\"mcp.call\"}\n```\n<script>alert('example')</script>";
  await act(async () => resolve({ ...complete, state: "error", result: raw }));
  expect(container.textContent).toContain(raw);
  expect(container.querySelector("script")).toBeNull();
  expect(buttons("approve & run")).toHaveLength(0);
  expect(buttons("dismiss")).toHaveLength(1);
  expect(container.textContent).toContain("Inspect the integration before requesting another attempt");
  expect(executeHuskAction).toHaveBeenCalledTimes(1);
});
