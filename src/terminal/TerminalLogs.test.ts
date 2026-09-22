// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  enabled: true,
  buffer: "ready\n\nerror: connection refused\n",
  output: null as ((text: string) => void) | null,
}));
vi.mock("./registry", () => ({
  getSessionHandle: () => ({ getBuffer: () => fixture.buffer }),
  subscribeTerminalOutput: (_leafId: number, listener: (text: string) => void) => {
    fixture.output = listener;
    return () => { if (fixture.output === listener) fixture.output = null; };
  },
}));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: fixture.enabled }) }));
vi.mock("../ai/screenAssist", () => ({ requestScreenAssist: vi.fn() }));
import { requestScreenAssist } from "../ai/screenAssist";
import { TerminalLogs } from "./TerminalLogs";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.enabled = true;
  fixture.buffer = "ready\n\nerror: connection refused\n";
  fixture.output = null;
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); window.getSelection()?.removeAllRanges();
});
async function render(leafId = 1) {
  await act(async () => root.render(createElement(TerminalLogs, { leafId, onClose: vi.fn() })));
}
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent === label || element.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
}
async function output(text: string) { await act(async () => fixture.output?.(text)); }
function evidence() { return container.querySelector('[aria-label="Captured log evidence"]'); }

it("reviews a frozen filtered snapshot and never sends newly arriving output", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"findings":[{"summary":"The connection was refused.","lineIds":[3]}]}');
  await render(); await click("error"); await click("Highlights");
  expect(requestScreenAssist).not.toHaveBeenCalled();
  expect(evidence()?.textContent).toContain("connection refused");
  expect(evidence()?.textContent).not.toContain("ready");
  await output("error: a later event\n");
  expect(container.querySelector(".terminal-logs-list")?.textContent).toContain("later event");
  expect(evidence()?.textContent).not.toContain("later event");
  await click("Analyze");
  const payload = vi.mocked(requestScreenAssist).mock.calls[0][0].prompt;
  expect(payload).toContain("connection refused"); expect(payload).not.toContain("later event");
  await click("L3");
  expect(evidence()?.querySelector(".selected")?.textContent).toContain("connection refused");
});

it("keeps evidence IDs unique when empty log rows are skipped", async () => {
  await render(); await output("\nerror: next line\n\n"); await output("ready again\n");
  const ids = [...container.querySelectorAll("[data-log-id]")].map((row) => row.getAttribute("data-log-id"));
  expect(ids.length).toBe(4); expect(new Set(ids).size).toBe(ids.length);
  await click("Highlights");
  expect(evidence()?.querySelectorAll("[data-highlight-line]").length).toBe(4);
});

it("captures selected log rows rather than unrelated visible rows", async () => {
  await render();
  const row = container.querySelectorAll(".terminal-log-message")[1];
  const range = document.createRange(); range.selectNodeContents(row);
  window.getSelection()?.addRange(range);
  await click("Highlights");
  expect(container.querySelector('[aria-label="Log highlights"]')?.textContent).toContain("Selected log lines");
  expect(evidence()?.textContent).toContain("connection refused");
  expect(evidence()?.textContent).not.toContain("ready");
});

it("explores a frozen structured snapshot locally even when AI is disabled", async () => {
  fixture.enabled = false;
  fixture.buffer = "task,time\ncompile,2ms\ntest,4ms\n";
  await render(); await click("Explore");
  expect(requestScreenAssist).not.toHaveBeenCalled();
  expect(container.querySelector("tbody")?.textContent).toContain("compile");
  await output("later,12ms\n");
  expect(container.querySelector("tbody")?.textContent).not.toContain("later");
  await click("Chart");
  expect(container.querySelectorAll(".output-explore-bar-row")).toHaveLength(2);
  await render(2);
  expect(container.querySelector('[aria-label="Explore captured output"]')).toBeNull();
});

it("captures selected output for Explore and closes the previous inspector", async () => {
  await render(); await click("Highlights");
  const row = container.querySelectorAll(".terminal-log-message")[1];
  const range = document.createRange(); range.selectNodeContents(row);
  window.getSelection()?.addRange(range);
  await click("Explore");
  expect(container.querySelector('[aria-label="Log highlights"]')).toBeNull();
  const source = container.querySelector('[aria-label="Frozen output source"]');
  expect(source?.textContent).toContain("connection refused");
  expect(source?.textContent).not.toContain("ready");
  await click("Highlights");
  expect(container.querySelector('[aria-label="Explore captured output"]')).toBeNull();
});

it("rejects findings that cite lines outside the reviewed snapshot", async () => {
  vi.mocked(requestScreenAssist).mockResolvedValue('{"findings":[{"summary":"An invented finding","lineIds":[999]}]}');
  await render(); await click("Highlights"); await click("Analyze");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(container.querySelector('[aria-label="AI log findings"]')).toBeNull();
  expect(evidence()?.textContent).toContain("connection refused");
});

it.each(["close", "switch terminal", "disable AI", "stop"])("cancels an in-flight request on %s and ignores a late answer", async (action) => {
  let resolve!: (value: string) => void;
  vi.mocked(requestScreenAssist).mockReturnValue(new Promise((done) => { resolve = done; }));
  await render(); await click("Highlights"); await click("Analyze");
  const signal = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  if (action === "close") await click("Close highlights");
  if (action === "switch terminal") await render(2);
  if (action === "disable AI") { fixture.enabled = false; await render(); }
  if (action === "stop") await click("Stop");
  expect(signal.aborted).toBe(true);
  await act(async () => resolve('{"findings":[{"summary":"A late answer","lineIds":[3]}]}'));
  expect(container.textContent).not.toContain("A late answer");
});
