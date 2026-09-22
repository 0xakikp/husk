// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ aiEnabled: false, selected: "", activePtyId: 420, handles: new Map<number, Record<string, ReturnType<typeof vi.fn>>>() }));
vi.mock("./settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: state.aiEnabled }) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ readText: vi.fn(async () => ""), writeText: vi.fn(async () => {}) }));
vi.mock("./ai/terminalContext", () => ({ getPromptPosition: () => null, isCommandRunning: () => false, getActiveTerminalDraft: () => "" }));
vi.mock("./ai/terminalTarget", () => ({ captureTerminalTarget: vi.fn(() => ({ ptyId: state.activePtyId, isRemote: false, host: null, cwd: "/workspace" })) }));
vi.mock("./terminal/stageScreenCommand", () => ({ captureScreenCommandTarget: vi.fn(() => null), stageScreenCommand: vi.fn() }));
vi.mock("./shellHistory", () => ({ getShellHistory: vi.fn(async () => []) }));
vi.mock("./terminal/savedFixesView", () => ({ openSavedFixes: vi.fn() }));
vi.mock("./terminal/TerminalSelectionActions", () => ({ TerminalSelectionActions: () => null }));
vi.mock("./TerminalHistory", () => ({ TerminalHistoryPanel: () => createElement("div", { "data-testid": "history-panel" }, "History picker") }));
vi.mock("./terminal/AutocompleteBar", () => ({ AutocompleteBar: () => null }));
vi.mock("./terminal/useAutocomplete", () => ({ useAutocomplete: () => ({ state: { visible: false }, stateRef: { current: { visible: false } }, scheduleCheck: vi.fn(), accept: vi.fn(), navigate: vi.fn(), dismiss: vi.fn() }) }));
vi.mock("./notes/AiNoteCaptureMenu", () => ({ AiNoteCaptureMenu: () => null }));
vi.mock("./notes/aiCapture", () => ({ createAiNote: vi.fn() }));
vi.mock("./notes/captureToast", () => ({ showVaultCaptureToast: vi.fn() }));
vi.mock("./toast", () => ({ toast: vi.fn() }));
vi.mock("./terminal/registry", () => ({
  createSession: vi.fn(async () => {}), attachSession: vi.fn(), detachSession: vi.fn(),
  setSessionVisible: vi.fn(), setSessionFocused: vi.fn(), setSessionActive: vi.fn(), setSessionCallbacks: vi.fn(),
  registerTerminalLogsOpener: vi.fn(() => () => {}), getSessionHandle: vi.fn((leafId: number) => state.handles.get(leafId)),
}));

import { TerminalView } from "./Terminal";
import { openSavedFixes } from "./terminal/savedFixesView";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getShellHistory } from "./shellHistory";
import { stageScreenCommand } from "./terminal/stageScreenCommand";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest } from "./workflows/captureRequest";

let root: Root;
let container: HTMLDivElement;
function handle(leafId: number) {
  const value = {
    getTerm: vi.fn(() => null), getSelection: vi.fn(() => state.selected), hasSelection: vi.fn(() => Boolean(state.selected)),
    getLastCommandRun: vi.fn(() => null), getPtyId: vi.fn(() => leafId * 10), focus: vi.fn(),
    write: vi.fn(), typeText: vi.fn(), clear: vi.fn(), clearSelection: vi.fn(), selectAll: vi.fn(),
  };
  state.handles.set(leafId, value); return value;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  state.aiEnabled = false; state.selected = ""; state.activePtyId = 420; state.handles.clear();
  clearWorkflowCaptureRequest();
  vi.spyOn(console, "log").mockImplementation(() => {});
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

async function render(leafIds = [73]) {
  leafIds.forEach(handle);
  await act(async () => root.render(createElement("div", {}, ...leafIds.map((leafId, index) => createElement(TerminalView, {
    key: leafId, leafId, active: index === leafIds.length - 1, canClose: true, onClose: vi.fn(), onSplit: vi.fn(),
  })))));
}
async function openMenu(index = 0) {
  const terminal = container.querySelectorAll(".terminal-host")[index]; expect(terminal).toBeDefined();
  await act(async () => terminal.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 100, clientY: 100 })));
}
function menuButton(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>('[role="menu"] button')].find((item) => item.textContent?.trim() === label);
  expect(button, `Expected context-menu action: ${label}`).toBeDefined(); return button!;
}
function expectNoShellMutation() {
  expect(invoke).not.toHaveBeenCalled(); expect(stageScreenCommand).not.toHaveBeenCalled();
  for (const terminal of state.handles.values()) {
    expect(terminal.write).not.toHaveBeenCalled(); expect(terminal.typeText).not.toHaveBeenCalled(); expect(terminal.clear).not.toHaveBeenCalled();
  }
}

it("opens Saved fixes without terminal selection or AI permission, and closes the context menu", async () => {
  await render(); await openMenu();
  const saved = menuButton("Saved fixes…"); expect(saved.disabled).toBe(false);
  expect(container.textContent).not.toContain("Explain here"); expect(container.textContent).not.toContain("Save selection to Vault");
  await act(async () => saved.click());
  expect(openSavedFixes).toHaveBeenCalledExactlyOnceWith(73); expect(container.querySelector('[role="menu"]')).toBeNull();
  expectNoShellMutation();
});

it("targets the clicked leaf, not a different active terminal or global PTY", async () => {
  await render([91, 42]); await openMenu(0);
  await act(async () => menuButton("Saved fixes…").click());
  expect(openSavedFixes).toHaveBeenCalledExactlyOnceWith(91); expectNoShellMutation();
});

it("keeps standard context actions available with AI disabled", async () => {
  await render(); await openMenu();
  for (const label of ["Copy", "Paste", "Select all", "Clear", "Find…", "History…", "Split right", "Split down", "Close pane", "Saved fixes…"]) expect(menuButton(label).disabled).toBe(false);
  await act(async () => menuButton("History…").click());
  expect(getShellHistory).toHaveBeenCalledOnce(); expect(container.querySelector('[data-testid="history-panel"]')).not.toBeNull();
  expect(openSavedFixes).not.toHaveBeenCalled(); expectNoShellMutation();
});

it("preserves selected-text AI/Vault actions and ordinary Copy behavior", async () => {
  state.aiEnabled = true; state.selected = "npm test";
  await render(); await openMenu();
  for (const label of ["Explain here", "Review before running…", "Modify command with AI…", "Save selection to Vault", "Append selection to existing note…", "Saved fixes…"]) expect(menuButton(label).disabled).toBe(false);
  await act(async () => menuButton("Copy").click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith("npm test"); expect(openSavedFixes).not.toHaveBeenCalled();
  expect(container.querySelector('[role="menu"]')).toBeNull(); expectNoShellMutation();
});

it("captures the right-click selection snapshot for a workflow with AI disabled", async () => {
  state.selected = "$ printf hello\nhello\nprintf again "; await render(); await openMenu();
  const exactText = state.selected; state.selected = "later selection";
  await act(async () => menuButton("Add to workflow…").click());
  expect(getWorkflowCaptureRequest()).toEqual({ id: expect.any(Number), text: exactText, source: "terminal-selection" });
  expect(container.querySelector('[role="menu"]')).toBeNull(); expectNoShellMutation();
});

it("does not offer workflow capture when there is no selected terminal text", async () => {
  await render(); await openMenu();
  expect(container.textContent).not.toContain("Add to workflow…"); expect(getWorkflowCaptureRequest()).toBeNull(); expectNoShellMutation();
});
