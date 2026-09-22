// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkflowWorkspace } from "./WorkflowWorkspace";
import { addWorkflowCapture, collapseWorkflowEditor, discardWorkflowEditor, getWorkflowEditorSession, resumeWorkflowEditor, setWorkflowEditorBusy, startWorkflowEditor, updateWorkflowEditor } from "./editorSession";

let root: Root; let container: HTMLDivElement;
const reveal = vi.fn();
const workflow = { id: "wf_original", name: "Check", steps: ["git status"] };
function clearSession() {
  const session = getWorkflowEditorSession();
  if (session) { setWorkflowEditorBusy(session.key, false); discardWorkflowEditor(session.key); }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); clearSession(); reveal.mockClear();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearSession(); });
async function render(editorVisible = false, onRevealEditor = reveal) {
  await act(async () => root.render(createElement(WorkflowWorkspace, { editorVisible, onRevealEditor,
    children: [
      createElement("textarea", { key: "terminal", "aria-label": "Terminal stand-in", defaultValue: "terminal input", style: { flex: 1, minWidth: 0 } }),
      createElement("div", { key: "ai", "aria-label": "AI stand-in", style: { width: 420, padding: 16, fontSize: 13, lineHeight: 1.7 } },
        createElement("textarea", { "aria-label": "AI input", defaultValue: "AI draft", style: { height: 80, padding: 12 } })),
    ],
  })));
}
async function resume() {
  const button = container.querySelector<HTMLButtonElement>('[aria-label="Resume workflow draft"]')!;
  expect(button).not.toBeNull(); await act(async () => button.click());
}

it("never adds an editor column or changes the terminal and AI DOM, size, or spacing props", async () => {
  await render();
  const terminal = container.querySelector<HTMLTextAreaElement>('[aria-label="Terminal stand-in"]')!;
  const ai = container.querySelector<HTMLElement>('[aria-label="AI stand-in"]')!;
  const aiInput = container.querySelector<HTMLTextAreaElement>('[aria-label="AI input"]')!;
  const styles = [terminal, ai, aiInput].map((element) => element.getAttribute("style"));
  await act(async () => startWorkflowEditor(workflow)); await render(true);
  await act(async () => collapseWorkflowEditor(getWorkflowEditorSession()!.key));
  await resume(); await render(true);
  expect(container.querySelector('[aria-label="Terminal stand-in"]')).toBe(terminal);
  expect(container.querySelector('[aria-label="AI stand-in"]')).toBe(ai);
  expect(container.querySelector('[aria-label="AI input"]')).toBe(aiInput);
  expect([terminal, ai, aiInput].map((element) => element.getAttribute("style"))).toEqual(styles);
  expect(terminal.value).toBe("terminal input"); expect(aiInput.value).toBe("AI draft");
  expect(container.querySelector(".workflow-workspace")?.children).toHaveLength(1);
  expect(container.querySelector(".workflow-workspace-content")?.children).toHaveLength(2);
  expect(container.querySelector(".workflow-sidebar-editor, .workflow-dock, [role=separator], [role=dialog]")).toBeNull();
});

it("reveals the existing rail only for explicit start, resume, and successful capture requests", async () => {
  await render(); expect(reveal).not.toHaveBeenCalled();
  await act(async () => startWorkflowEditor(workflow)); expect(reveal).toHaveBeenCalledTimes(1);
  await render(true);
  await act(async () => resumeWorkflowEditor()); expect(reveal).toHaveBeenCalledTimes(2);
  await act(async () => addWorkflowCapture("pwd", "ai-code", "current", getWorkflowEditorSession()!.key));
  expect(reveal).toHaveBeenCalledTimes(3);
  await act(async () => addWorkflowCapture("whoami", "terminal-selection", "new", getWorkflowEditorSession()!.key, true));
  expect(reveal).toHaveBeenCalledTimes(4);
  expect(getWorkflowEditorSession()?.workflow.steps).toEqual(["whoami"]);
});

it("does not reopen the sidebar after typing, save notifications, manual navigation, or callback identity changes", async () => {
  startWorkflowEditor(workflow); await render(true); expect(reveal).toHaveBeenCalledTimes(1); reveal.mockClear();
  const session = getWorkflowEditorSession()!;
  await act(async () => updateWorkflowEditor(session.key, { ...session.workflow, name: "Unsaved name" }));
  await act(async () => setWorkflowEditorBusy(session.key, true));
  await act(async () => setWorkflowEditorBusy(session.key, false));
  const latestReveal = vi.fn();
  await render(false, latestReveal);
  expect(reveal).not.toHaveBeenCalled(); expect(latestReveal).not.toHaveBeenCalled();
  expect(getWorkflowEditorSession()?.collapsed).toBe(false);
  expect(container.querySelector('[aria-label="Unsaved workflow draft"]')?.textContent).toContain("Unsaved name");
  await resume();
  expect(latestReveal).toHaveBeenCalledOnce(); expect(reveal).not.toHaveBeenCalled();
  await render(true, latestReveal);
  expect(container.querySelector('[aria-label="Unsaved workflow draft"]')).toBeNull();
});

it("shows a reminder for a hidden uncollapsed editor without obscuring its source", async () => {
  startWorkflowEditor(workflow); await render(true);
  expect(container.querySelector(".workflow-draft-bar")).toBeNull();
  await render(false);
  const source = container.querySelector(".workflow-workspace-source")!;
  const reminder = container.querySelector(".workflow-draft-bar")!;
  expect(source.firstElementChild).toBe(reminder);
  expect(source.lastElementChild?.classList.contains("workflow-workspace-content")).toBe(true);
  expect(reminder.querySelector('[aria-label="Terminal stand-in"], [aria-label="AI stand-in"]')).toBeNull();
  expect(getWorkflowEditorSession()?.collapsed).toBe(false);
  expect(reveal).toHaveBeenCalledOnce();
});

it("does not reveal a previously collapsed draft until Resume is chosen", async () => {
  startWorkflowEditor(workflow); collapseWorkflowEditor(getWorkflowEditorSession()!.key);
  await render(); expect(reveal).not.toHaveBeenCalled();
  expect(container.querySelector(".workflow-draft-bar")).not.toBeNull();
  await resume(); expect(reveal).toHaveBeenCalledOnce();
});
