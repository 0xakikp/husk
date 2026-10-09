// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("./store", () => ({ useWorkflows: () => [{ id: "wf_1", name: "Check", steps: ["git status"] }], loadWorkflows: () => [{ id: "wf_1", name: "Check", steps: ["git status"] }], saveWorkflows: vi.fn(), newWorkflowId: () => "new", getWorkflowLoadError: () => null }));
vi.mock("./draftStore", () => ({ useWorkflowDraft: () => null, clearWorkflowDraft: vi.fn(), stageWorkflowDraft: vi.fn(), workflowDraftFromSuggestion: vi.fn() }));
vi.mock("./runRequest", () => ({ useWorkflowRunRequest: () => null, clearWorkflowRunRequest: vi.fn() }));
vi.mock("./suggestions", () => ({ useWorkflowSuggestions: () => [], dismissWorkflowSuggestionFingerprint: vi.fn() }));
vi.mock("../workspace/store", () => ({ useWorkspaceRoot: () => "/project" }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: false }) }));
vi.mock("../ai/assist", () => ({ refineWorkflowDraft: vi.fn() }));
vi.mock("./execution", () => ({ captureWorkflowTarget: vi.fn(() => null), workflowTargetError: vi.fn(() => "No verified terminal"), executeWorkflow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("../fs", () => ({ writeFile: vi.fn(), readFileScoped: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { RunbooksDialog } from "./RunbooksDialog";
import { saveWorkflows } from "./store";
import { captureWorkflowTarget, executeWorkflow, workflowTargetError } from "./execution";
import { compileWorkflow } from "./params";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile, readFileScoped } from "../fs";
import { addLinkedScript, getWorkflowLibrary, WORKFLOW_LIBRARY_STORAGE_KEY } from "./library";
import { beginWorkflowRun, clearWorkflowRunStatuses, getWorkflowRunStatus } from "./runStatus";
import { publishTerminalCommandRun } from "../ai/terminalContext";
import { getWorkflowEditorSession, discardWorkflowEditor, collapseWorkflowEditor, resumeWorkflowEditor, addWorkflowCapture } from "./editorSession";
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.removeItem(WORKFLOW_LIBRARY_STORAGE_KEY);
  window.dispatchEvent(new StorageEvent("storage", { key: WORKFLOW_LIBRARY_STORAGE_KEY }));
  clearWorkflowRunStatuses();
  const session = getWorkflowEditorSession(); if (session) discardWorkflowEditor(session.key);
  vi.mocked(captureWorkflowTarget).mockReturnValue(null);
  vi.mocked(workflowTargetError).mockReturnValue("No verified terminal");
  vi.mocked(executeWorkflow).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearWorkflowRunStatuses(); const session = getWorkflowEditorSession(); if (session) discardWorkflowEditor(session.key); vi.unstubAllGlobals(); });
async function render(active = true) { await act(async () => { root.render(createElement(RunbooksDialog, { inline: true, active })); await vi.dynamicImportSettled(); }); }
it("edits inside the existing workflow rail instead of adding a workspace column", async () => {
  await render(); expect(saveWorkflows).not.toHaveBeenCalled();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Edit Check"]')!.click(); await vi.dynamicImportSettled(); });
  expect(document.querySelector(".workflow-dialog")).toBeNull();
  expect(getWorkflowEditorSession()?.workflow).toEqual({ id: "wf_1", name: "Check", steps: ["git status"] });
  expect(container.querySelector(".workflow-sidebar-editor")).not.toBeNull();
  expect(container.querySelector('[aria-label="Review & run Check"]')).toBeNull();
  expect(container.querySelector('[aria-label="Workflow name"]')).not.toBeNull();
  expect(document.querySelector(".workflow-dock")).toBeNull();
  expect(container.querySelector("[inert]")).toBeNull();
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it("returns to the list on collapse and restores the draft in that same rail", async () => {
  await render();
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="Edit Check"]')!.click(); await vi.dynamicImportSettled(); });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Collapse workflow editor"]')!.click());
  expect(container.querySelector(".workflow-sidebar-editor")).toBeNull(); expect(container.textContent).toContain("Resume draft");
  await act(async () => { resumeWorkflowEditor(); await vi.dynamicImportSettled(); });
  expect(container.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')?.value).toBe("Check");
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("keeps the current draft when starting another workflow is cancelled", async () => {
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Edit Check"]')!.click());
  const original = getWorkflowEditorSession(); vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
  await act(async () => collapseWorkflowEditor(original!.key));
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="New workflow"]')!.click());
  expect(getWorkflowEditorSession()?.key).toBe(original!.key); expect(getWorkflowEditorSession()?.workflow).toEqual(original!.workflow); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("does not leave a run review floating over another sidebar view", async () => {
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Check"]')!.click());
  expect(document.querySelector(".workflow-dialog")).not.toBeNull();
  await render(false); expect(document.querySelector(".workflow-dialog")).toBeNull();
  await render(true); expect(document.querySelector(".workflow-dialog")).not.toBeNull();
  expect(executeWorkflow).not.toHaveBeenCalled();
});
it("shows an explicitly captured draft rather than stacking it with an older run review", async () => {
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Check"]')!.click());
  await act(async () => { addWorkflowCapture("pwd", "ai-code", "new", null); await vi.dynamicImportSettled(); });
  expect(document.querySelector(".workflow-dialog")).toBeNull();
  expect(container.querySelector<HTMLTextAreaElement>('[aria-label="Step 1 command"]')?.value).toBe("pwd");
  await act(async () => collapseWorkflowEditor(getWorkflowEditorSession()!.key));
  expect(document.querySelector(".workflow-dialog")).toBeNull();
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("opens a preview with one explicit Run workflow action without executing parameterless workflows", async () => {
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Check"]')!.click());
  const dialog = document.querySelector(".workflow-dialog")!;
  expect(dialog.classList.contains("workflow-run-dialog")).toBe(true);
  expect(dialog.textContent).toContain("Run workflow");
  expect(dialog.textContent).toContain("git status");
  expect(dialog.querySelector('input[type="checkbox"]')).toBeNull();
  expect(dialog.querySelector('details')?.open).toBe(false);
  expect(dialog.querySelector('details summary')?.textContent).toBe("Execution details");
  expect(dialog.querySelector('ol.wf-run-steps > li.wf-run-step pre')?.textContent).toBe("git status");
  const body = dialog.querySelector(".workflow-dialog-body")!;
  const footer = dialog.querySelector(".workflow-dialog-footer")!;
  expect(footer).not.toBeNull();
  expect(body.contains(footer)).toBe(false);
  expect(footer.parentElement).toBe(dialog);
  const runButtons = [...dialog.querySelectorAll("button")].filter((button) => button.textContent === "Run workflow");
  expect(runButtons).toHaveLength(1);
  expect(footer.contains(runButtons[0])).toBe(true);
  expect(runButtons[0].disabled).toBe(true);
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled();
});
it("closes the run preview after the explicit action submits to a verified target", async () => {
  const target = { leafId: 1, scope: { ptyId: 7, cwd: "/project", isRemote: false, host: null, scopeToken: "session:7" } };
  vi.mocked(captureWorkflowTarget).mockReturnValue(target);
  vi.mocked(workflowTargetError).mockReturnValue(null);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Check"]')!.click());
  expect(executeWorkflow).not.toHaveBeenCalled();
  const run = [...document.querySelectorAll<HTMLButtonElement>(".workflow-dialog button")].find((button) => button.textContent === "Run workflow")!;
  expect(run.disabled).toBe(false);
  await act(async () => run.click());
  const workflow = { id: "wf_1", name: "Check", steps: ["git status"] };
  expect(executeWorkflow).toHaveBeenCalledExactlyOnceWith(workflow, {}, target, compileWorkflow(workflow, {}).command);
  expect(document.querySelector(".workflow-dialog")).toBeNull();
  expect(container.querySelector('[aria-label="Review & run Check"]')).not.toBeNull();
  expect(saveWorkflows).not.toHaveBeenCalled();
});
it("exports versioned JSON to a user-chosen file and does nothing on cancellation", async () => {
  vi.mocked(save).mockResolvedValueOnce(null).mockResolvedValueOnce("/exports/backup.json");
  await render();
  for (let i = 0; i < 2; i++) {
    const menu = container.querySelector<HTMLButtonElement>('[aria-label="Workflow options"]')!;
    await act(async () => menu.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "Export all workflows…")!;
    await act(async () => item.click());
    if (i === 0) expect(writeFile).not.toHaveBeenCalled();
  }
  expect(writeFile).toHaveBeenCalledWith("/exports/backup.json", expect.stringContaining('"version": 1'));
  expect(executeWorkflow).not.toHaveBeenCalled();
});

it("filters workflows and scripts locally and restores the list with Escape", async () => {
  addLinkedScript({ name: "Environment", path: "/project/scripts/check-env.sh" });
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Search workflows and scripts"]')!.click());
  const input = container.querySelector<HTMLInputElement>('[aria-label="Filter workflows and scripts"]')!;
  const query = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await query("git status");
  expect(container.querySelector('[aria-label="Review & run Check"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="Review & run Environment"]')).toBeNull();
  await query("scripts/check-env");
  expect(container.querySelector('[aria-label="Review & run Check"]')).toBeNull();
  expect(container.querySelector('[aria-label="Review & run Environment"]')).not.toBeNull();
  await query("not found");
  expect(container.textContent).toContain("No matching workflows or scripts.");
  await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector('[aria-label="Filter workflows and scripts"]')).toBeNull();
  expect(container.querySelectorAll(".wf-library-item")).toHaveLength(2);
  expect(document.activeElement?.getAttribute("aria-label")).toBe("Search workflows and scripts");
  expect(executeWorkflow).not.toHaveBeenCalled();
});

it("pins workflows and scripts without executing or rewriting definitions", async () => {
  const script = addLinkedScript({ name: "Environment", path: "/project/check.sh" });
  await render();
  for (const name of ["Check", "Environment"]) {
    await act(async () => container.querySelector<HTMLButtonElement>(`[aria-label="Pin ${name}"]`)!.click());
  }
  expect(container.querySelectorAll('section[aria-label="Pinned"] .wf-library-item')).toHaveLength(2);
  expect(JSON.parse(localStorage.getItem(WORKFLOW_LIBRARY_STORAGE_KEY)!)).toMatchObject({ pinnedWorkflowIds: ["wf_1"], pinnedScriptIds: [script.id] });
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Unpin Check"]')!.click());
  expect(container.querySelectorAll('section[aria-label="Pinned"] .wf-library-item')).toHaveLength(1);
  expect(getWorkflowLibrary().scripts).toHaveLength(1);
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled();
});

it("links and opens only the original file without reading or executing on discovery", async () => {
  const onOpenScript = vi.fn();
  vi.mocked(open).mockResolvedValueOnce(null).mockResolvedValueOnce("/project/scripts/check.sh");
  await act(async () => root.render(createElement(RunbooksDialog, { inline: true, onOpenScript })));
  const link = () => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Link script…")!;
  await act(async () => link().click());
  expect(getWorkflowLibrary().scripts).toHaveLength(0);
  await act(async () => link().click());
  expect(getWorkflowLibrary().scripts).toHaveLength(1);
  expect(getWorkflowLibrary().scripts[0].path).toBe("/project/scripts/check.sh");
  expect(readFileScoped).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Open check.sh"]')!.click());
  expect(onOpenScript).toHaveBeenCalledExactlyOnceWith("/project/scripts/check.sh", "check.sh");
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled(); expect(writeFile).not.toHaveBeenCalled();
});

it("requires a local target and an explicit run for a linked script", async () => {
  const script = addLinkedScript({ name: "Environment", path: "/project/check.sh" });
  const scope = { ptyId: 7, cwd: "/project", isRemote: true, host: "prod", scopeToken: "session:7" };
  vi.mocked(captureWorkflowTarget).mockReturnValue({ leafId: 1, scope });
  vi.mocked(workflowTargetError).mockReturnValue(null);
  await render();
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Environment"]')!.click());
  const button = (name: string) => [...document.querySelectorAll<HTMLButtonElement>(".workflow-dialog button")].find(button => button.textContent === name)!;
  expect(button("Run script").disabled).toBe(true);
  expect(document.querySelector(".workflow-dialog")?.textContent).toContain("cannot run on an SSH host");
  const local = { leafId: 1, scope: { ...scope, isRemote: false, host: null } };
  vi.mocked(captureWorkflowTarget).mockReturnValue(local);
  await act(async () => button("Refresh target").click());
  expect(button("Run script").disabled).toBe(false);
  expect(executeWorkflow).not.toHaveBeenCalled();
  await act(async () => button("Run script").click());
  expect(executeWorkflow).toHaveBeenCalledWith(expect.objectContaining({ id: script.id, steps: ["'/project/check.sh'"] }), {}, local, expect.any(String), { localOnly: true });
  expect(document.querySelector(".workflow-dialog")).toBeNull();
});

it("shows observed failure output without rerunning and stays closable if the result is cleared", async () => {
  beginWorkflowRun({ id: "wf_1", name: "Check", steps: ["git status"] }, {},
    { leafId: 1, scope: { ptyId: 7, cwd: "/project", isRemote: false, host: null, scopeToken: "session:7" } }, "git status", "ui:1");
  const submitted = getWorkflowRunStatus("wf_1")!.submittedAt;
  publishTerminalCommandRun({ runId: "ui:1", terminalPtyId: 7, cwd: "/project", command: "git status", output: "not a git repository", exitCode: 128, startedAt: submitted + 1, at: submitted + 2 });
  await render();
  expect(container.textContent).toContain("Last run failed");
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="View output for Check"]')!.click());
  expect(document.querySelector('.workflow-dialog pre')?.textContent).toBe("not a git repository");
  expect(document.querySelector('.workflow-dialog')?.textContent).toContain("exit 128");
  expect(document.querySelector('.workflow-dialog')?.textContent).toContain("Bounded terminal capture");
  await act(async () => clearWorkflowRunStatuses());
  expect(document.querySelector('.workflow-dialog')?.textContent).toContain("Result unavailable");
  const close = [...document.querySelectorAll<HTMLButtonElement>('.workflow-dialog button')].find(button => button.textContent === "Close")!;
  await act(async () => close.click());
  expect(document.querySelector('.workflow-dialog')).toBeNull();
  expect(container.querySelector('[inert]')).toBeNull();
  expect(executeWorkflow).not.toHaveBeenCalled();
});
