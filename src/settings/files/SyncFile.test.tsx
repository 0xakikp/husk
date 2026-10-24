// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncFile } from "./SyncFile";
import { exportSettings, prepareSettingsImport, applySettingsImport } from "../cloudSync";
import { toast } from "../../toast";

vi.mock("../../toast", () => ({ toast: vi.fn() }));
vi.mock("../cloudSync", () => ({ exportSettings: vi.fn(), prepareSettingsImport: vi.fn(), applySettingsImport: vi.fn(), BACKUP_EXCLUSIONS: "Secrets and MCP configurations are excluded." }));
let container: HTMLDivElement;
let root: Root;
const copied = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: copied } });
  copied.mockResolvedValue(undefined);
  vi.mocked(exportSettings).mockResolvedValue("husk-settings:v1:fixture");
  vi.mocked(prepareSettingsImport).mockResolvedValue({ backup: { format: "husk-settings", version: 1, createdAt: "2026-10-22T00:00:00Z", preferences: {}, ai: {}, agents: [], appearancePresets: [], bookmarks: [] }, summary: ["0 bookmarks"], warnings: ["Existing items are kept."] });
  vi.mocked(applySettingsImport).mockResolvedValue();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(<SyncFile />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
  expect(button).toBeTruthy();
  await act(async () => button!.click());
}
async function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLSelectElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

describe("settings backup UI", () => {
  it("does not claim clipboard success merely from generation", async () => {
    await setValue(container.querySelector('input[type="password"]')!, " fixture passphrase ");
    await click("Generate encrypted backup");
    expect(exportSettings).toHaveBeenCalledWith(" fixture passphrase ");
    expect(copied).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Encrypted backup created.");
    expect(vi.mocked(toast).mock.calls.flatMap(([arg]) => arg.title).join()).not.toContain("copied");
  });

  it("waits for clipboard success and exposes failures without losing the backup", async () => {
    await click("Generate encrypted backup");
    let resolve!: () => void;
    copied.mockImplementationOnce(() => new Promise<void>((done) => { resolve = done; }));
    await click("Copy encrypted backup");
    expect(container.textContent).not.toContain("backup copied");
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    await act(async () => resolve());
    expect(container.textContent).toContain("Encrypted backup copied");
    copied.mockRejectedValueOnce(new Error("denied"));
    await click("Copy encrypted backup");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Clipboard access failed");
    expect(container.querySelector("textarea")!.value).toBe("husk-settings:v1:fixture");
  });

  it("requires preview and explicit confirmation, then reports durable import failure", async () => {
    await setValue(container.querySelector("select")!, "import");
    await setValue(container.querySelector("textarea")!, "fixture");
    expect(container.textContent).not.toContain("Confirm & merge");
    await click("Review backup");
    expect(applySettingsImport).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Existing items are kept");
    expect(container.textContent).toContain("Inspect settings and definitions");
    vi.mocked(applySettingsImport).mockRejectedValueOnce(new Error("Could not save backup"));
    await click("Confirm & merge");
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("Could not save backup");
    expect(container.textContent).not.toContain("Backup merged.");
  });

  it("invalidates a preview whenever the passphrase or input changes", async () => {
    await setValue(container.querySelector("select")!, "import");
    await click("Review backup");
    expect(container.textContent).toContain("Confirm & merge");
    await setValue(container.querySelector('input[type="password"]')!, "changed passphrase");
    expect(container.textContent).not.toContain("Confirm & merge");
    await click("Review backup");
    await setValue(container.querySelector("textarea")!, "changed blob");
    expect(container.textContent).not.toContain("Confirm & merge");
  });
});
