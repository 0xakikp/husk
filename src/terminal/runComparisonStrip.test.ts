// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../ai/screenAssist", () => ({ requestScreenAssist: vi.fn() }));
import { requestScreenAssist } from "../ai/screenAssist";
import { clearRunComparisons, recordComparisonRun } from "./runComparison";
import { RunComparisonStrip } from "./runComparisonStrip";

let root: Root;
let container: HTMLDivElement;
function run(output: string, at: number): void {
  recordComparisonRun({ leafId: 1, ptyId: 11, cwd: "/project", command: "npm test", remoteHost: null, exitCode: 0, output, at });
}
async function render(aiEnabled = true): Promise<void> {
  await act(async () => root.render(createElement(RunComparisonStrip, { leafId: 1, aiEnabled })));
}
async function click(text: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text));
  expect(button).toBeDefined();
  await act(async () => { button!.click(); });
}
function deferred() {
  let resolve!: (result: string) => void;
  const promise = new Promise<string>((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); clearRunComparisons(1); });

it("never sends automatically, and shows deterministic differences before AI is requested", async () => {
  run("failed", 1); await render(); expect(container.textContent).toBe("");
  await act(async () => { run("passed", 2); });
  expect(requestScreenAssist).not.toHaveBeenCalled();
  expect(container.textContent).toContain("+1 −1");
  await click("Compare with previous");
  expect(container.textContent).toContain("failed"); expect(container.textContent).toContain("passed");
  expect(requestScreenAssist).not.toHaveBeenCalled();
});

it("renders only validated findings whose citations focus real captured lines", async () => {
  run("failed", 1); run("passed", 2); await render(); await click("Compare with previous");
  vi.mocked(requestScreenAssist).mockResolvedValue('{"claims":[{"text":"Output changed to passed.","evidence":["after-1"]}]}');
  await click("Explain changes");
  expect(container.textContent).toContain("Output changed to passed.");
  await click("after-1");
  expect(document.activeElement?.getAttribute("data-comparison-line")).toBe("after-1");
});

it("rejects hallucinated evidence while keeping the local comparison visible", async () => {
  run("failed", 1); run("passed", 2); await render(); await click("Compare with previous");
  vi.mocked(requestScreenAssist).mockResolvedValue('{"claims":[{"text":"Tests all passed.","evidence":["not-real"]}]}');
  await click("Explain changes");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unsupported claim");
  expect(container.textContent).not.toContain("Tests all passed.");
  expect(container.textContent).toContain("failed");
});

it("refuses sensitive content before any AI request", async () => {
  run("password=private-password", 1); run("safe", 2); await render(); await click("Compare with previous");
  expect(container.textContent).toContain("Possible credentials detected");
  await click("Explain changes"); expect(requestScreenAssist).not.toHaveBeenCalled();
});

it("aborts and discards a late explanation when a new command completes", async () => {
  run("failed", 1); run("passed", 2); await render(); await click("Compare with previous");
  const pending = deferred(); vi.mocked(requestScreenAssist).mockReturnValue(pending.promise);
  await click("Explain changes");
  const signal = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  await act(async () => { run("latest", 3); });
  expect(signal.aborted).toBe(true);
  await act(async () => { pending.resolve('{"claims":[{"text":"Stale result","evidence":["after-1"]}]}'); });
  expect(container.textContent).not.toContain("Stale result");
});

it("aborts on collapse, AI disable, or unmount without executing terminal commands", async () => {
  run("failed", 1); run("passed", 2); await render(); await click("Compare with previous");
  vi.mocked(requestScreenAssist).mockReturnValue(new Promise(() => {}));
  await click("Explain changes");
  const first = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  await click("Compare with previous"); expect(first.aborted).toBe(true);
  await click("Compare with previous"); await click("Explain changes");
  const second = vi.mocked(requestScreenAssist).mock.calls[1][0].signal!;
  await render(false); expect(second.aborted).toBe(true);
  expect(container.textContent).not.toContain("Explain changes");
  await render(true); await click("Explain changes");
  const third = vi.mocked(requestScreenAssist).mock.calls[2][0].signal!;
  await act(async () => { root.render(null); }); expect(third.aborted).toBe(true);
});
