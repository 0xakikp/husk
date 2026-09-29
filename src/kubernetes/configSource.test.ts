// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./configSource", async (original) => ({ ...await original<typeof import("./configSource")>(), resolveK8sConfig: vi.fn() }));
vi.mock("../terminal/registry", () => ({ getActiveTerminalKubeconfigSnapshot: vi.fn() }));
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveTerminalKubeconfigSnapshot } from "../terminal/registry";
import { resolveK8sConfig, configEnvironment, type K8sConfigSource } from "./configSource";
import { K8sConfigSourcePicker } from "./K8sConfigSourcePicker";

const config: K8sConfigSource = { kind: "app", paths: ["/fixture/default"], cwd: "/fixture", fingerprint: "app", label: "App default", missingPaths: [] };
const fileConfig: K8sConfigSource = { ...config, kind: "file", paths: ["/fixture/team config"], fingerprint: "file" };
let root: Root;
let host: HTMLDivElement;
const change = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.resetAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(resolveK8sConfig).mockResolvedValue(config);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = (source: K8sConfigSource | null = config) => act(async () => root.render(createElement(K8sConfigSourcePicker, { source, onChange: change })));
const choose = (kind: string) => act(async () => {
  const select = host.querySelector("select")!;
  select.value = kind; select.dispatchEvent(new Event("change", { bubbles: true }));
});
const click = (label: string) => act(async () => {
  const button = [...host.querySelectorAll("button")].find(item => item.textContent === label);
  expect(button).toBeDefined(); button!.click();
});

it("initializes app default once and displays the full selected path", async () => {
  await render(null);
  expect(resolveK8sConfig).toHaveBeenCalledExactlyOnceWith({ kind: "app" });
  expect(change).toHaveBeenCalledExactlyOnceWith(config);
  await render(config);
  expect(host.textContent).toContain("/fixture/default");
  expect(host.querySelector("select")!.disabled).toBe(false);
});

it("does not change source when file selection is cancelled", async () => {
  vi.mocked(open).mockResolvedValue(null);
  await render(); await choose("file");
  expect(resolveK8sConfig).not.toHaveBeenCalled();
  expect(change).not.toHaveBeenCalled();
  expect(host.textContent).toContain("/fixture/default");
  expect(host.querySelector("select")!.disabled).toBe(false);
});

it("requires an explicit trust confirmation and allows discarding a file preview", async () => {
  vi.mocked(open).mockResolvedValue("/fixture/team config");
  vi.mocked(resolveK8sConfig).mockResolvedValue(fileConfig);
  await render(); await choose("file");
  expect(resolveK8sConfig).toHaveBeenCalledExactlyOnceWith({ kind: "file", path: "/fixture/team config" });
  expect(change).not.toHaveBeenCalled();
  expect(host.textContent).toContain("authentication plugins can run local programs");
  await click("Cancel"); expect(change).not.toHaveBeenCalled();
  await choose("file"); await click("Use config");
  expect(change).toHaveBeenCalledExactlyOnceWith(fileConfig);
});

it.each(["./team.yaml:/fixture/other.yaml", null])("captures a terminal explicitly and never follows later terminal changes: %s", async (value) => {
  const terminal = { ...fileConfig, kind: "terminal" as const };
  vi.mocked(resolveK8sConfig).mockResolvedValue(terminal);
  vi.mocked(getActiveTerminalKubeconfigSnapshot).mockReturnValue({ available: true, leafId: 4, ptyId: 8, cwd: "/fixture/terminal", kubeconfig: value, defaultKubeconfigPath: value ? null : "/different/home/.kube/config", capturedAt: 1 });
  await render(); await choose("terminal");
  expect(resolveK8sConfig).toHaveBeenCalledWith({ kind: "terminal", kubeconfig: value ?? "/different/home/.kube/config", cwd: "/fixture/terminal" });
  expect(change).not.toHaveBeenCalled(); await click("Use config");
  expect(change).toHaveBeenCalledWith(terminal);
  vi.mocked(getActiveTerminalKubeconfigSnapshot).mockReturnValue({ available: false, reason: "Different active terminal" });
  await render(terminal); await render(terminal);
  expect(getActiveTerminalKubeconfigSnapshot).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Capture again");
});

it("keeps the source when terminal metadata is unavailable", async () => {
  vi.mocked(getActiveTerminalKubeconfigSnapshot).mockReturnValue({ available: false, reason: "SSH terminals are not supported." });
  await render(); await choose("terminal");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("SSH terminals are not supported. Current source is unchanged.");
  expect(resolveK8sConfig).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
});

it("fails closed instead of using app home for an incomplete terminal snapshot", async () => {
  vi.mocked(getActiveTerminalKubeconfigSnapshot).mockReturnValue({ available: true, leafId: 4, ptyId: 8, cwd: "/fixture/terminal", kubeconfig: null, defaultKubeconfigPath: null, capturedAt: 1 });
  await render(); await choose("terminal");
  expect(resolveK8sConfig).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("has not reported its config path");
});

it("ignores an old resolution after the source changes", async () => {
  let finish!: (value: K8sConfigSource) => void;
  vi.mocked(open).mockResolvedValue("/fixture/old");
  vi.mocked(resolveK8sConfig).mockReturnValue(new Promise(resolve => { finish = resolve; }));
  await render(); await choose("file"); await render(fileConfig);
  await act(async () => finish({ ...fileConfig, paths: ["/fixture/old"] }));
  expect(host.querySelector(".k8s-config-preview")).toBeNull();
  expect(host.textContent).not.toContain("/fixture/old"); expect(change).not.toHaveBeenCalled();
});

it("uses the selected source's platform separator in copyable command examples", () => {
  const quote = (value: string) => `'${value}'`;
  expect(configEnvironment({ ...config, paths: ["a", "b"], pathSeparator: ";" }, quote)).toBe("KUBECONFIG='a;b' ");
  expect(configEnvironment(undefined, quote)).toBe("");
});
