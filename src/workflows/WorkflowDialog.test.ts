// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowDialog } from "./WorkflowDialog";

let container: HTMLDivElement;
let root: Root;
let workspaceHost: HTMLDivElement | undefined;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  workspaceHost?.remove();
  workspaceHost = undefined;
});

it("leaves existing dialogs in their default variant without an empty footer", async () => {
  workspaceHost = document.createElement("div");
  workspaceHost.setAttribute("data-workflow-run-host", "");
  document.body.append(workspaceHost);
  await act(async () => root.render(createElement(WorkflowDialog, {
    title: "Import workflows", onClose: vi.fn(), children: createElement("p", {}, "Import preview"),
  })));
  const dialog = document.querySelector(".workflow-dialog")!;
  expect(dialog.classList.contains("workflow-run-dialog")).toBe(false);
  expect(dialog.querySelector(".workflow-dialog-body")?.textContent).toBe("Import preview");
  expect(dialog.querySelector(".workflow-dialog-footer")).toBeNull();
  expect(dialog.parentElement).toBe(document.body);
  expect(workspaceHost.contains(dialog)).toBe(false);
  expect(document.querySelector(".workflow-run-layer")).toBeNull();
});

it("anchors the run dialog layer to the workspace host", async () => {
  workspaceHost = document.createElement("div");
  workspaceHost.setAttribute("data-workflow-run-host", "");
  document.body.append(workspaceHost);
  await act(async () => root.render(createElement(WorkflowDialog, {
    title: "Review workflow", variant: "run", onClose: vi.fn(),
    children: createElement("p", {}, "Commands"),
  })));
  const layer = workspaceHost.querySelector<HTMLElement>(".workflow-run-layer")!;
  expect(layer).not.toBeNull();
  expect(layer.dataset.workspace).toBe("true");
  expect(layer.parentElement).toBe(workspaceHost);
  expect(layer.querySelector(".workflow-run-dialog")).not.toBeNull();
  expect(container.querySelector("[role=dialog]")).toBeNull();
});

it("falls back to a viewport layer when no workspace host is mounted", async () => {
  await act(async () => root.render(createElement(WorkflowDialog, {
    title: "Review workflow", variant: "run", onClose: vi.fn(),
    children: createElement("p", {}, "Commands"),
  })));
  const layer = document.querySelector<HTMLElement>(".workflow-run-layer")!;
  expect(layer).not.toBeNull();
  expect(layer.dataset.workspace).toBe("false");
  expect(layer.parentElement).toBe(document.body);
  expect(layer.querySelector(".workflow-run-dialog")).not.toBeNull();
});

it("keeps the header and run actions outside the keyboard-focusable scrollable body", async () => {
  await act(async () => root.render(createElement(WorkflowDialog, {
    title: "Review workflow", variant: "run", onClose: vi.fn(),
    children: createElement("p", {}, "Commands"),
    footer: createElement("button", { type: "button" }, "Run workflow"),
  })));
  const dialog = document.querySelector(".workflow-dialog")!;
  const body = dialog.querySelector<HTMLElement>(".workflow-dialog-body")!;
  const footer = dialog.querySelector(".workflow-dialog-footer")!;
  const header = dialog.firstElementChild!;
  expect(dialog.classList.contains("workflow-run-dialog")).toBe(true);
  expect(body.textContent).toBe("Commands");
  expect(footer.textContent).toBe("Run workflow");
  expect(footer.parentElement).toBe(body.parentElement);
  expect(body.contains(footer)).toBe(false);
  expect(header.parentElement).toBe(body.parentElement);
  expect(header.contains(dialog.querySelector(".workflow-dialog-title"))).toBe(true);
  expect(header.querySelector('[aria-label="Close workflow window"]')).not.toBeNull();
  expect(body.contains(header)).toBe(false);
  expect(body.getAttribute("role")).toBe("region");
  expect(body.getAttribute("aria-label")).toBe("Workflow review content");
  expect(body.tabIndex).toBe(0);
  await act(async () => body.focus());
  expect(document.activeElement).toBe(body);
});

it("keeps the run dialog close action disabled during submission", async () => {
  const onClose = vi.fn();
  const props = { title: "Review workflow", variant: "run" as const, onClose, children: createElement("p", {}, "Commands") };
  await act(async () => root.render(createElement(WorkflowDialog, { ...props, busy: true })));
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close workflow window"]')!;
  expect(close.disabled).toBe(true);
  await act(async () => close.click());
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => root.render(createElement(WorkflowDialog, { ...props, busy: false })));
  expect(close.disabled).toBe(false);
  await act(async () => close.click());
  expect(onClose).toHaveBeenCalledTimes(1);
});
