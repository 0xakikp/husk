// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConfigStatus } from "./nativeConfig";

const fixture = vi.hoisted(() => ({
  status: { ready: true, path: "/fixture/config.toml", phase: "saved", error: null, dirty: false, saving: false } as ConfigStatus,
  drafts: [] as { label: string; busy: boolean }[],
  confirm: vi.fn(), flush: vi.fn(), retry: vi.fn(), close: vi.fn(),
}));
vi.mock("./nativeConfig", () => ({
  useNativeConfigStatus: () => fixture.status,
  flushNativeConfig: fixture.flush, retryNativeConfig: fixture.retry,
  persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: vi.fn(() => () => {}),
}));
vi.mock("./settingsDrafts", () => ({ confirmSettingsNavigation: fixture.confirm, useSettingsDraftState: () => fixture.drafts }));
vi.mock("./files/AgentsFile", async () => {
  const { useState } = await import("react");
  return { AgentsFile: () => {
    const [editing, setEditing] = useState(false);
    return editing ? <div data-agent-editor>Editing agent draft</div> : <div>
      <button onClick={() => setEditing(true)}>Edit fixture agent</button>
      <div data-setting-key="responseStyle" tabIndex={-1}><select aria-label="Response style"><option>Concise</option></select></div>
    </div>;
  } };
});
vi.mock("./files/AppearanceFile", () => ({ AppearanceFile: () => <div data-appearance>Appearance content</div> }));
vi.mock("./files/ModelsFile", () => ({ ModelsFile: () => <div data-setting-key="defaultModel"><input aria-label="Default model" /></div> }));
vi.mock("./files/CrashFile", () => ({ CrashFile: () => <div data-privacy>Crash reporting privacy</div> }));

import { SettingsPage } from "./SettingsPage";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.status = { ready: true, path: "/fixture/config.toml", phase: "saved", error: null, dirty: false, saving: false };
  fixture.drafts = [];
  fixture.confirm.mockReset().mockResolvedValue(true);
  fixture.flush.mockReset().mockResolvedValue(undefined);
  fixture.retry.mockReset().mockResolvedValue(undefined);
  fixture.close.mockReset().mockResolvedValue(undefined);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); });
async function render() {
  await act(async () => { root.render(<SettingsPage onClose={fixture.close} />); await vi.dynamicImportSettled(); });
}
function button(text: string) {
  const result = [...host.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent?.includes(text));
  expect(result, `button containing ${text}`).toBeDefined();
  return result!;
}
async function click(node: HTMLElement) { await act(async () => { node.click(); await vi.dynamicImportSettled(); }); }
async function search(value: string) {
  const input = host.querySelector<HTMLInputElement>('[aria-label="Search settings"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function status() { return host.querySelector(".settings-save-status")?.textContent; }

describe("settings page navigation and persistence", () => {
  it("shows grouped categories, clear current location, and readable initial status", async () => {
    await render();
    expect(host.querySelector("h1")?.textContent).toBe("Workspace");
    expect(host.querySelector('nav[aria-label="Settings areas"]')).not.toBeNull();
    expect(button("Editor, terminal, and startup").getAttribute("aria-current")).toBe("page");
    expect(status()).toBe("Saved locally");
    expect(host.querySelector('[aria-label="Close settings"]')).not.toBeNull();
  });

  it("does not discard drafts when a category change is cancelled", async () => {
    await render(); fixture.confirm.mockResolvedValue(false);
    await click(button("Appearance"));
    expect(fixture.confirm).toHaveBeenCalledOnce();
    expect(host.querySelector("h1")?.textContent).toBe("Workspace");
    fixture.confirm.mockResolvedValue(true);
    await click(button("Appearance"));
    expect(host.querySelector("h1")?.textContent).toBe("Appearance");
    expect(host.querySelector("[data-appearance]")).not.toBeNull();
  });

  it("deduplicates category actions while a draft decision is pending", async () => {
    let decide!: (value: boolean) => void;
    fixture.confirm.mockReturnValue(new Promise(resolve => { decide = resolve; }));
    await render();
    await act(async () => { button("Appearance").click(); button("AI & Models").click(); });
    expect(fixture.confirm).toHaveBeenCalledOnce();
    await act(async () => { decide(true); await vi.dynamicImportSettled(); });
    expect(host.querySelector("h1")?.textContent).toBe("Appearance");
  });

  it("restores each category's scroll position", async () => {
    await render();
    host.querySelector("main")!.scrollTop = 350;
    await click(button("Appearance"));
    host.querySelector("main")!.scrollTop = 120;
    await click(button("Editor, terminal, and startup"));
    expect(host.querySelector("main")!.scrollTop).toBe(350);
  });

  it("confirms and saves before close, and cancels safely", async () => {
    await render(); fixture.confirm.mockResolvedValue(false);
    await click(host.querySelector('[aria-label="Close settings"]')!);
    expect(fixture.flush).not.toHaveBeenCalled(); expect(fixture.close).not.toHaveBeenCalled();
    fixture.confirm.mockResolvedValue(true);
    let finish!: () => void;
    fixture.flush.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    await click(host.querySelector('[aria-label="Close settings"]')!);
    expect(fixture.close).not.toHaveBeenCalled();
    await act(async () => finish());
    expect(fixture.close).toHaveBeenCalledOnce();
  });

  it("keeps the page open on failed persistence and exposes retry feedback", async () => {
    fixture.flush.mockRejectedValue(new Error("Disk full"));
    await render(); await click(host.querySelector('[aria-label="Close settings"]')!);
    expect(fixture.close).not.toHaveBeenCalled();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Disk full");
    await click(button("Retry"));
    expect(fixture.retry).toHaveBeenCalledOnce();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.close).not.toHaveBeenCalled();
  });

  it.each([
    [{ phase: "loading", ready: false }, [], "Loading…"],
    [{ phase: "dirty", dirty: true }, [], "Changes pending"],
    [{ phase: "saving", saving: true, dirty: true }, [], "Saving…"],
    [{ phase: "error", error: "Failed", dirty: true }, [], "Not saved"],
    [{}, [{ label: "Agent", busy: false }], "Unsaved draft"],
    [{}, [{ label: "Agent", busy: true }], "Saving…"],
  ])("reports status truthfully for %j", async (config, drafts, expected) => {
    fixture.status = { ...fixture.status, ...config } as ConfigStatus;
    fixture.drafts = drafts;
    await render(); expect(status()).toBe(expected);
  });
});

describe("settings search navigation", () => {
  it("finds scrollback, expands Advanced terminal, highlights and focuses the actual select", async () => {
    await render();
    const row = host.querySelector<HTMLElement>('[data-setting-key="scrollback"]')!;
    const details = row.closest("details")!;
    expect(details.open).toBe(false);
    await search("scrollback"); await click(button("Terminal scrollback"));
    expect(details.open).toBe(true);
    expect(row.classList.contains("settings-search-highlight")).toBe(true);
    expect(document.activeElement).toBe(row.querySelector("select"));
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(row.querySelector("select")?.getAttribute("aria-labelledby")).toBeTruthy();
  });

  it("targets terminal font size rather than the identically named editor control", async () => {
    await render(); await search("terminal fontsize"); await click(button("Terminal font size"));
    expect(document.activeElement?.closest("[data-setting-key]")?.getAttribute("data-setting-key")).toBe("terminal.fontSize");
    expect(host.querySelector('[data-setting-key="editor.fontSize"]')?.classList.contains("settings-search-highlight")).toBe(false);
  });

  it("searches categories and shows an accessible no-results state", async () => {
    await render(); await search("privacy telemetry"); await click(button("Privacy"));
    expect(host.querySelector("[data-privacy]")).not.toBeNull();
    await search("unmatched-fixture-8391839");
    expect(host.querySelector(".settings-search-empty")?.textContent).toContain("No settings match");
    expect(host.querySelector(".cfgx-sidebar-kicker")?.textContent).toBe("0 results");
  });

  it("finds a target after a lazily loaded area appears", async () => {
    await render(); await search("default model"); await click(button("Default model"));
    expect(host.querySelector("h1")?.textContent).toBe("AI & Models");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Default model");
  });

  it("guards a same-area search that would leave an agent editor, then reveals overview", async () => {
    await render(); await click(button("Personas and assistant behavior"));
    await click(button("Edit fixture agent"));
    expect(host.querySelector("[data-agent-editor]")).not.toBeNull();
    await search("response style");
    fixture.confirm.mockClear().mockResolvedValue(false);
    await click(button("response Style"));
    expect(fixture.confirm).toHaveBeenCalledOnce();
    expect(host.querySelector("[data-agent-editor]")).not.toBeNull();
    fixture.confirm.mockResolvedValue(true);
    await click(button("response Style"));
    expect(host.querySelector("[data-agent-editor]")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Response style");
  });
});
