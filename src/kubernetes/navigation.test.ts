// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("./configSource", async original => ({ ...await original<typeof import("./configSource")>(), resolveK8sConfig: vi.fn() }));
import { resolveK8sConfig, type K8sConfigSource } from "./configSource";
import { resourceIdentity, useK8sNavigation } from "./useK8sNavigation";
import { K8sLastResource } from "./K8sLastResource";
import type { K8sResourceSelection } from "./KubernetesView";

const config: K8sConfigSource = { kind: "file", paths: ["/fixtures/cluster"], cwd: "/fixtures", fingerprint: "cluster", label: "Kubeconfig file", missingPaths: [] };
const resource: K8sResourceSelection = { kind: "secret", name: "credentials", namespace: "team-a", context: "dev", config };
let root: Root;
let host: HTMLDivElement;
let navigation: ReturnType<typeof useK8sNavigation>;
const reopen = vi.fn();
function Harness() { navigation = useK8sNavigation(); return null; }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

it("keeps only the last resource identity after closing/replacing an inspector", async () => {
  await act(async () => root.render(createElement(Harness)));
  await act(async () => navigation.selectResource(resource));
  await act(async () => navigation.selectResource(null));
  expect(navigation.selectedResource).toBeNull();
  expect(navigation.lastResource).toEqual(resource);
  const owner = { ...resource, kind: "deployment" as const, name: "api" };
  await act(async () => navigation.selectResource(owner));
  await act(async () => navigation.selectResource(null));
  expect(navigation.lastResource).toEqual(owner);
  await act(async () => navigation.selectResource(navigation.lastResource));
  expect(navigation.selectedResource).toEqual(owner);
});

it("does not retain resource contents, arbitrary config fields, or aliases to path arrays", () => {
  const unsafe = { ...resource, data: { password: "do-not-retain" }, revealed: true,
    config: { ...config, token: "do-not-retain", paths: [...config.paths] } };
  const identity = resourceIdentity(unsafe);
  unsafe.config.paths.push("/unrelated");
  expect(identity).toEqual(resource);
  expect(JSON.stringify(identity)).not.toContain("do-not-retain");
  expect(identity.config?.paths).toEqual(["/fixtures/cluster"]);
});

it("resets navigation on remount instead of persisting identities or data to storage", async () => {
  const storage = vi.spyOn(Storage.prototype, "setItem");
  await act(async () => root.render(createElement(Harness, { key: "first" })));
  await act(async () => navigation.selectResource(resource));
  await act(async () => root.render(createElement(Harness, { key: "second" })));
  expect(navigation.lastResource).toBeNull();
  expect(navigation.selectedResource).toBeNull();
  expect(storage).not.toHaveBeenCalled();
  storage.mockRestore();
});

it("pins explicit palette contexts to App default without a use-context mutation", async () => {
  const appConfig = { ...config, kind: "app" as const };
  vi.mocked(resolveK8sConfig).mockResolvedValue(appConfig);
  await act(async () => root.render(createElement(Harness)));
  await act(async () => expect(navigation.browseContext("production")).resolves.toBe(true));
  expect(resolveK8sConfig).toHaveBeenCalledWith({ kind: "app" });
  expect(navigation.browseRequest).toEqual({ context: "production", config: appConfig });
});

it("ignores older palette-context requests that resolve late", async () => {
  let finish!: (value: K8sConfigSource) => void;
  vi.mocked(resolveK8sConfig).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValueOnce(config);
  await act(async () => root.render(createElement(Harness)));
  const old = navigation.browseContext("old");
  await act(async () => { await navigation.browseContext("new"); });
  await act(async () => { finish(config); expect(await old).toBe(false); });
  expect(navigation.browseRequest?.context).toBe("new");
});

it("keeps the current browser request unchanged when source resolution fails", async () => {
  vi.mocked(resolveK8sConfig).mockRejectedValue(new Error("Config unavailable"));
  await act(async () => root.render(createElement(Harness)));
  await act(async () => expect(navigation.browseContext("prod")).rejects.toThrow("Config unavailable"));
  expect(navigation.browseRequest).toBeNull();
});

it("lets a later manual browser choice cancel a pending palette context", async () => {
  let finish!: (value: K8sConfigSource) => void;
  vi.mocked(resolveK8sConfig).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => root.render(createElement(Harness)));
  const pending = navigation.browseContext("prod");
  navigation.cancelBrowseRequest();
  await act(async () => { finish(config); expect(await pending).toBe(false); });
  expect(navigation.browseRequest).toBeNull();
});

it("offers an explicit scoped reopen with the exact stored identity", async () => {
  await act(async () => root.render(createElement(K8sLastResource, { resource, selected: null, config, context: "dev", onReopen: reopen })));
  const button = host.querySelector("button")!;
  expect(button.textContent).toContain("Reopen last resource");
  expect(button.textContent).toContain("secret · credentials · team-a");
  expect(button.title).toContain("dev · team-a · /fixtures/cluster");
  expect(reopen).not.toHaveBeenCalled();
  await act(async () => button.click());
  expect(reopen).toHaveBeenCalledWith(resource);
});

it("hides reopen while inspecting or browsing a different source/context", async () => {
  for (const props of [
    { selected: resource, config, context: "dev" },
    { selected: null, config: { ...config, fingerprint: "other" }, context: "dev" },
    { selected: null, config, context: "prod" },
  ]) {
    await act(async () => root.render(createElement(K8sLastResource, { resource, ...props, onReopen: reopen })));
    expect(host.querySelector("button")).toBeNull();
  }
  expect(reopen).not.toHaveBeenCalled();
});

it("routes both palette entry points to the sidebar and removes the duplicate dialog", () => {
  const app = readFileSync("src/App.tsx", "utf8");
  const dialogs = readFileSync("src/shell/DialogHost.tsx", "utf8");
  expect(app).toMatch(/id: "k8s", label: "Open Kubernetes", run: \(\) => showSidebarView\("kubernetes"\)/);
  expect(app).toContain('openK8s: () => showSidebarView("kubernetes")');
  expect(app).not.toContain("k8sUseContext");
  expect(dialogs).not.toContain("KubernetesView");
});
