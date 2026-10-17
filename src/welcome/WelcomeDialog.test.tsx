// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const fixtures = vi.hoisted(() => ({
  prefs: { hasSeenWelcome: false, userName: "", aiEnabled: true, showWelcomeOnStartup: true },
  setPrefs: vi.fn(),
}));
vi.mock("../settings/preferences", () => ({ usePrefs: () => fixtures.prefs, setPrefs: fixtures.setPrefs }));
import { WelcomeDialog } from "./WelcomeDialog";

let root: Root, host: HTMLDivElement, background: HTMLButtonElement;
const callbacks = {
  onOpenFolder: vi.fn<() => void | Promise<void>>(),
  onOpenTerminal: vi.fn(),
  onAskHusk: vi.fn(),
  onOpenSettings: vi.fn(),
  onDismiss: vi.fn(),
};
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  Object.assign(fixtures.prefs, { hasSeenWelcome: false, userName: "", aiEnabled: true, showWelcomeOnStartup: true });
  callbacks.onOpenFolder.mockReset();
  background = document.createElement("button");
  background.textContent = "Background terminal";
  host = document.createElement("div");
  document.body.append(background, host);
  background.focus();
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove(); background.remove();
});
async function render(props: { workspacePath?: string; terminalCount?: number } = {}) {
  await act(async () => root.render(<WelcomeDialog {...callbacks} {...props} />));
}
function dialog() { return document.querySelector<HTMLElement>('[role="dialog"]')!; }
function button(label: string) { return Array.from(dialog().querySelectorAll("button")).find((el) => el.textContent?.includes(label))!; }
async function click(label: string) { await act(async () => button(label).click()); }

it("offers first-run setup, labels the dialog, focuses its action, and does nothing automatically", async () => {
  await render();
  expect(dialog().textContent).toContain("Your workspace starts here.");
  expect(dialog().getAttribute("aria-modal")).toBe("true");
  expect(document.getElementById(dialog().getAttribute("aria-labelledby")!)?.textContent).toBe("Your workspace starts here.");
  expect(document.getElementById(dialog().getAttribute("aria-describedby")!)?.textContent).toContain("Open a project");
  expect(dialog().querySelector('input[autocomplete="given-name"]')).not.toBeNull();
  expect(document.activeElement).toBe(button("Open folder"));
  for (const callback of Object.values(callbacks)) expect(callback).not.toHaveBeenCalled();
  expect(fixtures.setPrefs).not.toHaveBeenCalled();
});

it("greets returning users with a dismiss-only continuation and compact optional personalization", async () => {
  Object.assign(fixtures.prefs, { hasSeenWelcome: true, userName: " Spidey " });
  await render({ workspacePath: "/Users/aki/husk", terminalCount: 3 });
  expect(dialog().textContent).toContain("Welcome back, Spidey.");
  expect(dialog().textContent).toContain("Current workspace · /Users/aki/husk");
  expect(dialog().textContent).toContain("3 terminal tabs in this workspace · Commands are not replayed");
  expect(dialog().querySelector("details")?.open).toBe(false);
  expect(document.activeElement).toBe(button("Continue workspace"));
  await click("Continue workspace");
  expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  expect(callbacks.onOpenFolder).not.toHaveBeenCalled();
  expect(callbacks.onOpenTerminal).not.toHaveBeenCalled();
  expect(callbacks.onAskHusk).not.toHaveBeenCalled();
});

it("does not invent a workspace path or terminal connection status", async () => {
  fixtures.prefs.hasSeenWelcome = true;
  await render();
  expect(dialog().textContent).toContain("Welcome back.");
  expect(dialog().textContent).toContain("Return to your tabs and terminals");
  expect(dialog().textContent).not.toContain("Current workspace");
  expect(dialog().textContent).not.toContain("LOCAL");
  expect(dialog().textContent).not.toContain("terminal tabs");
});

it("tolerates a malformed legacy display name without crashing startup", async () => {
  Object.assign(fixtures.prefs, { hasSeenWelcome: true, userName: 17 });
  await render();
  expect(dialog().textContent).toContain("Welcome back.");
  expect(dialog().querySelector<HTMLInputElement>('input[autocomplete="given-name"]')?.value).toBe("");
});

it("updates the startup preference without closing or changing the workspace", async () => {
  await render();
  const input = dialog().querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(input.checked).toBe(true);
  await act(async () => input.click());
  expect(fixtures.setPrefs).toHaveBeenCalledWith({ showWelcomeOnStartup: false });
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
  fixtures.prefs.showWelcomeOnStartup = false;
  await render();
  expect(input.checked).toBe(false);
});

it.each([false, true])("hides AI entry points when AI is disabled (returning: %s)", async (returning) => {
  Object.assign(fixtures.prefs, { hasSeenWelcome: returning, aiEnabled: false });
  await render();
  expect(dialog().textContent).not.toContain("Ask Husk");
  expect(dialog().textContent).not.toContain("with Husk AI nearby");
  expect(callbacks.onAskHusk).not.toHaveBeenCalled();
});

it("invokes only the chosen terminal, AI, or settings action", async () => {
  await render();
  await click("Open terminal"); expect(callbacks.onOpenTerminal).toHaveBeenCalledOnce();
  await click("Ask Husk"); expect(callbacks.onAskHusk).toHaveBeenCalledOnce();
  await click("Settings"); expect(callbacks.onOpenSettings).toHaveBeenCalledOnce();
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
  expect(callbacks.onOpenFolder).not.toHaveBeenCalled();
});

it("dismisses with Escape or the explicit close control", async () => {
  await render();
  await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
  expect(callbacks.onDismiss).toHaveBeenCalledOnce();
  await act(async () => dialog().querySelector<HTMLButtonElement>('[aria-label="Close welcome"]')!.click());
  expect(callbacks.onDismiss).toHaveBeenCalledTimes(2);
});

it("traps focus away from the background and restores it after dismissal", async () => {
  await render();
  expect(background.getAttribute("aria-hidden") ?? background.parentElement?.getAttribute("aria-hidden")).toBe("true");
  await act(async () => background.focus());
  expect(dialog().contains(document.activeElement)).toBe(true);
  await act(async () => root.render(null));
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(document.activeElement).toBe(background);
});

it("keeps welcome open on picker cancellation, disables repeated requests while busy, and handles errors", async () => {
  let finish!: () => void;
  callbacks.onOpenFolder.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  await render();
  await click("Open folder");
  expect(button("Opening picker").disabled).toBe(true);
  await click("Opening picker");
  expect(callbacks.onOpenFolder).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(button("Open folder").disabled).toBe(false);
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
  callbacks.onOpenFolder.mockRejectedValueOnce(new Error("private native details"));
  await click("Open folder");
  expect(dialog().querySelector('[role="alert"]')?.textContent).toBe("Could not open the folder picker. Please try again.");
  expect(dialog().textContent).not.toContain("private native details");
  expect(button("Open folder").disabled).toBe(false);
  await click("Open folder");
  expect(dialog().querySelector('[role="alert"]')).toBeNull();
});

it("handles a picker failure after unmount without touching the next screen", async () => {
  let fail!: (reason: unknown) => void;
  callbacks.onOpenFolder.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
  await render(); await click("Open folder");
  await act(async () => root.render(null));
  await act(async () => fail(new Error("cancelled")));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(callbacks.onDismiss).not.toHaveBeenCalled();
});
