// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { confirm } from "@tauri-apps/plugin-dialog";
import { confirmSettingsNavigation, registerSettingsDraft } from "./settingsDrafts";
const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.resetAllMocks(); });
it("allows navigation with no draft", async () => {
  expect(await confirmSettingsNavigation()).toBe(true); expect(confirm).not.toHaveBeenCalled();
});
it("keeps drafts unless discarding is explicitly confirmed", async () => {
  cleanups.push(registerSettingsDraft("a", { label: "Agent", busy: false }));
  vi.mocked(confirm).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  expect(await confirmSettingsNavigation()).toBe(false);
  expect(await confirmSettingsNavigation()).toBe(true);
  expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Agent"), expect.objectContaining({ cancelLabel: "Keep editing" }));
});
it("does not navigate away from an in-flight save", async () => {
  cleanups.push(registerSettingsDraft("a", { label: "Agent", busy: true }));
  expect(await confirmSettingsNavigation()).toBe(false); expect(confirm).not.toHaveBeenCalled();
});
it("fails closed if the discard dialog fails", async () => {
  cleanups.push(registerSettingsDraft("a", { label: "Prompt", busy: false }));
  vi.mocked(confirm).mockRejectedValueOnce(new Error("Unavailable"));
  expect(await confirmSettingsNavigation()).toBe(false);
});
it("deduplicates concurrent confirmation dialogs", async () => {
  cleanups.push(registerSettingsDraft("a", { label: "Prompt", busy: false }));
  let finish!: (value: boolean) => void;
  vi.mocked(confirm).mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const one = confirmSettingsNavigation(), two = confirmSettingsNavigation(); finish(false);
  expect(await one).toBe(false); expect(await two).toBe(false); expect(confirm).toHaveBeenCalledTimes(1);
});
