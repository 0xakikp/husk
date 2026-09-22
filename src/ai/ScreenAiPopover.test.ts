// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("./screenAssist", () => ({ requestScreenAssist: vi.fn(), parseScreenObject: (value: string) => JSON.parse(value) }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: true }), resolveAiConversationFontSize: () => 13 }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }));
vi.mock("./bubbleStore", () => ({ openComposer: vi.fn() }));
vi.mock("../notes/aiCapture", () => ({ createAiNote: vi.fn(async () => ({})) }));
vi.mock("../notes/captureToast", () => ({ showVaultCaptureToast: vi.fn() }));
import { ScreenAiPopover, type ScreenAiSelection } from "./ScreenAiPopover";
import { requestScreenAssist } from "./screenAssist";
import { openComposer } from "./bubbleStore";
import { createAiNote } from "../notes/aiCapture";

let root: Root;
let container: HTMLDivElement;
const selection: ScreenAiSelection = { id: 1, kind: "peek", text: "Permission denied\nselected detail", source: "Terminal", x: 100, y: 100 };
const close = vi.fn();
const stage = vi.fn(async (_command: string) => {});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });
async function render(value = selection) { await act(async () => { root.render(createElement(ScreenAiPopover, { key: value.id, selection: value, onClose: close, onStage: stage })); }); }
async function click(label: string) {
  const button = [...document.querySelectorAll("button")].find((element) => element.textContent === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
async function text(value: string) {
  const input = document.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows a compact explanation tied to exact source lines, with Vault and Ask more", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"explanation":"A permission failure.","sourceLineIds":[1]}');
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("A permission failure.");
  await click("L1");
  expect(document.querySelector("details")?.open).toBe(true);
  expect(document.querySelector(".is-highlighted")?.textContent).toContain("Permission denied");
  await click("Save to Vault"); expect(createAiNote).toHaveBeenCalledWith(expect.stringContaining("selected detail"), expect.objectContaining({ title: "AI Peek" }));
  await click("Ask more"); expect(openComposer).toHaveBeenCalledWith(expect.stringContaining("Permission denied"));
  expect(stage).not.toHaveBeenCalled();
});

it("tweaks only on Preview and stages only after a separate user action", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"command":"ls -lh","explanation":"Shows readable sizes."}');
  await render({ ...selection, kind: "tweak", text: "ls -l" });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(requestScreenAssist).not.toHaveBeenCalled();
  await text("readable sizes"); await click("Preview");
  expect(document.querySelector(".screen-ai-proposal")?.textContent).toContain("ls -lh");
  expect(stage).not.toHaveBeenCalled();
  await click("Stage in terminal"); expect(stage).toHaveBeenCalledExactlyOnceWith("ls -lh");
  // The staging helper owns target-checked focus; closing must not override it.
  expect(close).toHaveBeenCalledWith(false);
});

it("does not offer staging for an unsupported transformation", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"command":null,"explanation":"No supported dry-run option."}');
  await render({ ...selection, kind: "tweak", text: "some-tool apply" });
  await text("dry run"); await click("Preview");
  expect(document.body.textContent).toContain("No supported dry-run option");
  expect(document.body.textContent).not.toContain("Stage in terminal");
});

it("reviews locally first and contacts AI only on request, with no execution action", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"explanation":"Deletes matching paths.","cautions":["Data may be lost."],"unknowns":["Expanded paths are unknown."]}');
  await render({ ...selection, kind: "review", text: "rm -rf $TARGET", reviewScope: { cwd: "/srv", host: "prod-us", isRemote: true } });
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(requestScreenAssist).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("Deletion or data replacement");
  expect(document.body.textContent).toContain("SSH / prod-us");
  await click("Explain effects with AI");
  expect(requestScreenAssist).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ prompt: expect.stringContaining('"cwd":"/srv"') }));
  expect(document.body.textContent).toContain("AI interpretation · not verified");
  expect(document.body.textContent).toContain("Expanded paths are unknown");
  expect(document.body.textContent).not.toContain("Stage in terminal");
  expect(stage).not.toHaveBeenCalled();
});

it("blocks review requests for multiline commands and shows unknown shell scope honestly", async () => {
  await render({ ...selection, kind: "review", text: "ls\nrm file" });
  expect(document.querySelector('[role="alert"]')).not.toBeNull();
  expect(document.body.textContent).toContain("could not be verified");
  expect(document.body.textContent).not.toContain("Explain effects with AI");
  expect(requestScreenAssist).not.toHaveBeenCalled();
});

it("cancels on close and ignores a late provider response", async () => {
  let finish!: (text: string) => void;
  vi.mocked(requestScreenAssist).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  await render(); await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  const signal = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  await act(async () => root.render(null)); expect(signal.aborted).toBe(true);
  await act(async () => finish('{"explanation":"late","sourceLineIds":[1]}'));
  expect(document.body.textContent).not.toContain("late");
});

it("keeps staging errors visible without reporting success", async () => {
  stage.mockRejectedValueOnce(new Error("Terminal target changed"));
  vi.mocked(requestScreenAssist).mockResolvedValue('{"command":"ls -lh","explanation":"Readable sizes"}');
  await render({ ...selection, kind: "tweak", text: "ls -l" }); await text("readable sizes"); await click("Preview"); await click("Stage in terminal");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("Terminal target changed"); expect(close).not.toHaveBeenCalled();
});

it("clamps the popover to the viewport and restores focus only for an explicit close", async () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ width: 390, height: 300 } as DOMRect);
  await render({ ...selection, kind: "tweak", text: "ls", x: window.innerWidth + 20, y: window.innerHeight + 20 });
  const panel = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(Number.parseFloat(panel.style.left)).toBe(Math.max(8, window.innerWidth - 398));
  expect(Number.parseFloat(panel.style.top)).toBe(Math.max(8, window.innerHeight - 308));
  await act(async () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
  expect(close).toHaveBeenLastCalledWith(false);
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(close).toHaveBeenLastCalledWith(true);
});
