// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
import { listen } from "@tauri-apps/api/event";
import { installTerminalWakeChecks, mayRestoreTerminalFocus } from "./sessionWake";
let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
});
afterEach(() => { dispose?.(); dispose = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

it("coalesces native and DOM wake events into a read-only callback", async () => {
  const check = vi.fn(); dispose = installTerminalWakeChecks(check);
  window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow"));
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(101);
  expect(check).toHaveBeenCalledOnce();
  expect(listen).toHaveBeenCalledWith("tauri://focus", expect.any(Function));
});
it("checks after a long wall-clock gap, but does not poll every normal timer tick", async () => {
  const check = vi.fn(); dispose = installTerminalWakeChecks(check);
  await vi.advanceTimersByTimeAsync(20_000); expect(check).not.toHaveBeenCalled();
  vi.setSystemTime(Date.now() + 86_400_000);
  await vi.advanceTimersByTimeAsync(10_101); expect(check).toHaveBeenCalledOnce();
});
it("does not check hidden windows or continue after disposal", async () => {
  const check = vi.fn(); dispose = installTerminalWakeChecks(check);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(101);
  expect(check).not.toHaveBeenCalled(); dispose();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(101);
  expect(check).not.toHaveBeenCalled();
});
it("never steals focus from AI inputs, search fields or open dialogs", () => {
  const terminal = document.createElement("div"); const termInput = document.createElement("textarea");
  terminal.append(termInput); document.body.append(terminal);
  expect(mayRestoreTerminalFocus(document, terminal)).toBe(true);
  termInput.focus(); expect(mayRestoreTerminalFocus(document, terminal)).toBe(true);
  const chat = document.createElement("textarea"); document.body.append(chat); chat.focus();
  expect(mayRestoreTerminalFocus(document, terminal)).toBe(false);
  chat.remove();
  const dialog = document.createElement("div"); dialog.setAttribute("role", "dialog"); dialog.dataset.state = "open";
  document.body.append(dialog); expect(mayRestoreTerminalFocus(document, terminal)).toBe(false);
});
