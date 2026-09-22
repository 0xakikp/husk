// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "../toast";
import { FixMemoryStore } from "./fixMemory";
import { RememberFixStrip } from "./RememberFixStrip";
import { closeSavedFixes, getSavedFixesView, openSavedFixes } from "./savedFixesView";
import type { ComparisonRunInput } from "./runComparison";

let root: Root; let container: HTMLDivElement; let store: FixMemoryStore;
const returnToTerminal = vi.fn();
let storage: { getItem: Mock<(key: string) => string | null>; setItem: Mock<(key: string, value: string) => void> };
const base: ComparisonRunInput = { leafId: 1, ptyId: 11, cwd: "/project", remoteHost: null, command: "npm test", output: "Error: Cannot find module 'widget'", exitCode: 1, at: 100 };
function resolved() {
  store.record(base); store.record({ ...base, command: "npm install", exitCode: 0, at: 200 });
  store.record({ ...base, exitCode: 0, output: "passed", at: 300 });
}
async function render(leafId = 1) { await act(async () => root.render(createElement(RememberFixStrip, { leafId, store, onClose: returnToTerminal }))); }
async function openLibrary(leafId = 1) { await act(async () => openSavedFixes(leafId)); }
async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
  expect(button).toBeDefined(); await act(async () => button!.click());
}
async function confirm() {
  const label = [...container.querySelectorAll("label")].find((element) => element.textContent?.includes("These selected steps resolved"));
  await act(async () => label!.querySelector("input")!.click());
}
async function closePanel() {
  const close = container.querySelector<HTMLButtonElement>('[aria-label="Close saved fixes panel"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
}
function saveCapturedFix() {
  const candidate = store.getSnapshot(1)!.candidate!;
  return store.save(1, candidate.id, { title: "Restore dependencies", summary: "Install missing packages", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: true });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
  store = new FixMemoryStore(() => storage, () => 1000);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root.unmount(); closeSavedFixes(1); closeSavedFixes(2); }); container.remove(); });

it("requires explicit review and resolution confirmation before persisting anything", async () => {
  resolved(); await render(); expect(storage.setItem).not.toHaveBeenCalled();
  await click("⌑ Remember this fix");
  expect(container.textContent).toContain("Nothing is sent to AI, staged, or executed");
  expect(container.textContent).toContain("npm install"); expect(container.textContent).toContain("npm test");
  const save = [...container.querySelectorAll("button")].find((button) => button.textContent === "Save fix locally")!;
  expect(save.disabled).toBe(true);
  const excerpt = [...container.querySelectorAll("label")].find((label) => label.textContent?.includes("Save this error excerpt"))!.querySelector("input")!;
  expect(excerpt.checked).toBe(false); await confirm(); await click("Save fix locally");
  expect(storage.setItem).toHaveBeenCalledTimes(1); expect(store.getSaved()).toHaveLength(1);
  expect(container.textContent).toBe("");
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Fix saved locally", variant: "success" }));
  expect(returnToTerminal).toHaveBeenCalledTimes(1);
  expect(writeText).not.toHaveBeenCalled();
});

it("shows a grounded prior fix and copies only an explicitly requested original command without a newline", async () => {
  resolved(); const candidate = store.getSnapshot(1)!.candidate!;
  store.save(1, candidate.id, { title: "Restore dependencies", summary: "Install missing packages", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: true });
  store.record({ ...base, at: 400 }); await render(); await click("↶ Previous fix found");
  expect(container.textContent).toContain("Restore dependencies"); expect(container.textContent).toContain("/project");
  expect(container.textContent).toContain("It may not apply now"); expect(container.textContent).toContain("Resolved");
  expect(writeText).not.toHaveBeenCalled();
  await act(async () => (container.querySelector('[aria-label="Copy command 1"]') as HTMLButtonElement).click());
  expect(writeText).toHaveBeenCalledWith("npm install");
  expect(container.textContent).toContain("without a newline");
});

it("keeps deleting separate from viewing and requires confirmation", async () => {
  resolved(); const candidate = store.getSnapshot(1)!.candidate!;
  store.save(1, candidate.id, { title: "Dependencies", summary: "", stepIds: candidate.steps.map((step) => step.id), includeError: false, confirmed: true });
  storage.setItem.mockClear(); await render(); await openLibrary();
  await click("Delete"); expect(storage.setItem).not.toHaveBeenCalled();
  await click("Cancel deletion"); expect(store.getSaved()).toHaveLength(1);
  await click("Delete"); await click("Delete fix"); expect(store.getSaved()).toEqual([]);
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(container.textContent).toContain("No saved fixes");
  await closePanel(); expect(container.textContent).toBe("");
});

it("keeps the review open when storage fails and never reports false success", async () => {
  resolved(); await render(); await click("⌑ Remember this fix"); await confirm();
  storage.setItem.mockImplementation(() => { throw new Error("quota exceeded"); });
  await click("Save fix locally");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable or full");
  expect(container.textContent).not.toContain("Fix saved locally"); expect(store.getSaved()).toEqual([]);
  expect(toast).not.toHaveBeenCalled();
});

it("removes stale review on scope clear or leaf switch without saving", async () => {
  resolved(); await render(); await click("⌑ Remember this fix"); await confirm();
  await act(async () => store.clear(1)); expect(container.textContent).toBe("");
  expect(storage.setItem).not.toHaveBeenCalled();
  await act(async () => resolved()); await click("⌑ Remember this fix");
  await render(2); expect(container.textContent).toBe(""); expect(storage.setItem).not.toHaveBeenCalled();
});

it("closes and reopens the library after save without removing records or writing again", async () => {
  resolved(); await render(); await click("⌑ Remember this fix"); await confirm(); await click("Save fix locally");
  const saved = store.getSaved();
  expect(saved).toHaveLength(1); expect(storage.setItem).toHaveBeenCalledTimes(1);
  expect(container.textContent).toBe("");
  await openLibrary();
  expect(container.querySelector(".remember-fix__body")).not.toBeNull();
  await closePanel();
  expect(container.querySelector(".remember-fix__body")).toBeNull();
  expect(container.textContent).toBe("");
  expect(store.getSaved()).toBe(saved); expect(storage.setItem).toHaveBeenCalledTimes(1);
  await openLibrary();
  expect(container.querySelector(".remember-fix__body")).not.toBeNull();
  expect(container.textContent).toContain("npm install"); expect(container.textContent).toContain("npm test");
  expect(store.getSaved()).toBe(saved); expect(storage.setItem).toHaveBeenCalledTimes(1);
  // Reopening does not interfere with explicit single-command clipboard copy.
  const copy = container.querySelector<HTMLButtonElement>('[aria-label="Copy command 1"]')!;
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith("npm install"); expect(storage.setItem).toHaveBeenCalledTimes(1);
});

it("keeps persisted saved fixes reopenable after a fresh mount without an active failure", async () => {
  resolved(); const saved = saveCapturedFix();
  const serialized = storage.setItem.mock.calls[0][1];
  await render(); await openLibrary(); await closePanel();
  await act(async () => root.render(null));
  storage.getItem.mockReturnValue(serialized);
  store = new FixMemoryStore(() => storage, () => 2000);
  storage.setItem.mockClear();
  await render();
  expect(store.getSnapshot(1)).toBeNull();
  expect(container.textContent).toBe("");
  expect(container.querySelector(".remember-fix__body")).toBeNull();
  await openLibrary();
  expect(container.textContent).toContain(saved.title); expect(container.textContent).toContain("/project");
  await closePanel(); await openLibrary();
  expect(store.getSaved()).toEqual([saved]); expect(storage.setItem).not.toHaveBeenCalled();
});

it("closes candidate review without dismissing it and keeps explicit dismissal separate", async () => {
  resolved(); const candidate = store.getSnapshot(1)!.candidate;
  await render(); await click("⌑ Remember this fix"); await confirm();
  await closePanel();
  expect(container.querySelector(".remember-fix__body")).toBeNull();
  expect(store.getSnapshot(1)?.candidate).toBe(candidate); expect(storage.setItem).not.toHaveBeenCalled();
  await click("⌑ Remember this fix");
  expect(container.querySelector('[aria-label="Fix title"]')).not.toBeNull();
  expect(store.getSnapshot(1)?.candidate).toBe(candidate); expect(storage.setItem).not.toHaveBeenCalled();
  await closePanel();
  const dismiss = container.querySelector<HTMLButtonElement>('[aria-label="Dismiss fix suggestion"]')!;
  expect(dismiss).not.toBeNull(); await act(async () => dismiss.click());
  expect(store.getSnapshot(1)?.candidate).toBeNull(); expect(container.textContent).toBe("");
  expect(storage.setItem).not.toHaveBeenCalled();
});

it.each(["current", "library"] as const)("Escape closes %s view and returns focus without modifying records", async (view) => {
  resolved(); if (view === "library") saveCapturedFix();
  await render();
  if (view === "library") await openLibrary(); else await click("⌑ Remember this fix");
  const trigger = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "⌑ Remember this fix");
  const target = container.querySelector<HTMLElement>(view === "current" ? '[aria-label="Fix title"]' : '[aria-label="Copy command 1"]')!;
  if (view === "current") expect(trigger!.getAttribute("aria-expanded")).toBe("true");
  target.focus(); expect(document.activeElement).toBe(target);
  const saved = store.getSaved(); const candidate = store.getSnapshot(1)?.candidate;
  storage.setItem.mockClear();
  await act(async () => target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(container.querySelector(".remember-fix__body")).toBeNull();
  if (view === "current") {
    expect(trigger!.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(trigger);
    expect(returnToTerminal).not.toHaveBeenCalled();
  } else {
    expect(container.textContent).toBe("");
    expect(returnToTerminal).toHaveBeenCalledTimes(1);
    expect(getSavedFixesView(1)).toBeNull();
  }
  expect(store.getSaved()).toBe(saved); expect(store.getSnapshot(1)?.candidate).toBe(candidate);
  expect(storage.setItem).not.toHaveBeenCalled();
});

it.each(["current", "library"] as const)("explains storage and retention in a disclosure within %s view", async (view) => {
  resolved(); if (view === "library") saveCapturedFix();
  await render();
  if (view === "library") await openLibrary(); else await click("⌑ Remember this fix");
  const summary = [...container.querySelectorAll("summary")].find((element) => element.textContent?.trim() === "Storage & retention");
  expect(summary).toBeDefined();
  const details = summary!.closest("details")!;
  expect(details).not.toBeNull(); expect(details.open).toBe(false);
  const explanation = details.textContent!.replace(/\s+/g, " ").toLowerCase();
  expect(explanation).toContain("local"); expect(explanation).toContain("app");
  expect(explanation).toContain("restart"); expect(explanation).toMatch(/no (?:automatic )?expiry|do(?:es)? not expire|no (?:automatic )?expiration/);
  expect(explanation).toContain("delete"); expect(explanation).toContain("app data");
  expect(explanation).toContain("30"); expect(explanation).toMatch(/64\s*k(?:i)?b/);
  expect(explanation).toContain("sync"); expect(explanation).toContain("ai");
  expect(explanation).toContain("vault"); expect(explanation).toContain("project");
  storage.setItem.mockClear(); await act(async () => summary!.click());
  expect(details.open).toBe(true); expect(storage.setItem).not.toHaveBeenCalled();
});

it("offers an empty, closable library only on explicit request", async () => {
  await render(); expect(container.textContent).toBe("");
  await openLibrary();
  expect(container.textContent).toContain("No saved fixes");
  expect(container.querySelector('[aria-label="Close saved fixes panel"]')).not.toBeNull();
  await closePanel();
  expect(container.textContent).toBe(""); expect(storage.setItem).not.toHaveBeenCalled();
});

it("does not open the library for a different terminal and clears it on pane changes", async () => {
  resolved(); saveCapturedFix(); await render();
  await openLibrary(2); expect(container.textContent).toBe("");
  await openLibrary(1); expect(container.querySelector(".remember-fix__body")).not.toBeNull();
  await render(2); expect(container.textContent).toBe("");
  expect(getSavedFixesView(1)).toBeNull();
  await render(1); expect(container.textContent).toBe("");
  expect(returnToTerminal).not.toHaveBeenCalled();
});

it("keeps an explicitly opened library visible through StrictMode setup and clears it after unmount", async () => {
  resolved(); saveCapturedFix();
  await openLibrary();
  await act(async () => root.render(createElement(StrictMode, null, createElement(RememberFixStrip, { leafId: 1, store }))));
  expect(container.querySelector(".remember-fix__body")).not.toBeNull();
  expect(getSavedFixesView(1)).not.toBeNull();
  await act(async () => root.render(null));
  expect(getSavedFixesView(1)).toBeNull();
});

it("returns to just the relevant suggestion when an explicitly opened library closes", async () => {
  resolved(); saveCapturedFix(); store.record({ ...base, at: 400 }); await render();
  expect(container.textContent).toContain("Previous fix found");
  expect(container.textContent).not.toContain("Saved fixes");
  await openLibrary(); await closePanel();
  expect(container.querySelector(".remember-fix__body")).toBeNull();
  expect(container.textContent).toContain("Previous fix found");
  expect(store.getSnapshot(1)?.matches).toHaveLength(1);
});

it("keeps the open library mounted without stealing focus when another command fails", async () => {
  resolved(); saveCapturedFix(); await render(); await openLibrary();
  const body = container.querySelector(".remember-fix__body");
  const terminalInput = document.createElement("textarea"); document.body.append(terminalInput); terminalInput.focus();
  try {
    await act(async () => store.record({ ...base, command: "another command", output: "error: a different failure", at: 500 }));
    expect(container.querySelector(".remember-fix__body")).toBe(body);
    expect(document.activeElement).toBe(terminalInput);
    expect(container.textContent).toContain("Restore dependencies");
  } finally { terminalInput.remove(); }
});
