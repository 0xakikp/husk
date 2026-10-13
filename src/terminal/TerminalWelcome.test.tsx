// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TerminalSessionStatus } from "./sessionLifecycle";

const prefs = vi.hoisted(() => ({ terminalWelcomeEnabled: true, userName: "Aki", terminalTheme: "husk", theme: "dark", accentColor: "#11c700" }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => prefs }));
vi.mock("../lib/platform", () => ({ MOD_KEY: "⌘", fmtShortcut: (...parts: string[]) => parts.join("") }));
import { TerminalWelcome } from "./TerminalWelcome";
import { dismissTerminalWelcome, disposeTerminalWelcome, getTerminalWelcome, initializeTerminalWelcome, noteTerminalWelcomeCommand, observeTerminalWelcomePrompt, scrollTerminalWelcome } from "./terminalWelcomeState";

let root: Root;
let host: HTMLDivElement;
const onDismiss = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  prefs.terminalWelcomeEnabled = true; prefs.userName = "Aki"; prefs.theme = "dark";
  onDismiss.mockClear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  initializeTerminalWelcome(1);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  disposeTerminalWelcome(1); disposeTerminalWelcome(2);
});
async function render({ leafId = 1, restored = false, status = { state: "ready" } as TerminalSessionStatus } = {}) {
  await act(async () => root.render(createElement(TerminalWelcome, { leafId, restored, status, onDismiss, getRowHeight: () => 16 })));
}
async function prompt(leafId = 1, cwd = "/Users/aki/husk") {
  await act(async () => observeTerminalWelcomePrompt(leafId, cwd, true));
}

it("waits for verified prompt metadata rather than showing guessed local status", async () => {
  await render(); expect(host.textContent).toBe("");
  await prompt();
  expect(host.querySelector('section[aria-label="Hi, Aki"]')).not.toBeNull();
  expect(host.querySelectorAll("pre")).toHaveLength(3);
  expect(host.textContent).toContain("Local shell");
  expect(host.textContent).toContain("Ready");
  expect(host.textContent).not.toContain("/Users/aki/husk");
  expect(host.textContent).toContain("⌘K");
  expect(host.textContent).toContain("Ctrl+R");
  expect(host.querySelector("pre")?.parentElement?.getAttribute("aria-hidden")).toBe("true");
});

it.each(["starting", "slow-start", "error", "disconnected", "unresponsive", "exited"] as const)("does not claim readiness during %s", async (state) => {
  await prompt(); await render({ status: { state } });
  expect(host.textContent).toBe("");
});

it("excludes restored terminals and honors the persistent preference", async () => {
  await prompt(); await render({ restored: true }); expect(host.textContent).toBe("");
  prefs.terminalWelcomeEnabled = false;
  await render(); expect(host.textContent).toBe("");
  prefs.terminalWelcomeEnabled = true;
  await render(); expect(host.textContent).toContain("Local shell");
});

it("uses HUSK only when the Settings name is blank; renders long/non-Latin names as text", async () => {
  await prompt();
  for (const [name, label, glyphs] of [["  ", "HUSK", 4], ["അഖിൽ", "അഖിൽ", 0], ["a very long display name", "a very long display name", 0]] as const) {
    prefs.userName = name;
    await render();
    expect(host.querySelector("section")?.getAttribute("aria-label")).toBe(`${name.trim() ? "Hi," : "Welcome to"} ${label}`);
    expect(host.querySelectorAll("pre")).toHaveLength(glyphs);
    expect(host.querySelector("strong")?.textContent).toBe(label);
  }
});

it("dismisses only this session, restores focus, and stays dismissed after remount", async () => {
  initializeTerminalWelcome(2); await prompt(2); await prompt(); await render();
  await act(async () => host.querySelector("button")!.click());
  expect(host.textContent).toBe(""); expect(onDismiss).toHaveBeenCalledOnce();
  expect(getTerminalWelcome(2)?.visible).toBe(true);
  await act(async () => root.unmount()); root = createRoot(host);
  await prompt(); await render(); expect(host.textContent).toBe("");
  await render({ leafId: 2 }); expect(host.textContent).toContain("Local shell");
});

it("reacts to per-terminal lifecycle dismissal without recreating its welcome", async () => {
  await prompt(); await render();
  await act(async () => dismissTerminalWelcome(1));
  expect(host.textContent).toBe("");
  await prompt(); expect(host.textContent).toBe("");
});

it("keeps the greeting during a command without falsely claiming the prompt is ready", async () => {
  await prompt(); await render();
  expect(host.textContent).toContain("Ready");
  await act(async () => noteTerminalWelcomeCommand(1));
  expect(host.querySelector('section[aria-label="Hi, Aki"]')).not.toBeNull();
  expect(host.textContent).not.toContain("Ready");
  await prompt(); expect(host.textContent).toContain("Ready");
});

it("keeps working-directory metadata out of the greeting", async () => {
  await prompt(1, "/project/private-name"); await render();
  expect(host.textContent).not.toContain("/project/private-name");
  expect(host.innerHTML).not.toContain("/project/private-name");
  expect(host.querySelector("code")).toBeNull();
});

it("moves upward row-by-row with output, frees the same space, and retires only after leaving view", async () => {
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ height: 80 } as DOMRect);
  try {
    await prompt(); await render();
    await act(async () => scrollTerminalWelcome(1, 2));
    expect(host.querySelector<HTMLElement>(".terminal-welcome")?.style.transform).toBe("translateY(-32px)");
    expect(host.querySelector<HTMLElement>(".terminal-welcome-slot")?.style.height).toBe("48px");
    expect(getTerminalWelcome(1)?.visible).toBe(true);
    await act(async () => scrollTerminalWelcome(1, 5));
    expect(host.textContent).toBe("");
    expect(getTerminalWelcome(1)?.visible).toBe(false);
  } finally { bounds.mockRestore(); }
});
