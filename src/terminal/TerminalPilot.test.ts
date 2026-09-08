// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ pty: 1, busy: false, cwd: "/project", remote: { isRemote: false, host: undefined as string | undefined } }));
vi.mock("../ai/client", () => ({ generateOnce: vi.fn() }));
vi.mock("../ai/terminalContext", () => ({ getActiveRemoteTerminal: () => fixtures.remote, getActiveTerminalCwd: () => fixtures.cwd, subscribeTerminalCommandRuns: () => () => {} }));
vi.mock("./envSignals", () => ({ protectedTargets: () => [] }));
import { generateOnce } from "../ai/client";
import { TerminalPilot } from "./TerminalPilot";

let root: Root;
let container: HTMLDivElement;
const run = vi.fn(() => true);
const props = {
  provider: { id: "local", kind: "openai-compatible" as const, label: "Local", defaultModel: "model", keyless: true },
  model: "model", apiKey: "", baseURL: "http://localhost", cwd: "/project",
  getTargetPtyId: () => fixtures.pty, isTerminalRunning: () => fixtures.busy, runInTargetTerminal: run,
};
const decision = (command: string) => `\`\`\`husk-pilot\n${JSON.stringify({ action: "run", command, reason: "Inspect" })}\n\`\`\``;
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}
async function render(id = 1, supervisionPaused = false) {
  await act(async () => root.render(createElement(TerminalPilot, { ...props, request: { id, task: "Inspect the project" }, supervisionPaused })));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  fixtures.pty = 1; fixtures.busy = false; fixtures.cwd = "/project"; fixtures.remote = { isRemote: false, host: undefined };
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); });

it("aborts planning on pause and ignores a provider that resolves late", async () => {
  const pending = deferred(); vi.mocked(generateOnce).mockReturnValue(pending.promise);
  await render();
  const signal = vi.mocked(generateOnce).mock.calls[0][3]!;
  await click("pause");
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(decision("pwd")); await vi.advanceTimersByTimeAsync(10); });
  expect(run).not.toHaveBeenCalled();
});

it("does not execute a queued diagnostic from the previous request after restart", async () => {
  vi.mocked(generateOnce).mockResolvedValueOnce(decision("pwd"));
  await render(); // The safe command is scheduled but has not reached the terminal.
  vi.mocked(generateOnce).mockReturnValueOnce(new Promise(() => {}));
  await render(2);
  await act(async () => { await vi.advanceTimersByTimeAsync(10); });
  expect(run).not.toHaveBeenCalled();
});

it.each(["terminal", "SSH", "busy", "folder"])("refuses a late command when the %s target changes", async (change) => {
  const pending = deferred(); vi.mocked(generateOnce).mockReturnValue(pending.promise);
  await render();
  if (change === "terminal") fixtures.pty = 2;
  if (change === "SSH") fixtures.remote = { isRemote: true, host: "different-host" };
  if (change === "busy") fixtures.busy = true;
  if (change === "folder") fixtures.cwd = "/different-folder";
  await act(async () => { pending.resolve(decision("pwd")); await vi.advanceTimersByTimeAsync(10); });
  expect(run).not.toHaveBeenCalled();
  expect(container.textContent).toContain("paused");
});

it("requires explicit approval for destructive arguments", async () => {
  vi.mocked(generateOnce).mockResolvedValue(decision("git branch -D release"));
  await render();
  expect(run).not.toHaveBeenCalled();
  await click("approve & run");
  expect(run).toHaveBeenCalledWith("git branch -D release");
});

it("does not start a planner while the task is paused", async () => {
  await render(1, true);
  expect(generateOnce).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

it("aborts an in-flight planner on unmount", async () => {
  const pending = deferred(); vi.mocked(generateOnce).mockReturnValue(pending.promise);
  await render();
  const signal = vi.mocked(generateOnce).mock.calls[0][3]!;
  await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve(decision("pwd")); await vi.advanceTimersByTimeAsync(10); });
  expect(run).not.toHaveBeenCalled();
});
