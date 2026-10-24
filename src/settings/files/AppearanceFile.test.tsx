// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../nativeConfig", () => ({ persistNativeConfigSection: vi.fn(), subscribeNativeConfigDocument: () => () => {} }));
vi.mock("../../fs", () => ({ readFileBase64: vi.fn(), readDir: vi.fn(async () => []) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
import { AppearanceFile } from "./AppearanceFile";
import { getPrefs, hydratePrefsFromNative, setPrefs } from "../preferences";
import { BUILT_IN_WALLPAPERS, builtInWallpaperPath } from "../wallpapers";
import { readFileBase64 } from "../../fs";

const defaults = getPrefs();
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hydratePrefsFromNative(defaults, []);
  vi.mocked(readFileBase64).mockReset();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const preview = () => (host.querySelector(".appearance-current-preview") as HTMLElement).style.backgroundImage;
const thumbnail = () => (host.querySelector(".appearance-wallpaper-status-preview") as HTMLElement).style.backgroundImage;
const select = async (path: string, enabled = true) => {
  await act(async () => setPrefs({ background: { ...getPrefs().background, path, enabled } }));
};
const render = async () => { await act(async () => root.render(<AppearanceFile />)); };

it("does not read a local file for an empty or bundled wallpaper", async () => {
  await select(""); await render();
  expect(readFileBase64).not.toHaveBeenCalled(); expect(preview()).toBe("");
  await select(builtInWallpaperPath(BUILT_IN_WALLPAPERS[0].id));
  expect(readFileBase64).not.toHaveBeenCalled();
  expect(preview()).toContain(BUILT_IN_WALLPAPERS[0].src);
});

it("uses the selected local image for the live look and thumbnail, not a placeholder", async () => {
  vi.mocked(readFileBase64).mockResolvedValue("data:image/png;base64,Zmlyc3Q=");
  await select("/fixture/wallpaper.png"); await render();
  expect(readFileBase64).toHaveBeenCalledWith("/fixture/wallpaper.png");
  expect(preview()).toContain("data:image/png;base64,Zmlyc3Q=");
  expect(thumbnail()).toBe(preview());
});

it("does not show an old image while another image is loading or after it resolves late", async () => {
  const resolve = new Map<string, (url: string) => void>();
  vi.mocked(readFileBase64).mockImplementation(path => new Promise(done => resolve.set(path, done)));
  await select("/fixture/first.png"); await render();
  await select("/fixture/second.png");
  expect(preview()).toBe(""); expect(thumbnail()).toBe("");
  await act(async () => resolve.get("/fixture/second.png")!("data:image/png;base64,c2Vjb25k"));
  await act(async () => resolve.get("/fixture/first.png")!("data:image/png;base64,Zmlyc3Q="));
  expect(preview()).toContain("c2Vjb25k"); expect(thumbnail()).toContain("c2Vjb25k");
  expect(preview()).not.toContain("Zmlyc3Q=");
});

it("clears a loaded local preview immediately when the selected path changes", async () => {
  vi.mocked(readFileBase64).mockResolvedValueOnce("data:image/png;base64,Zmlyc3Q=").mockImplementation(() => new Promise(() => {}));
  await select("/fixture/first.png"); await render();
  expect(preview()).toContain("Zmlyc3Q=");
  await select("/fixture/second.png");
  expect(preview()).toBe(""); expect(thumbnail()).toBe("");
});

it("shows a safe actionable read error and clears it when a new image succeeds", async () => {
  vi.mocked(readFileBase64).mockRejectedValueOnce(new Error("private fixture contents"));
  await select("/fixture/missing.png"); await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Choose the image again");
  expect(host.textContent).not.toContain("private fixture contents"); expect(preview()).toBe("");
  vi.mocked(readFileBase64).mockResolvedValueOnce("data:image/png;base64,bmV3");
  await select("/fixture/new.png");
  expect(host.querySelector('[role="status"]')).toBeNull(); expect(preview()).toContain("bmV3");
});

it("ignores a rejected old request after switching to a bundled image or clearing the path", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(readFileBase64).mockImplementation(() => new Promise((_, fail) => { reject = fail; }));
  await select("/fixture/old.png"); await render();
  await select(builtInWallpaperPath(BUILT_IN_WALLPAPERS[0].id));
  await act(async () => reject(new Error("old failure")));
  expect(host.querySelector('[role="status"]')).toBeNull();
  expect(preview()).toContain(BUILT_IN_WALLPAPERS[0].src);
  await select(""); expect(preview()).toBe("");
});

it("keeps the chosen thumbnail available while wallpaper rendering is disabled", async () => {
  vi.mocked(readFileBase64).mockResolvedValueOnce("data:image/png;base64,Zml4dHVyZQ==");
  await select("/fixture/off.png", false); await render();
  expect(preview()).toBe(""); expect(thumbnail()).toContain("Zml4dHVyZQ==");
  expect(host.querySelector("h2")?.textContent).toBe("Wallpaper off");
});

it("does not update a removed preview when its read completes", async () => {
  let finish!: (url: string) => void;
  vi.mocked(readFileBase64).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await select("/fixture/pending.png"); await render();
  await act(async () => root.render(null));
  await act(async () => finish("data:image/png;base64,bGF0ZQ=="));
  expect(host.innerHTML).toBe("");
});
