// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getPrefs, hydratePrefsFromNative, setPrefs, usePrefs } from "../settings/preferences";
import { useStartupWelcome } from "./useStartupWelcome";

vi.mock("../settings/nativeConfig", () => ({ persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: vi.fn(() => () => {}) }));

const originalPrefs = getPrefs();
let root: Root, host: HTMLDivElement, welcome: ReturnType<typeof useStartupWelcome>;
function Probe() {
  usePrefs(); // App also rerenders when any setting changes.
  welcome = useStartupWelcome();
  return null;
}
async function render(key = "launch") {
  await act(async () => root.render(<StrictMode><Probe key={key} /></StrictMode>));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  hydratePrefsFromNative({}, originalPrefs.aiAgents);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  hydratePrefsFromNative(originalPrefs, originalPrefs.aiAgents);
});

it("shows first-run setup even when a migrated onboarding preference disables recurring welcome", async () => {
  setPrefs({ hasSeenWelcome: false, showWelcomeOnStartup: false });
  await render();
  expect(welcome.isOpen).toBe(true);
  await act(async () => welcome.dismiss());
  expect(getPrefs().hasSeenWelcome).toBe(true);
  expect(getPrefs().showWelcomeOnStartup).toBe(false);
  expect(welcome.isOpen).toBe(false);
  await render("next launch");
  expect(welcome.isOpen).toBe(false);
});

it("shows once on every main-app launch without disabling the preference when dismissed", async () => {
  setPrefs({ hasSeenWelcome: true, showWelcomeOnStartup: true });
  await render();
  expect(welcome.isOpen).toBe(true);
  await act(async () => welcome.dismiss());
  expect(welcome.isOpen).toBe(false);
  expect(getPrefs().showWelcomeOnStartup).toBe(true);
  await render();
  expect(welcome.isOpen).toBe(false);
  await render("next launch");
  expect(welcome.isOpen).toBe(true);
});

it("does not reopen on wake, focus, rerenders, or unrelated preference updates", async () => {
  await render();
  await act(async () => welcome.dismiss());
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
    setPrefs({ userName: "Alex", terminalWelcomeEnabled: false });
  });
  await render();
  expect(welcome.isOpen).toBe(false);
});

it("honors an opt-out, and changing the preference only takes effect on the next launch", async () => {
  setPrefs({ hasSeenWelcome: true, showWelcomeOnStartup: false });
  await render();
  expect(welcome.isOpen).toBe(false);
  await act(async () => setPrefs({ showWelcomeOnStartup: true }));
  expect(welcome.isOpen).toBe(false);
  await render("next launch");
  expect(welcome.isOpen).toBe(true);
  await act(async () => setPrefs({ showWelcomeOnStartup: false }));
  expect(welcome.isOpen).toBe(true);
  await act(async () => welcome.dismiss());
  await render("third launch");
  expect(welcome.isOpen).toBe(false);
});

it("can still open manually from the palette after opting out", async () => {
  setPrefs({ hasSeenWelcome: true, showWelcomeOnStartup: false });
  await render();
  await act(async () => welcome.show());
  expect(welcome.isOpen).toBe(true);
  expect(getPrefs().showWelcomeOnStartup).toBe(false);
  await act(async () => welcome.dismiss());
  expect(welcome.isOpen).toBe(false);
});
