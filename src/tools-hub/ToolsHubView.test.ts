// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ dir: "", onSelectView: vi.fn(), onOpenTotp: vi.fn() }));
vi.mock("../settings/preferences", () => ({ usePrefs: () => ({ pluginsDir: fixture.dir }), setPrefs: vi.fn((values) => { fixture.dir = values.pluginsDir; }) }));
vi.mock("../plugins/loader", () => ({ loadPlugins: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../plugins/PluginPanel", () => ({ PluginPanel: (props: { plugin: { name: string }; active: boolean }) => createElement("div", { "data-plugin-active": String(props.active) }, props.plugin.name) }));
vi.mock("../ports/PortsView", () => ({ PortsView: () => createElement("div", {}, "Local ports") }));
vi.mock("../dev-tools/DevToolsView", () => ({ DevToolsView: () => createElement("div", {}, "Local dev tools") }));
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { loadPlugins, type LoadedPlugin } from "../plugins/loader";
import { setPrefs } from "../settings/preferences";
import { ToolsHubView } from "./ToolsHubView";
let root: Root; let container: HTMLDivElement;
const plugin = { plugin: { id: "test", name: "Test plugin", views: [{ title: "View", command: "tool list" }] } };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); fixture.dir = "";
  vi.mocked(loadPlugins).mockReset().mockResolvedValue([]); vi.mocked(invoke).mockReset();
  vi.mocked(open).mockReset(); vi.mocked(setPrefs).mockClear();
  fixture.onSelectView.mockReset(); fixture.onOpenTotp.mockReset();
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
async function render(active = true) {
  await act(async () => root.render(createElement(ToolsHubView, { active, onSelectView: fixture.onSelectView, onTypeCommand: vi.fn(), onOpenTotp: fixture.onOpenTotp, onOpenBrowser: vi.fn() })));
}
async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent?.startsWith(text) || node.getAttribute("aria-label") === text);
  expect(button, text).toBeDefined(); await act(async () => button!.click());
}
async function selectOption(text: string) {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Tools options"]');
  expect(trigger).not.toBeNull();
  await act(async () => trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === text);
  expect(item, text).toBeDefined(); await act(async () => item!.click());
}
async function openManager() { await selectOption("Manage custom plugins…"); }
it("presents a compact six-tool launcher without probing, setup instructions, or unchecked statuses", async () => {
  await render();
  expect(invoke).not.toHaveBeenCalled(); expect(loadPlugins).not.toHaveBeenCalled();
  expect(container.textContent).toContain("Utilities"); expect(container.textContent).toContain("Infrastructure");
  expect([...container.querySelectorAll(".tools-hub-row-title")].map((node) => node.textContent)).toEqual(["2FA Codes", "Ports", "Dev Tools", "Kubernetes", "Docker", "Tailscale"]);
  for (const text of ["Custom plugins", "CLI not checked", "API integration", "Check CLIs", "No folder", "Only run commands", "local CLI configuration", "Generate locally stored", "planned"]) {
    expect(container.textContent).not.toContain(text);
  }
});
it("reveals descriptions on keyboard focus, associates them accessibly, and dismisses with Escape", async () => {
  await render();
  const row = [...container.querySelectorAll<HTMLButtonElement>(".tools-hub-row")].find((node) => node.textContent === "2FA Codes")!;
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => row.focus());
  const tooltip = document.querySelector('[role="tooltip"]');
  expect(tooltip?.textContent).toContain("Generate locally stored time-based codes");
  expect(row.getAttribute("aria-describedby")).toBe(tooltip?.id);
  expect(container.textContent).not.toContain("Generate locally stored time-based codes");
  await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
it("keeps built-in launcher actions working without executing plugin commands", async () => {
  await render(); await click("2FA Codes"); expect(fixture.onOpenTotp).toHaveBeenCalledOnce();
  await click("Docker"); expect(fixture.onSelectView).toHaveBeenCalledWith("docker");
  await click("Ports"); expect(container.textContent).toContain("Local ports");
  expect(invoke).not.toHaveBeenCalled();
});
it("checks only actual CLI tools from the header menu and displays only actionable unavailable badges", async () => {
  vi.mocked(invoke).mockResolvedValue(["docker"]); await render(); await selectOption("Check CLIs");
  expect(invoke).toHaveBeenCalledWith("detect_binaries", { bins: ["kubectl", "docker"] });
  expect(invoke).toHaveBeenCalledOnce();
  const rows = [...container.querySelectorAll(".tools-hub-row")];
  const status = (name: string) => rows.find((node) => node.querySelector(".tools-hub-row-title")?.textContent === name)?.querySelector(".tools-hub-row-status");
  expect(status("Kubernetes")?.textContent).toBe("Unavailable");
  expect(status("Docker")).toBeNull();
  expect(status("Tailscale")).toBeNull();
  expect(container.textContent).not.toContain("CLI found"); expect(container.textContent).not.toContain("API integration");
});
it("shows a detection error without labelling every CLI as missing", async () => {
  vi.mocked(invoke).mockRejectedValue(new Error("unavailable")); await render(); await selectOption("Check CLIs");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
  for (const row of container.querySelectorAll(".tools-hub-row")) expect(row.textContent).not.toContain("Unavailable");
});
it("moves plugin setup into a separate manager that returns to the clean launcher", async () => {
  await render(); await openManager();
  expect(container.textContent).toContain("Custom plugins");
  expect(container.textContent).toContain("No folder selected");
  expect(container.textContent).toContain("trust");
  expect(container.textContent).toContain("JSON");
  expect(container.textContent).toContain("Choose folder");
  expect(container.textContent).not.toContain("Reload plugins");
  expect(container.textContent).not.toContain("Clear folder selection");
  expect(container.textContent).not.toContain("Utilities");
  expect(invoke).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  await click("Back to tools");
  expect(container.textContent).toContain("Utilities"); expect(container.textContent).not.toContain("No folder selected");
});
it("changes, reloads, and clears a plugin folder only from explicit manager actions", async () => {
  vi.mocked(open).mockResolvedValueOnce("/plugins");
  await render(); await openManager(); await click("Choose folder");
  expect(open).toHaveBeenCalledWith({ directory: true, multiple: false, title: "Choose custom plugin folder" });
  expect(setPrefs).toHaveBeenCalledWith({ pluginsDir: "/plugins" });
  await render();
  expect(container.textContent).toContain("/plugins"); expect(container.textContent).toContain("Change folder");
  expect(loadPlugins).toHaveBeenCalledTimes(1);
  await click("Reload plugins"); expect(loadPlugins).toHaveBeenCalledTimes(2);
  await click("Clear folder selection"); expect(setPrefs).toHaveBeenLastCalledWith({ pluginsDir: "" });
  await render(); expect(container.textContent).toContain("No folder selected");
  expect(invoke).not.toHaveBeenCalled();
});
it("distinguishes broken folders, empty folders and malformed files with retry", async () => {
  fixture.dir = "/plugins"; vi.mocked(loadPlugins).mockRejectedValueOnce(new Error("permission denied"));
  await render(); await openManager(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("permission denied");
  expect(container.textContent).not.toContain("No .json");
  await click("Retry"); expect(container.textContent).toContain("No .json plugin files");
  fixture.dir = "/invalid"; vi.mocked(loadPlugins).mockResolvedValueOnce([{ id: "bad", error: "invalid command" }]);
  await render(); expect(container.querySelector('[role="alert"]')?.textContent).toContain("invalid command");
});
it("keeps plugin failures compact in the launcher and exposes details and retry in the manager", async () => {
  fixture.dir = "/plugins";
  vi.mocked(loadPlugins).mockRejectedValueOnce(new Error("permission denied"));
  await render();
  expect(container.textContent).toContain("Needs attention");
  expect(container.textContent).not.toContain("permission denied");
  expect(container.textContent).not.toContain("/plugins");
  await click("Plugin setup");
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("permission denied");
  expect(container.textContent).toContain("/plugins");
  await click("Retry");
  expect(container.textContent).toContain("No .json plugin files");
  await click("Back to tools");
  expect(container.textContent).not.toContain("Custom plugins");
  expect(container.textContent).not.toContain("Needs attention");
  expect(invoke).not.toHaveBeenCalled();
});
it("discards a late catalog from a previous folder and closes its selected plugin", async () => {
  let resolve!: (value: LoadedPlugin[]) => void;
  fixture.dir = "/old"; vi.mocked(loadPlugins).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  await render(); fixture.dir = "/new"; vi.mocked(loadPlugins).mockResolvedValueOnce([plugin]); await render();
  await act(async () => resolve([{ id: "old", error: "obsolete" }]));
  expect(container.textContent).not.toContain("obsolete"); await click("Test plugin");
  expect(container.querySelector("[data-plugin-active]")?.getAttribute("data-plugin-active")).toBe("true");
  await render(false); expect(container.querySelector("[data-plugin-active]")?.getAttribute("data-plugin-active")).toBe("false");
  fixture.dir = "/third"; await render(); expect(container.querySelector("[data-plugin-active]")).toBeNull();
});
it("handles folder-picker cancellation and errors without changing preferences", async () => {
  vi.mocked(open).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("dialog unavailable"));
  await render(); await openManager(); await click("Choose folder"); expect(setPrefs).not.toHaveBeenCalled();
  await click("Choose folder"); expect(container.querySelector('[role="alert"]')?.textContent).toContain("dialog unavailable");
  expect(invoke).not.toHaveBeenCalled();
});
