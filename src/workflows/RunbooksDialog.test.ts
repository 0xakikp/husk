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
vi.mock("./execution", () => ({ captureWorkflowTarget: () => null, workflowTargetError: () => "No verified terminal", executeWorkflow: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn(), open: vi.fn() }));
vi.mock("../fs", () => ({ writeFile: vi.fn(), readFileScoped: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { RunbooksDialog } from "./RunbooksDialog";
import { saveWorkflows } from "./store";
import { executeWorkflow } from "./execution";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "../fs";
import { getWorkflowEditorSession, discardWorkflowEditor, collapseWorkflowEditor, resumeWorkflowEditor, addWorkflowCapture } from "./editorSession";
let container: HTMLDivElement; let root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); const session = getWorkflowEditorSession(); if (session) discardWorkflowEditor(session.key); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); const session = getWorkflowEditorSession(); if (session) discardWorkflowEditor(session.key); vi.unstubAllGlobals(); });
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
it("opens review rather than executing parameterless workflows", async () => {
  await render(); await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Review & run Check"]')!.click());
  expect(document.querySelector(".workflow-dialog")?.textContent).toContain("Run reviewed workflow");
  expect(executeWorkflow).not.toHaveBeenCalled(); expect(saveWorkflows).not.toHaveBeenCalled();
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
