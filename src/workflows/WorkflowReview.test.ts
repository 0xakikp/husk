// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { WorkflowTarget } from "./execution";
import type { Workflow } from "./store";
const fixture = vi.hoisted(() => ({
  saved: [{ id: "wf_1", name: "Saved", steps: ["printf saved"], stopOnError: true }],
  target: { leafId: 1, scope: { cwd: "/project", isRemote: false, host: null, ptyId: 7, scopeToken: "session:7" } } as WorkflowTarget | null,
  promptError: null as string | null,
}));
vi.mock("./WorkflowDialog", () => ({
  WorkflowDialog: ({ children, footer, variant }: { children: ReactNode; footer?: ReactNode; variant?: string }) => createElement("div", { "data-dialog-variant": variant },
    createElement("div", { className: "workflow-dialog-body" }, children),
    footer && createElement("div", { className: "workflow-dialog-footer" }, footer)),
}));
vi.mock("./store", () => ({ loadWorkflows: () => fixture.saved, saveWorkflows: vi.fn() }));
vi.mock("./execution", () => ({
  captureWorkflowTarget: vi.fn(() => fixture.target),
  workflowTargetError: (target: WorkflowTarget | null) => {
    if (!target) return "No verified terminal. Refresh target.";
    if (!fixture.target || target.leafId !== fixture.target.leafId || target.scope.scopeToken !== fixture.target.scope.scopeToken || target.scope.cwd !== fixture.target.scope.cwd) return "The terminal, directory, or connection changed. Refresh target.";
    return fixture.promptError;
  },
  executeWorkflow: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("@tauri-apps/api/path", () => ({ dirname: vi.fn(async () => "/imports") }));
vi.mock("../fs", () => ({ readFileScoped: vi.fn() }));
import { WorkflowRunner } from "./WorkflowRunner";
import { WorkflowImport } from "./WorkflowImport";
import { captureWorkflowTarget, executeWorkflow } from "./execution";
import { compileWorkflow } from "./params";
import { clearCurrentCommand, setActiveTerminalCwd, setActiveTerminalExit, setCurrentCommand } from "../ai/terminalContext";
import { saveWorkflows } from "./store";
import { open } from "@tauri-apps/plugin-dialog";
import { readFileScoped } from "../fs";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.saved = [{ id: "wf_1", name: "Saved", steps: ["printf saved"], stopOnError: true }];
  fixture.target = { leafId: 1, scope: { cwd: "/project", isRemote: false, host: null, ptyId: 7, scopeToken: "session:7" } };
  fixture.promptError = null;
  setActiveTerminalCwd("/project"); setActiveTerminalExit(null); clearCurrentCommand();
  vi.mocked(saveWorkflows).mockReset().mockResolvedValue(undefined); vi.mocked(executeWorkflow).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
function button(label: string) { const found = [...container.querySelectorAll("button")].find((node) => node.textContent === label); expect(found, label).toBeDefined(); return found!; }
async function click(label: string) { await act(async () => button(label).click()); }
async function paste(text: string) {
  const input = container.querySelector("textarea")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
async function fillInput(value: string, type = "text") {
  const input = container.querySelector<HTMLInputElement>(`input[type="${type}"]`)!;
  expect(input).not.toBeNull();
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
}
it("opens a runnable command preview without approval checkboxes or executing", async () => {
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(button("Run workflow").disabled).toBe(false);
  expect(container.querySelector('input[type="checkbox"]')).toBeNull();
  expect(container.textContent).not.toContain("I reviewed");
  expect(container.textContent).toContain("/project"); expect(container.textContent).toContain("printf saved");
  expect(container.querySelector("details pre")?.textContent).toBe(compileWorkflow(fixture.saved[0], {}).command);
});
it("keeps the target and ordered command rows visible while execution details start collapsed", async () => {
  const workflow: Workflow = { id: "ordered", name: "Prepare project", steps: ["pwd", "git status", "printf ready"], stepTitles: ["Check directory", "", "Ready"] };
  await act(async () => root.render(createElement(WorkflowRunner, { workflow, onClose: vi.fn() })));
  expect(container.querySelector('[data-dialog-variant="run"]')).not.toBeNull();
  const target = container.querySelector('[aria-label="Target terminal"]')!;
  expect(target).not.toBeNull();
  expect(target.textContent).toContain("/project");
  expect(target.closest("details")).toBeNull();
  const rows = [...container.querySelectorAll("ol.wf-run-steps > li.wf-run-step")];
  expect(rows).toHaveLength(3);
  expect(container.querySelector(".wf-run-count")?.textContent).toBe("3");
  expect(rows.map((row) => row.querySelector(".wf-run-step-number")?.textContent)).toEqual(["1", "2", "3"]);
  expect(rows.map((row) => row.querySelector("pre")?.textContent)).toEqual(workflow.steps);
  expect(rows[0].textContent).toContain("Check directory");
  expect(rows[1].textContent).not.toContain("Command");
  expect(rows[2].textContent).toContain("Ready");
  expect(rows.every((row) => row.closest("details") === null)).toBe(true);
  expect(container.querySelector("article.wf-step")).toBeNull();
  const details = container.querySelector("details")!;
  expect(details.open).toBe(false);
  expect(details.querySelector("summary")?.textContent).toBe("Execution details");
  expect(details.textContent).toContain("one POSIX sh process");
  expect(details.querySelector("pre")?.textContent).toBe(compileWorkflow(workflow, {}).command);
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it.each([
  [true, "Stops on error", "Stops when a step returns a nonzero exit status."],
  [false, "Continues on error", "Continues after a failed step."],
] as const)("shows the stopOnError=%s policy without expanding execution details", async (stopOnError, label, explanation) => {
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: { ...fixture.saved[0], stopOnError }, onClose: vi.fn() })));
  const policy = container.querySelector(".wf-run-policy")!;
  expect(policy.textContent).toBe(label);
  expect(policy.closest("details")).toBeNull();
  expect(container.querySelector("details")?.textContent).toContain(explanation);
  expect(container.querySelector("details")?.open).toBe(false);
});
it("places Cancel and Run workflow outside the scrolling preview body", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose })));
  const body = container.querySelector(".workflow-dialog-body")!;
  const footer = container.querySelector(".workflow-dialog-footer")!;
  expect(footer).not.toBeNull();
  expect(body.contains(footer)).toBe(false);
  expect(footer.contains(button("Cancel"))).toBe(true);
  expect(footer.contains(button("Run workflow"))).toBe(true);
  expect(body.contains(button("Run workflow"))).toBe(false);
  await click("Cancel");
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it("submits exactly the previewed command once and closes after success", async () => {
  const onClose = vi.fn();
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose })));
  await click("Run workflow");
  expect(executeWorkflow).toHaveBeenCalledExactlyOnceWith(fixture.saved[0], {}, fixture.target, compileWorkflow(fixture.saved[0], {}).command);
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("blocks duplicate clicks synchronously and keeps submission controls disabled while pending", async () => {
  let finish!: () => void;
  vi.mocked(executeWorkflow).mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
  const onClose = vi.fn();
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose })));
  const run = button("Run workflow");
  await act(async () => { run.click(); run.click(); });
  expect(executeWorkflow).toHaveBeenCalledTimes(1);
  expect(button("Submitting…").disabled).toBe(true);
  expect(button("Refresh target").disabled).toBe(true);
  expect(button("Cancel").disabled).toBe(true);
  expect(onClose).not.toHaveBeenCalled();
  await act(async () => run.click());
  expect(executeWorkflow).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(onClose).toHaveBeenCalledTimes(1);
});
it("keeps submission failures visible after unrelated terminal exit notifications", async () => {
  vi.mocked(executeWorkflow).mockRejectedValueOnce(new Error("PTY write failed"));
  const onClose = vi.fn();
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose })));
  await click("Run workflow");
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("PTY write failed");
  expect(button("Run workflow").disabled).toBe(false);
  await act(async () => setActiveTerminalExit(17));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("PTY write failed");
  expect(onClose).not.toHaveBeenCalled();
  expect(executeWorkflow).toHaveBeenCalledTimes(1);
});
it("blocks missing or invalid runtime inputs and submits the current expanded command", async () => {
  const workflow: Workflow = { id: "count", name: "Count", steps: ["printf {{count}}"], inputs: [{ name: "count", label: "Count", type: "number", required: true }] };
  await act(async () => root.render(createElement(WorkflowRunner, { workflow, onClose: vi.fn() })));
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("required");
  await fillInput("NaN");
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("finite number");
  await click("Run workflow");
  expect(executeWorkflow).not.toHaveBeenCalled();
  await fillInput("2");
  expect(button("Run workflow").disabled).toBe(false);
  expect(container.querySelector("details pre")?.textContent).toBe(compileWorkflow(workflow, { count: "2" }).command);
  await fillInput("3");
  const command = compileWorkflow(workflow, { count: "3" }).command;
  expect(container.querySelector("details pre")?.textContent).toBe(command);
  await click("Run workflow");
  expect(executeWorkflow).toHaveBeenCalledExactlyOnceWith(workflow, { count: "3" }, fixture.target, command);
});
it("keeps secret reveal separate from authorization to run", async () => {
  const workflow: Workflow = { id: "secret", name: "Secret", steps: ["printf {{token}}"], inputs: [{ name: "token", label: "Token", type: "secret", required: true }] };
  await act(async () => root.render(createElement(WorkflowRunner, { workflow, onClose: vi.fn() })));
  await fillInput("runtime-token", "password");
  const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
  expect(checkboxes).toHaveLength(1);
  expect(checkboxes[0].closest("label")?.textContent).toContain("Reveal secrets in preview");
  expect(checkboxes[0].checked).toBe(false);
  expect(checkboxes[0].closest("details")).toBeNull();
  const warning = [...container.querySelectorAll("p")].find((paragraph) => paragraph.textContent?.includes("shell history"));
  expect(warning).toBeDefined();
  expect(warning!.closest("details")).toBeNull();
  expect(container.querySelector("details pre")).toBeNull();
  expect(container.querySelector(".wf-run-steps")?.textContent).toContain("[hidden secret]");
  expect(container.textContent).not.toContain("runtime-token");
  expect(button("Run workflow").disabled).toBe(false);
  await click("Run workflow");
  expect(executeWorkflow).toHaveBeenCalledExactlyOnceWith(workflow, { token: "runtime-token" }, fixture.target, compileWorkflow(workflow, { token: "runtime-token" }).command);
});
it("reveals and masks both compact command rows and the exact command without running", async () => {
  const workflow: Workflow = { id: "secret", name: "Secret", steps: ["printf {{token}}"], inputs: [{ name: "token", label: "Token", type: "secret", required: true }] };
  await act(async () => root.render(createElement(WorkflowRunner, { workflow, onClose: vi.fn() })));
  await fillInput("runtime-token", "password");
  const reveal = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => reveal.click());
  expect(container.querySelector(".wf-run-steps")?.textContent).toContain("runtime-token");
  expect(container.querySelector("details pre")?.textContent).toBe(compileWorkflow(workflow, { token: "runtime-token" }).command);
  expect(container.querySelector("details")?.open).toBe(false);
  await act(async () => reveal.click());
  expect(container.querySelector(".wf-run-steps")?.textContent).toContain("[hidden secret]");
  expect(container.querySelector("details pre")).toBeNull();
  expect(container.textContent).not.toContain("runtime-token");
  expect(button("Run workflow").disabled).toBe(false);
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it.each(["directory", "terminal", "connection"])("requires explicit Refresh target after the %s changes", async (change) => {
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  const oldTarget = fixture.target!;
  const captures = vi.mocked(captureWorkflowTarget).mock.calls.length;
  fixture.target = {
    leafId: change === "terminal" ? 2 : oldTarget.leafId,
    scope: { ...oldTarget.scope, cwd: change === "directory" ? "/other" : oldTarget.scope.cwd, scopeToken: change === "connection" ? "reconnected:7" : oldTarget.scope.scopeToken },
  };
  await act(async () => setActiveTerminalCwd("/state-change"));
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("changed");
  expect(container.textContent).toContain("/project");
  expect(captureWorkflowTarget).toHaveBeenCalledTimes(captures);
  await click("Run workflow");
  expect(executeWorkflow).not.toHaveBeenCalled();
  await click("Refresh target");
  expect(button("Run workflow").disabled).toBe(false);
  expect(executeWorkflow).not.toHaveBeenCalled();
  await click("Run workflow");
  expect(executeWorkflow).toHaveBeenCalledExactlyOnceWith(fixture.saved[0], {}, fixture.target, compileWorkflow(fixture.saved[0], {}).command);
});
it("updates prompt readiness after command activity without refreshing the captured target", async () => {
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  fixture.promptError = "A command is still running.";
  await act(async () => setCurrentCommand("sleep 10"));
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("still running");
  fixture.promptError = null;
  await act(async () => clearCurrentCommand());
  expect(button("Run workflow").disabled).toBe(false);
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it("detects prompt draft changes even when the terminal emits no state notification", async () => {
  vi.useFakeTimers();
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  fixture.promptError = "The shell prompt already contains a draft.";
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("draft");
  fixture.promptError = null;
  await act(async () => { await vi.advanceTimersByTimeAsync(500); });
  expect(button("Run workflow").disabled).toBe(false);
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it("requires a verified target before running", async () => {
  fixture.target = null;
  await act(async () => root.render(createElement(WorkflowRunner, { workflow: fixture.saved[0], onClose: vi.fn() })));
  expect(button("Run workflow").disabled).toBe(true);
  expect(container.textContent).toContain("No verified terminal");
  await click("Run workflow");
  expect(executeWorkflow).not.toHaveBeenCalled();
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
