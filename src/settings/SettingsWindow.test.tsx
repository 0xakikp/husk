// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  listeners: new Map<string, () => void>(),
  closeHandler: undefined as undefined | ((event: { preventDefault: () => void }) => unknown),
  unlisten: [] as ReturnType<typeof vi.fn>[],
  listen: vi.fn(), onCloseRequested: vi.fn(), destroy: vi.fn(), isFocused: vi.fn(),
  flush: vi.fn(), retry: vi.fn(), confirm: vi.fn(), chrome: vi.fn(), toast: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ listen: fixture.listen, onCloseRequested: fixture.onCloseRequested, destroy: fixture.destroy, isFocused: fixture.isFocused }) }));
vi.mock("./nativeConfig", () => ({ flushNativeConfig: fixture.flush, retryNativeConfig: fixture.retry }));
vi.mock("./settingsDrafts", () => ({ confirmSettingsNavigation: fixture.confirm }));
vi.mock("./windowChrome", () => ({ useWindowChrome: fixture.chrome }));
vi.mock("../toast", () => ({ toast: fixture.toast, ToastContainer: () => <div data-toasts /> }));
vi.mock("./SettingsPage", () => ({ SettingsPage: ({ onClose }: { onClose: () => void }) => <button onClick={onClose}>Close page</button> }));
import { SettingsWindow } from "./SettingsWindow";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  fixture.listeners.clear(); fixture.unlisten = []; fixture.closeHandler = undefined;
  fixture.listen.mockImplementation(async (name: string, handler: () => void) => {
    fixture.listeners.set(name, handler); const stop = vi.fn(); fixture.unlisten.push(stop); return stop;
  });
  fixture.onCloseRequested.mockImplementation(async (handler: typeof fixture.closeHandler) => {
    fixture.closeHandler = handler; const stop = vi.fn(); fixture.unlisten.push(stop); return stop;
  });
  fixture.destroy.mockResolvedValue(undefined); fixture.isFocused.mockResolvedValue(true);
  fixture.flush.mockResolvedValue(undefined); fixture.retry.mockResolvedValue(undefined); fixture.confirm.mockResolvedValue(true);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
async function render(strict = false) { await act(async () => root.render(strict ? <StrictMode><SettingsWindow /></StrictMode> : <SettingsWindow />)); }
async function nativeClose() {
  const event = { preventDefault: vi.fn() };
  await act(async () => { await fixture.closeHandler?.(event); });
  return event;
}

it("mounts notifications and uses the same live chrome as the main app", async () => {
  await render();
  expect(host.querySelector("[data-toasts]")).not.toBeNull(); expect(fixture.chrome).toHaveBeenCalled();
});

it("confirms drafts and waits for durable persistence before native close", async () => {
  let complete!: () => void;
  fixture.flush.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
  await render(); const event = { preventDefault: vi.fn() };
  let pending!: Promise<unknown>;
  await act(async () => { pending = Promise.resolve(fixture.closeHandler?.(event)); });
  expect(event.preventDefault).toHaveBeenCalled(); expect(fixture.confirm).toHaveBeenCalledOnce();
  expect(fixture.flush).toHaveBeenCalledOnce(); expect(fixture.destroy).not.toHaveBeenCalled();
  await act(async () => { complete(); await pending; });
  expect(fixture.destroy).toHaveBeenCalledOnce();
});

it("keeps unsaved drafts open if the user declines discard", async () => {
  fixture.confirm.mockResolvedValue(false); await render(); await nativeClose();
  expect(fixture.flush).not.toHaveBeenCalled(); expect(fixture.destroy).not.toHaveBeenCalled();
});

it("does not prompt twice when the page has already confirmed its own close", async () => {
  await render(); await act(async () => host.querySelector("button")!.click());
  expect(fixture.confirm).not.toHaveBeenCalled(); expect(fixture.flush).toHaveBeenCalledOnce();
  expect(fixture.destroy).toHaveBeenCalledOnce();
});

it("keeps the window open after save failure and offers a retry that saves before closing", async () => {
  fixture.flush.mockRejectedValue(new Error("fixture write failure"));
  await render(); await nativeClose();
  expect(fixture.destroy).not.toHaveBeenCalled();
  const message = fixture.toast.mock.calls[0][0];
  expect(message).toMatchObject({ variant: "error", title: "Settings stayed open", duration: 0 });
  await act(async () => message.action.onClick());
  expect(fixture.retry).toHaveBeenCalledOnce(); expect(fixture.destroy).toHaveBeenCalledOnce();
});

it("deduplicates concurrent native close requests", async () => {
  let complete!: () => void;
  fixture.flush.mockReturnValue(new Promise<void>(resolve => { complete = resolve; }));
  await render();
  let pending!: Promise<unknown>;
  await act(async () => { pending = Promise.resolve(fixture.closeHandler?.({ preventDefault: vi.fn() })); });
  const second = await nativeClose();
  expect(second.preventDefault).toHaveBeenCalled(); expect(fixture.flush).toHaveBeenCalledOnce();
  await act(async () => { complete(); await pending; }); expect(fixture.destroy).toHaveBeenCalledOnce();
});

it("updates window focus and ignores an outdated initial focus query", async () => {
  let initial!: (value: boolean) => void;
  fixture.isFocused.mockReturnValue(new Promise<boolean>(resolve => { initial = resolve; }));
  await render();
  fixture.listeners.get("tauri://blur")!();
  expect(document.documentElement.classList.contains("settings-unfocused")).toBe(true);
  await act(async () => initial(true));
  expect(document.documentElement.classList.contains("settings-unfocused")).toBe(true);
  fixture.listeners.get("tauri://focus")!();
  expect(document.documentElement.classList.contains("settings-unfocused")).toBe(false);
});

it("cleans up registrations that finish after StrictMode cleanup", async () => {
  const pending: ((stop: () => void) => void)[] = [];
  fixture.listen.mockImplementation(() => new Promise<() => void>(resolve => pending.push(resolve)));
  fixture.onCloseRequested.mockImplementation(() => new Promise<() => void>(resolve => pending.push(resolve)));
  await render(true);
  const stops = pending.map(() => vi.fn());
  await act(async () => pending.forEach((resolve, i) => resolve(stops[i])));
  expect(stops).toHaveLength(6);
  expect(stops.slice(0, 3).every(stop => stop.mock.calls.length === 1)).toBe(true);
  expect(stops.slice(3).every(stop => stop.mock.calls.length === 0)).toBe(true);
  await act(async () => root.render(null));
  expect(stops.every(stop => stop.mock.calls.length === 1)).toBe(true);
});

it("handles rejected native listener registration without an unhandled rejection", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fixture.listen.mockRejectedValue(new Error("fixture unavailable"));
  fixture.onCloseRequested.mockRejectedValue(new Error("fixture unavailable"));
  await render();
  expect(console.warn).toHaveBeenCalled(); expect(host.querySelector("button")).not.toBeNull();
});
