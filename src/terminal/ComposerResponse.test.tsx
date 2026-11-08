// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../workflows/savedCommandCapture", () => ({ captureSavedCommand: vi.fn() }));
vi.mock("../workflows/AiWorkflowProposalCard", () => ({ AiWorkflowProposalCard: ({ proposal, disabled }: { proposal: { name: string }; disabled?: boolean }) => <button disabled={disabled} data-workflow>{proposal.name}</button> }));
import { ComposerResponse } from "./ComposerResponse";
import { clearWorkflowCaptureRequest, getWorkflowCaptureRequest } from "../workflows/captureRequest";

let root: Root; let container: HTMLDivElement;
const copy = vi.fn(); const run = vi.fn();
const block = (code: string, lang = "sh") => `\`\`\`${lang}\n${code}\n\`\`\``;
const props = (text: string, patch: Partial<ComponentProps<typeof ComposerResponse>> = {}): ComponentProps<typeof ComposerResponse> => ({
  text, messageKey: "reply-1", copiedKey: null, onCopy: copy, onRun: run, renderText: (value) => <p>{value}</p>, ...patch,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  clearWorkflowCaptureRequest(); vi.clearAllMocks(); document.getSelection()?.removeAllRanges();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearWorkflowCaptureRequest(); document.getSelection()?.removeAllRanges(); });
const render = async (value: ComponentProps<typeof ComposerResponse>) => { await act(async () => root.render(<ComposerResponse {...value} />)); };
const buttons = (text: string) => [...container.querySelectorAll("button")].filter((button) => button.textContent === text);
async function click(label: string, index = 0) { const button = buttons(label)[index]; expect(button).toBeDefined(); await act(async () => button.click()); }

it("keeps explanations next to their matching code and renders no language tabs", async () => {
  await render(props(`Download only:\n${block("apt download foo")}\nInstall instead:\n${block("sudo apt install foo")}`));
  expect([...container.querySelectorAll("p, pre")].map((node) => node.textContent?.trim())).toEqual(["Download only:", "apt download foo", "Install instead:", "sudo apt install foo"]);
  expect(container.querySelector(".composer-code-tabs")).toBeNull();
});
it("scopes copy feedback to one block in one response", async () => {
  const text = block("pwd");
  await act(async () => root.render(<><ComposerResponse {...props(text, { copiedKey: "reply-1:0" })} /><ComposerResponse {...props(text, { messageKey: "reply-2", copiedKey: "reply-1:0" })} /></>));
  expect(buttons("Copied")).toHaveLength(1); expect(buttons("Copy")).toHaveLength(1);
  await click("Copy"); expect(copy).toHaveBeenCalledWith("pwd", "reply-2:0");
});
it("offers only safe complete blocks as workflow candidates, with the correct active index", async () => {
  const contaminated = block("printf ignored\n~~~husk-action\n{}\n~~~");
  await render(props(`${block("pwd")}\nDocumentation:\n${contaminated}\nNext:\n${block("git status")}`));
  expect(buttons("Save…")).toHaveLength(2);
  await click("Save…", 1); await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ steps: ["pwd", "git status"], selectedIndices: [] });
  expect(run).not.toHaveBeenCalled();
  expect(container.querySelector(".composer-save-options")).toBeNull();
});
it("preserves a code selection through opening Save and capturing it", async () => {
  await render(props(block("pwd\ngit status")));
  const code = container.querySelector("pre code")!;
  const range = document.createRange(); range.setStart(code.firstChild!, 4); range.setEnd(code.firstChild!, 14);
  document.getSelection()!.addRange(range);
  const save = buttons("Save…")[0];
  const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
  await act(async () => { save.dispatchEvent(down); save.click(); });
  expect(down.defaultPrevented).toBe(true);
  await click("Choose commands…");
  expect(getWorkflowCaptureRequest()).toMatchObject({ text: "git status", source: "ai-code" });
});
it.each([{ streaming: true }, { incomplete: true }])("never runs or captures commands from an unfinished response %j", async (patch) => {
  await render(props(block("pwd"), patch));
  expect(buttons("Run command")).toHaveLength(0); expect(buttons("Save…")).toHaveLength(0); expect(buttons("Copy")).toHaveLength(1);
});
it("renders a diff once and does not label non-shell code as needing terminal review", async () => {
  await render(props(block("-before\n+after", "diff") + "\n" + block("{}", "json")));
  expect(container.querySelectorAll("pre")).toHaveLength(2);
  expect(container.textContent).not.toContain("review before running");
  expect(buttons("Run command")).toHaveLength(0);
});
it("retains the three-workflow limit across separate ordered blocks", async () => {
  const text = Array.from({ length: 4 }, (_, index) => block(JSON.stringify({ version: 1, name: `Plan ${index}`, steps: ["pwd"] }), "husk-workflow")).join("\nExplanation\n");
  await render(props(text));
  expect(container.querySelectorAll("[data-workflow]")).toHaveLength(3);
  expect(container.textContent).toContain("limits were unsupported");
});
it("dismisses Save with Escape without running anything", async () => {
  await render(props(block("pwd"))); await click("Save…");
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(container.querySelector(".composer-save-options")).toBeNull(); expect(run).not.toHaveBeenCalled();
});
