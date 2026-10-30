// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./savedCommandCapture", () => ({ captureSavedCommand: vi.fn() }));
import { captureSavedCommand } from "./savedCommandCapture";
import { WorkflowCaptureButton } from "./WorkflowCaptureButton";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest } from "./captureRequest";

let root: Root; let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearWorkflowCaptureRequest(); vi.mocked(captureSavedCommand).mockClear(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearWorkflowCaptureRequest(); });
const render = async (props: ComponentProps<typeof WorkflowCaptureButton>) => { await act(async () => root.render(createElement(WorkflowCaptureButton, props))); };
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}

it("preserves single-block capture and never splits multiline shell text automatically", async () => {
  const code = "  printf first\nprintf second  ";
  await render({ language: "sh", code }); await click("Add to workflow…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ text: code, source: "ai-code" });
  expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
  expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("offers only explicitly shell-labelled candidates in response order and selects the active candidate", async () => {
  const blocks = [{ lang: "python", code: "print('example')" }, { lang: "sh", code: "pnpm lint" }, { lang: "", code: "unknown code" }, { lang: "bash", code: "pnpm test" }, { lang: "json", code: "{}" }, { lang: "zsh", code: "pwd" }];
  await render({ language: "bash", code: "pnpm test", blocks, blockIndex: 3 });
  expect(getWorkflowCaptureRequest()).toBeNull();
  await click("Build workflow…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ source: "ai-code", steps: ["pnpm lint", "pnpm test", "pwd"], selectedIndices: [1] });
  expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("preserves repeated commands as distinct indexed steps and selects only the active duplicate", async () => {
  const blocks = [{ lang: "sh", code: "pwd" }, { lang: "sh", code: "cd src" }, { lang: "sh", code: "pwd" }];
  await render({ language: "sh", code: "pwd", blocks, blockIndex: 2 }); await click("Build workflow…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["pwd", "cd src", "pwd"], selectedIndices: [2] });
});

it("still saves only the active command when other candidate commands are present", async () => {
  const blocks = [{ lang: "sh", code: "pnpm lint" }, { lang: "sh", code: "pnpm test" }];
  await render({ language: "sh", code: "pnpm test", blocks, blockIndex: 1 }); await click("Save command…");
  expect(captureSavedCommand).toHaveBeenCalledExactlyOnceWith("pnpm test", "ai-code");
  expect(getWorkflowCaptureRequest()).toBeNull();
});

it("does not offer workflow or saved-command actions for an active non-shell fence", async () => {
  for (const language of ["", "python", "json", "powershell", "husk-workflow"]) {
    await render({ language, code: "data", blocks: [{ lang: "sh", code: "pwd" }, { lang: "bash", code: "date" }, { lang: language, code: "data" }], blockIndex: 2 });
    expect(container.querySelector("button")).toBeNull();
  }
  expect(getWorkflowCaptureRequest()).toBeNull(); expect(captureSavedCommand).not.toHaveBeenCalled();
});

it("keeps the single-command action when only one explicitly shell-labelled candidate exists", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "json", code: "{}" }, { lang: "sh", code: "pwd" }], blockIndex: 1 });
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
});

it("does not silently select another command if the active index no longer matches", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "sh", code: "pwd" }, { lang: "sh", code: "date" }], blockIndex: 1 });
  await click("Add to workflow…"); expect(getWorkflowCaptureRequest()).toMatchObject({ text: "pwd" });
  expect(getWorkflowCaptureRequest()?.steps).toBeUndefined();
});

it("supports a caller without an explicit index when the active candidate matches", async () => {
  await render({ language: "sh", code: "pwd", blocks: [{ lang: "sh", code: "date" }, { lang: "sh", code: "pwd" }] });
  await click("Build workflow…"); expect(getWorkflowCaptureRequest()?.selectedIndices).toEqual([1]);
});
