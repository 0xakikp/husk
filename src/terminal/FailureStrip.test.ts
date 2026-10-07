// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PromptReadiness } from "./promptDraft";

const fixtures = vi.hoisted(() => ({
  leafId: 10,
  prompt: { ready: true } as PromptReadiness,
  scope: { token: "session-1", ptyId: 11, cwd: "/project", isRemote: false, host: null },
  focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
vi.mock("../ai/bubbleStore", () => ({ openComposer: vi.fn() }));
vi.mock("../ai/terminalContext", () => ({ setPendingRunAttachment: vi.fn() }));
vi.mock("../ai/terminalTarget", () => ({ captureTerminalTarget: () => ({ ...fixtures.scope }) }));
vi.mock("../ai/screenAssist", () => ({ parseScreenObject: JSON.parse }));
vi.mock("./registry", () => ({
  getActiveTerminalLeafId: () => fixtures.leafId,
  getSessionHandle: () => ({
    getPtyId: () => fixtures.scope.ptyId,
    getStagingScope: () => ({ ...fixtures.scope }),
    getPromptReadiness: () => fixtures.prompt,
    focus: fixtures.focus,
  }),
}));
import { invoke } from "@tauri-apps/api/core";
import { toast } from "../toast";
import { clearFailure, getFailure, recordFailure } from "./failureStore";
import { FailureStrip } from "./FailureStrip";

let root: Root;
let container: HTMLDivElement;
function fail(command = "pnpm test") {
  recordFailure(10, { command, output: "test failed", exitCode: 1, cwd: "/project", terminalScope: fixtures.scope });
  return getFailure(10)!.record;
}
async function render() { await act(async () => root.render(createElement(FailureStrip, { leafId: 10 }))); }
function retryButton() { return [...container.querySelectorAll("button")].find((button) => button.textContent?.startsWith("Retry"))!; }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(fixtures, { leafId: 10, prompt: { ready: true }, scope: { token: "session-1", ptyId: 11, cwd: "/project", isRemote: false, host: null } });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); clearFailure(10); container.remove(); });

it("shows a failure without executing it and retries once only on a click", async () => {
  fail(); await render();
  expect(invoke).not.toHaveBeenCalled();
  await act(async () => retryButton().click());
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 11, data: "pnpm test\r" });
  expect(container.textContent).toBe("");
});

it.each([
  "The terminal already has visible input. Clear or submit it first.",
  "Husk cannot verify an empty shell prompt. Return to a fresh prompt.",
  "The terminal is busy or its shell prompt is not ready.",
])("shows the actual prompt block without clearing the failure: %s", async (reason) => {
  const record = fail(); fixtures.prompt = { ready: false, reason }; await render();
  await act(async () => retryButton().click());
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not retry command", message: reason }));
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(record);
  expect(retryButton().disabled).toBe(false);
});

it("keeps the strip and disables duplicate clicks while the native write is pending", async () => {
  const record = fail();
  let resolveWrite!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
  await render();
  await act(async () => { const button = retryButton(); button.click(); button.click(); });
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(getFailure(10)?.record).toBe(record);
  expect(retryButton().disabled).toBe(true);
  expect(retryButton().textContent).toBe("Retrying…");
  await act(async () => resolveWrite(undefined));
  expect(container.textContent).toBe("");
});

it("reports rejected native writes and keeps Retry available", async () => {
  const record = fail(); await render();
  vi.mocked(invoke).mockRejectedValueOnce("PTY is disconnected");
  await act(async () => retryButton().click());
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ message: "PTY is disconnected", variant: "error" }));
  expect(getFailure(10)?.record).toBe(record);
  expect(retryButton().disabled).toBe(false);
  await act(async () => retryButton().click());
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("keeps a newer failure visible when the previous submission completes", async () => {
  fail();
  let resolveWrite!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
  await render(); await act(async () => retryButton().click());
  await act(async () => { fail("pnpm build"); resolveWrite(undefined); });
  expect(container.textContent).toContain("pnpm build");
  expect(retryButton().disabled).toBe(false);
});
