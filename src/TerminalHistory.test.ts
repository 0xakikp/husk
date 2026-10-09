// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ enabled: true }));
vi.mock("./settings/preferences", () => ({ usePrefs: () => ({ aiEnabled: fixtures.enabled, fontFamily: "system" }) }));
vi.mock("./ai/screenAssist", () => ({ requestScreenAssist: vi.fn(), parseScreenObject: (response: string) => JSON.parse(response) }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
import { requestScreenAssist } from "./ai/screenAssist";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { TerminalHistoryPanel } from "./TerminalHistory";
import type { HistoryRecallRow } from "./ai/historyRecall";

let root: Root;
let container: HTMLDivElement;
const select = vi.fn();
const close = vi.fn();
const rows: HistoryRecallRow[] = [
  { command: "git status", timestamp: 1700000000, source: "Local shell history" },
  { command: "ssh -L 5432:localhost:5432 db", timestamp: null, source: "Local shell history" },
  { command: "export TOKEN=do-not-transmit-this", timestamp: null, source: "Local shell history" },
];
let entries: string[];
async function render(terminalId = 1, nextEntries = entries, nextRows = rows): Promise<void> {
  await act(async () => root.render(createElement(TerminalHistoryPanel, { entries: nextEntries, rows: nextRows, terminalId, loading: false, onSelect: select, onClose: close })));
}
async function click(text: string): Promise<void> {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === text);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
async function query(text: string): Promise<void> {
  const input = container.querySelector<HTMLInputElement>(".term-hist-input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function startRecall(): Promise<void> { await render(); await click("Ask AI"); await query("forward Postgres"); }
function deferred<T = string>() {
  let resolve!: (result: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixtures.enabled = true;
  select.mockReset(); close.mockReset(); vi.mocked(writeText).mockReset().mockResolvedValue();
  entries = rows.map((row) => row.command);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("preserves default local fuzzy search without contacting AI", async () => {
  await render(); await query("git");
  expect(container.querySelectorAll(".term-hist-item")).toHaveLength(1);
  expect(requestScreenAssist).not.toHaveBeenCalled();
  await act(async () => container.querySelector<HTMLButtonElement>(".term-hist-item")!.click());
  expect(select).toHaveBeenCalledWith("git status");
  expect(container.textContent).toContain("stage");
});

it("requires explicit review and send, omits detected secrets and honors exclusions", async () => {
  await startRecall();
  expect(requestScreenAssist).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Local shell history is not your remote host’s history");
  expect(container.textContent).not.toContain("do-not-transmit-this");
  const checkbox = container.querySelector<HTMLInputElement>('[aria-label="Include git status"]')!;
  await act(async () => checkbox.click());
  vi.mocked(requestScreenAssist).mockResolvedValue('{"matches":[]}');
  await click("Find matches");
  const prompt = vi.mocked(requestScreenAssist).mock.calls[0][0].prompt;
  expect(prompt).not.toContain("git status"); expect(prompt).not.toContain("do-not-transmit-this");
  expect(prompt).toContain("ssh -L 5432");
});

it("displays actual stored metadata and stages only a real returned command", async () => {
  await startRecall(); vi.mocked(requestScreenAssist).mockResolvedValue('{"matches":["h2"]}'); await click("Find matches");
  const result = container.querySelector<HTMLButtonElement>(".term-hist-recall-result")!;
  expect(result.textContent).toContain("Date not recorded · Local shell history · Host not recorded");
  await act(async () => result.click());
  expect(select).toHaveBeenCalledExactlyOnceWith(rows[1].command);
});

it("rejects a returned ID excluded by the user", async () => {
  await startRecall();
  await act(async () => container.querySelector<HTMLInputElement>('[aria-label="Include git status"]')!.click());
  vi.mocked(requestScreenAssist).mockResolvedValue('{"matches":["h1"]}'); await click("Find matches");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("outside the reviewed history");
  expect(container.querySelector(".term-hist-recall-result")).toBeNull(); expect(select).not.toHaveBeenCalled();
});

it.each(["query", "terminal", "entries", "rows", "mode", "unmount"])("cancels and ignores late history matches after %s changes", async (change) => {
  await startRecall(); const pending = deferred(); vi.mocked(requestScreenAssist).mockReturnValue(pending.promise); await click("Find matches");
  const signal = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  if (change === "query") await query("docker images");
  if (change === "terminal") await render(2);
  if (change === "entries") await render(1, [...entries]);
  if (change === "rows") await render(1, entries, [...rows]);
  if (change === "mode") await click("Local search");
  if (change === "unmount") await act(async () => root.render(null));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve('{"matches":["h2"]}'));
  expect(container.querySelector(".term-hist-recall-result")).toBeNull(); expect(select).not.toHaveBeenCalled();
});

it("does not offer AI when globally disabled, and aborts when disabled while running", async () => {
  fixtures.enabled = false; await render(); expect(container.textContent).not.toContain("Ask AI");
  fixtures.enabled = true; await startRecall(); vi.mocked(requestScreenAssist).mockReturnValue(new Promise(() => {})); await click("Find matches");
  const signal = vi.mocked(requestScreenAssist).mock.calls[0][0].signal!;
  fixtures.enabled = false; await render(); expect(signal.aborted).toBe(true); expect(container.textContent).not.toContain("Find matches");
});

const promptError = "Husk cannot verify an empty shell prompt. Return to a fresh prompt or copy the command instead.";
function historyInput(): HTMLInputElement { return container.querySelector<HTMLInputElement>(".term-hist-input")!; }
function historyItem(index = 0): HTMLButtonElement { return container.querySelectorAll<HTMLButtonElement>(".term-hist-item")[index]; }
function enter(): void { historyInput().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); }

it("shows a staging refusal in the picker, preserves search and selection, and copies only on request", async () => {
  select.mockRejectedValue(new Error(promptError));
  await render(); await query("git");
  await act(async () => historyItem().click());
  const alert = container.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain("Could not stage history command");
  expect(alert.textContent).toContain(promptError);
  expect(alert.textContent).toContain("git status");
  expect(historyInput().value).toBe("git");
  expect(historyItem().classList.contains("active")).toBe(true);
  expect(close).not.toHaveBeenCalled();
  expect(writeText).not.toHaveBeenCalled();
  await click("Copy command");
  expect(writeText).toHaveBeenCalledExactlyOnceWith("git status");
  expect(container.querySelector('[role="status"]')?.textContent).toBe("Copied. Nothing was run.");
  expect(select).toHaveBeenCalledExactlyOnceWith("git status");
  expect(close).not.toHaveBeenCalled();
});

it("catches synchronous staging errors from existing consumers", async () => {
  select.mockImplementation(() => { throw new Error(promptError); });
  await render();
  await act(async () => enter());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(promptError);
  expect(close).not.toHaveBeenCalled();
});

it.each(["mouse", "Enter"])("awaits %s staging success and lets the terminal close only after confirmation", async (input) => {
  const pending = deferred<void>();
  select.mockImplementation(async () => { await pending.promise; close(); });
  await render();
  await act(async () => { if (input === "mouse") historyItem().click(); else enter(); });
  expect(select).toHaveBeenCalledExactlyOnceWith("git status");
  expect(close).not.toHaveBeenCalled();
  expect(container.querySelector('.term-hist-list')?.getAttribute("aria-busy")).toBe("true");
  expect(historyItem().disabled).toBe(true);
  await act(async () => pending.resolve());
  expect(close).toHaveBeenCalledTimes(1);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("locks duplicate clicks and Enter even before the pending state renders", async () => {
  const pending = deferred<void>(); select.mockReturnValue(pending.promise);
  await render();
  await act(async () => { historyItem().click(); historyItem().click(); enter(); });
  await act(async () => enter());
  expect(select).toHaveBeenCalledExactlyOnceWith("git status");
  await act(async () => pending.reject(new Error(promptError)));
  expect(historyItem().disabled).toBe(false);
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(promptError);
  select.mockResolvedValue(undefined);
  await act(async () => enter());
  expect(select).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("reports clipboard failures inline without an unhandled rejection and permits retry", async () => {
  select.mockRejectedValue(new Error(promptError));
  vi.mocked(writeText).mockRejectedValueOnce(new Error("Clipboard unavailable"));
  await render(); await act(async () => historyItem().click());
  await click("Copy command");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Could not copy command: Clipboard unavailable");
  expect(container.querySelector('[role="status"]')).toBeNull();
  await click("Copy command");
  expect(writeText).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Copied");
  expect(container.textContent).not.toContain("Clipboard unavailable");
  expect(close).not.toHaveBeenCalled();
});

it.each(["terminal", "unmount"])("ignores a late staging refusal after %s changes", async (change) => {
  const pending = deferred<void>(); select.mockReturnValue(pending.promise);
  await render(); await act(async () => historyItem().click());
  if (change === "terminal") await render(2);
  else await act(async () => root.render(null));
  await act(async () => pending.reject(new Error(promptError)));
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(close).not.toHaveBeenCalled();
});

it.each(["success", "failure"])("ignores late clipboard %s for a superseded staging refusal", async (result) => {
  const pending = deferred<void>(); vi.mocked(writeText).mockReturnValue(pending.promise);
  select.mockRejectedValue(new Error(promptError));
  await render(); await act(async () => historyItem().click());
  await click("Copy command");
  await act(async () => historyItem(1).click());
  await act(async () => {
    if (result === "success") pending.resolve();
    else pending.reject(new Error("Old clipboard failure"));
  });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(rows[1].command);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(container.textContent).not.toContain("Old clipboard failure");
});

it("shows the same inline recovery when an AI-recalled history result cannot be staged", async () => {
  select.mockRejectedValue(new Error(promptError));
  await startRecall(); vi.mocked(requestScreenAssist).mockResolvedValue('{"matches":["h2"]}'); await click("Find matches");
  await act(async () => historyItem().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain(promptError);
  await click("Copy command");
  expect(writeText).toHaveBeenCalledExactlyOnceWith(rows[1].command);
  expect(close).not.toHaveBeenCalled();
});
