// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { clearAll } = vi.hoisted(() => ({ clearAll: vi.fn(async () => {}) }));
vi.mock("../nativeConfig", () => ({ persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: () => () => {} }));
vi.mock("../../terminal/scrollbackArchive", () => ({ scrollbackArchive: { clearAll } }));
import { TerminalHistorySettings } from "./TerminalHistorySettings";
import { getPrefs, hydratePrefsFromNative, setPrefs } from "../preferences";

const defaults = getPrefs();
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hydratePrefsFromNative({ ...defaults, terminalRestoreScrollback: false, terminalScrollbackRetentionDays: 7 }, defaults.aiAgents);
  clearAll.mockReset().mockResolvedValue(undefined);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); hydratePrefsFromNative(defaults, defaults.aiAgents); });
const render = async () => { await act(async () => root.render(<TerminalHistorySettings />)); };
const toggle = () => host.querySelector<HTMLButtonElement>('[role="switch"]')!;
const button = (label: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.trim() === `[ ${label} ]`)!;
const click = async (label: string) => {
  const target = button(label); expect(target).toBeDefined();
  await act(async () => target.click());
};

it("shows opt-in privacy, retention and storage limits without opening or deleting the archive", async () => {
  await render();
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(host.textContent).toContain("current and future terminal output");
  expect(host.textContent).toContain("plain text, not encrypted by Husk");
  expect(host.textContent).toContain("may contain credentials");
  expect(host.textContent).toContain("commands are never replayed");
  expect(host.textContent).toContain("10,000 rows or 1 MiB");
  expect(host.textContent).toContain("20 MiB total limit");
  expect(clearAll).not.toHaveBeenCalled();
});

it("keeps recording independent from layout restoration and explains the dependency", async () => {
  setPrefs({ sessionRestoreEnabled: false }); await render();
  await act(async () => toggle().click());
  expect(getPrefs()).toMatchObject({ terminalRestoreScrollback: true, sessionRestoreEnabled: false });
  expect(host.querySelector('[role="status"]')?.textContent).toContain("also requires Restore session");
  expect(clearAll).not.toHaveBeenCalled();
});

it("requires explicit confirmation before deleting and allows cancellation", async () => {
  await render(); await click("delete saved terminal history");
  expect(host.textContent).toContain("This cannot be undone");
  expect(clearAll).not.toHaveBeenCalled();
  await click("cancel");
  expect(button("confirm delete history")).toBeUndefined();
  expect(clearAll).not.toHaveBeenCalled();
});

it("prevents duplicate deletion and reports completion without clearing user preferences", async () => {
  let finish!: () => void;
  clearAll.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  setPrefs({ terminalRestoreScrollback: true }); await render();
  await click("delete saved terminal history");
  const confirm = button("confirm delete history");
  await act(async () => { confirm.click(); confirm.click(); });
  expect(clearAll).toHaveBeenCalledTimes(1);
  expect(button("deleting…").disabled).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Deleting");
  await act(async () => finish());
  expect(getPrefs().terminalRestoreScrollback).toBe(true);
  expect(host.textContent).toContain("Saved terminal history deleted");
  expect(host.textContent).toContain("Live terminal output and shell history were not cleared");
});

it("disables recording immediately and clears saved output without another confirmation", async () => {
  let finish!: () => void;
  clearAll.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  setPrefs({ terminalRestoreScrollback: true }); await render();
  await act(async () => toggle().click());
  expect(getPrefs().terminalRestoreScrollback).toBe(false);
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(clearAll).toHaveBeenCalledTimes(1);
  expect(button("confirm delete history")).toBeUndefined();
  await act(async () => finish());
});

it("keeps recording off when deletion fails and offers a safe retry message", async () => {
  clearAll.mockRejectedValueOnce(new Error("private path or raw terminal data"));
  setPrefs({ terminalRestoreScrollback: true }); await render();
  await act(async () => toggle().click());
  expect(getPrefs().terminalRestoreScrollback).toBe(false);
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("recording is off, but saved history could not be deleted");
  expect(host.textContent).not.toContain("private path or raw terminal data");
  await click("delete saved terminal history"); await click("confirm delete history");
  expect(clearAll).toHaveBeenCalledTimes(2);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Saved terminal history deleted");
});

it("shows deletion failure instead of a false success when recording remains enabled", async () => {
  clearAll.mockRejectedValueOnce(new Error("blocked"));
  setPrefs({ terminalRestoreScrollback: true }); await render();
  await click("delete saved terminal history"); await click("confirm delete history");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Nothing has been confirmed deleted");
  expect(host.textContent).not.toContain("Saved terminal history deleted");
  expect(getPrefs().terminalRestoreScrollback).toBe(true);
});

it("preserves custom valid retention while offering one, seven, and thirty days", async () => {
  setPrefs({ terminalScrollbackRetentionDays: 14 }); await render();
  const select = host.querySelector("select")!;
  expect([...select.options].map((option) => option.value)).toEqual(["1", "7", "14", "30"]);
  expect(select.value).toBe("14");
  await act(async () => { select.value = "30"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(getPrefs().terminalScrollbackRetentionDays).toBe(30);
  expect(clearAll).not.toHaveBeenCalled();
});
