// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ saved: [{ id: "wf_1", name: "Saved", steps: ["printf saved"], stopOnError: true }] }));
vi.mock("./WorkflowDialog", () => ({ WorkflowDialog: ({ children }: { children: ReactNode }) => createElement("div", {}, children) }));
vi.mock("./store", () => ({ loadWorkflows: () => fixture.saved, saveWorkflows: vi.fn() }));
vi.mock("./execution", () => ({ captureWorkflowTarget: () => ({ leafId: 1, scope: { cwd: "/project", isRemote: false, ptyId: 7 } }), workflowTargetError: () => null, executeWorkflow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ dirname: vi.fn(async () => "/imports") }));
vi.mock("../fs", () => ({ readFileScoped: vi.fn() }));
import { WorkflowRunner } from "./WorkflowRunner";
import { WorkflowImport } from "./WorkflowImport";
import { executeWorkflow } from "./execution";
import { saveWorkflows } from "./store";
import { open } from "@tauri-apps/plugin-dialog";
import { readFileScoped } from "../fs";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.saved = [{ id: "wf_1", name: "Saved", steps: ["printf saved"], stopOnError: true }];
  vi.mocked(saveWorkflows).mockReset().mockResolvedValue(undefined); vi.mocked(executeWorkflow).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
function button(label: string) { const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function paste(text: string) {
  const input = container.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("requires review even without inputs and never executes on opening", async () => {
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(button("Run reviewed workflow").disabled).toBe(true);
  expect(container.textContent).toContain("/project"); expect(container.textContent).toContain("printf saved");
  await act(async () => container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Run reviewed workflow"); expect(executeWorkflow).toHaveBeenCalledTimes(1);
});
it("previews pasted JSON and resolves conflicts without executing anything", async () => {
  await act(async () => root.render(createElement(WorkflowImport, { onClose: vi.fn() })));
  await paste(JSON.stringify({ ...fixture.saved[0], steps: ["printf imported"] })); await click("Preview import");
  expect(saveWorkflows).not.toHaveBeenCalled(); expect(executeWorkflow).not.toHaveBeenCalled();
  expect(button("Import reviewed workflows").disabled).toBe(true);
  const select = container.querySelector("select")!;
  await act(async () => { select.value = "keep-both"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.textContent).toContain("Saved (2)"); await click("Import reviewed workflows");
  expect(vi.mocked(saveWorkflows).mock.calls[0][0]).toHaveLength(2); expect(executeWorkflow).not.toHaveBeenCalled();
});
it("invalidates preview on JSON changes and catches changed saved state", async () => {
  await act(async () => root.render(createElement(WorkflowImport, { onClose: vi.fn() })));
  await paste(JSON.stringify({ id: "new", name: "New", steps: ["printf new"] })); await click("Preview import");
  fixture.saved = []; await click("Import reviewed workflows"); expect(saveWorkflows).not.toHaveBeenCalled();
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed");
  await paste("{"); expect(button("Import reviewed workflows").disabled).toBe(true); await click("Preview import");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("valid JSON");
});
it("reads a bounded chosen file without importing until review", async () => {
  vi.mocked(open).mockResolvedValue("/imports/workflows.json"); vi.mocked(readFileScoped).mockResolvedValue(JSON.stringify(fixture.saved));
  await act(async () => root.render(createElement(WorkflowImport, { onClose: vi.fn() }))); await click("Choose JSON file…");
  expect(readFileScoped).toHaveBeenCalledWith("/imports/workflows.json", "/imports", 1024 * 1024);
  expect(saveWorkflows).not.toHaveBeenCalled(); expect(executeWorkflow).not.toHaveBeenCalled();
});
