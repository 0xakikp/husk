// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("../components/Modal", () => ({ Modal: ({ children, headerActions }: any) => createElement("div", null, headerActions, children) }));
vi.mock("./configSource", async (original) => ({ ...await original<typeof import("./configSource")>(), resolveK8sConfig: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("./namespaceAccess", async (original) => ({
  ...await original<typeof import("./namespaceAccess")>(),
  getContextNamespace: vi.fn(), checkNamespaceAccess: vi.fn(),
}));
vi.mock("./client", () => ({
  checkKubectl: vi.fn(), currentContext: vi.fn(), listContexts: vi.fn(), listNamespaces: vi.fn(),
  listPods: vi.fn(), listServices: vi.fn(), listIngresses: vi.fn(), listDeployments: vi.fn(),
  listReplicaSets: vi.fn(), listStatefulSets: vi.fn(), listDaemonSets: vi.fn(), listJobs: vi.fn(),
  listConfigMaps: vi.fn(), listSecrets: vi.fn(), listPersistentVolumeClaims: vi.fn(), listResourceQuotas: vi.fn(),
  k8sCached: vi.fn((_key, _ttl, load) => load()), invalidateK8sCache: vi.fn(),
}));
import * as client from "./client";
import { KubernetesView, readyReplicasMatch } from "./KubernetesView";
import { resolveK8sConfig, type K8sConfigSource } from "./configSource";
import { open } from "@tauri-apps/plugin-dialog";
import { getContextNamespace, checkNamespaceAccess } from "./namespaceAccess";

it("opens an explicit palette context in the same view using its pinned source", async () => {
  await render();
  await select("Context", "prod");
  const appSource = { ...config, fingerprint: "palette-source", paths: ["/fixtures/app-default"] };
  await act(async () => root.render(createElement(KubernetesView, {
    inline: true, onInspectResource: inspect, browseRequest: { context: "dev", config: appSource },
  })));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')?.value).toBe("dev");
  expect(client.listPods).toHaveBeenLastCalledWith("default", { context: "dev", config: appSource });
  expect(host.textContent).toContain("/fixtures/app-default");
});

it("never falls back to another cluster when a requested palette context was removed", async () => {
  await render();
  vi.mocked(client.listPods).mockClear();
  await act(async () => root.render(createElement(KubernetesView, {
    inline: true, onInspectResource: inspect, browseRequest: { context: "removed", config },
  })));
  expect(host.textContent).toContain('Context “removed” is not in App default');
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')?.value).toBe("");
  expect(client.listPods).not.toHaveBeenCalled();
});

it("does not reapply an already-handled palette request on a later browser selection", async () => {
  const browseRequest = { context: "prod", config };
  await act(async () => root.render(createElement(KubernetesView, { inline: true, onInspectResource: inspect, browseRequest })));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')?.value).toBe("prod");
  await select("Context", "dev");
  await act(async () => root.render(createElement(KubernetesView, { inline: true, onInspectResource: vi.fn(), browseRequest })));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')?.value).toBe("dev");
});

it("provides scoped reopen after closing the inspector without changing list filters", async () => {
  const lastResource = { context: "dev", config, namespace: "team-a", name: "api", kind: "pod" as const };
  await act(async () => root.render(createElement(KubernetesView, { inline: true, onInspectResource: inspect, lastResource })));
  const button = host.querySelector<HTMLButtonElement>(".k8s-last-resource")!;
  expect(button).not.toBeNull();
  await act(async () => button.click());
  expect(inspect).toHaveBeenLastCalledWith(lastResource);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')?.value).toBe("default");
  await select("Context", "prod");
  expect(host.querySelector(".k8s-last-resource")).toBeNull();
});

it("cancels pending palette navigation on manual context, namespace and source choices", async () => {
  const cancel = vi.fn();
  await act(async () => root.render(createElement(KubernetesView, {
    inline: true, onInspectResource: inspect, onBrowseSelectionChange: cancel,
  })));
  expect(cancel).not.toHaveBeenCalled(); // Initial App default discovery is not a user choice.
  await select("Context", "prod");
  expect(cancel).toHaveBeenCalledTimes(1);
  await select("Namespace", "_all");
  expect(cancel).toHaveBeenCalledTimes(2);
  await click("Reload");
  await click("Use config");
  expect(cancel).toHaveBeenCalledTimes(3);
});

const config: K8sConfigSource = { kind: "app", paths: ["/fixtures/default"], cwd: "/fixtures", fingerprint: "default-source", label: "App default", missingPaths: [] };
const scoped = (context: string) => ({ context, config });

let root: Root;
let host: HTMLDivElement;
const inspect = vi.fn();
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(resolveK8sConfig).mockResolvedValue(config);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(client.checkKubectl).mockResolvedValue(true);
  vi.mocked(client.currentContext).mockResolvedValue("dev");
  vi.mocked(client.listContexts).mockResolvedValue(["dev", "prod"]);
  vi.mocked(client.listNamespaces).mockResolvedValue(["default"]);
  vi.mocked(getContextNamespace).mockResolvedValue("default");
  vi.mocked(checkNamespaceAccess).mockResolvedValue([]);
  vi.mocked(client.listPods).mockResolvedValue([]);
  vi.mocked(client.listDeployments).mockResolvedValue([]);
  vi.mocked(client.listReplicaSets).mockResolvedValue([]);
  vi.mocked(client.listStatefulSets).mockResolvedValue([]);
  vi.mocked(client.listDaemonSets).mockResolvedValue([]);
  vi.mocked(client.listServices).mockResolvedValue([]);
  vi.mocked(client.listConfigMaps).mockResolvedValue([]);
  vi.mocked(client.listSecrets).mockResolvedValue([]);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = () => act(async () => { root.render(createElement(KubernetesView, { inline: true, onInspectResource: inspect })); });
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
};
const pod = (name: string) => ({ name, namespace: "default", ready: "1/1", status: "Running", restarts: "0", age: "1m" });
const select = async (label: string, value: string) => {
  const picker = host.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
  expect(picker, label).not.toBeNull();
  await act(async () => { picker.value = value; picker.dispatchEvent(new Event("change", { bubbles: true })); });
};
const enterNamespace = async (value: string) => {
  await click("Enter manually");
  const field = host.querySelector<HTMLInputElement>('[aria-label="Namespace name"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("Use namespace");
};

it("labels resource navigation and associates each category with its visible list", async () => {
  await render();
  const categories = host.querySelector('[role="group"][aria-label="Resource categories"]')!;
  const buttons = [...categories.querySelectorAll("button")];
  expect(buttons.map(button => button.textContent)).toEqual(["Pods", "Workloads", "Services", "Ingress", "Config", "Storage", "Jobs", "Quotas"]);
  expect(categories.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  expect(categories.querySelector('[aria-pressed="true"]')?.textContent).toBe("Pods");
  const list = host.querySelector('section[aria-label="Pods resources"]')!;
  expect(buttons.every(button => button.getAttribute("aria-controls") === list.id)).toBe(true);
  expect(list.getAttribute("aria-busy")).toBe("false");
  await click("Workloads");
  expect(categories.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1);
  expect(categories.querySelector('[aria-pressed="true"]')?.textContent).toBe("Workloads");
  expect(host.querySelector('section[aria-label="Workloads resources"]')?.id).toBe(list.id);
});

it("shows a resource count only for the loaded category, never a stale count while loading", async () => {
  vi.mocked(client.listPods).mockResolvedValue([pod("api"), pod("worker")]);
  let finishWorkloads!: (items: client.K8sDeployment[]) => void;
  vi.mocked(client.listDeployments).mockReturnValue(new Promise(resolve => { finishWorkloads = resolve; }));
  await render();
  expect(host.querySelector(".k8s-count")?.textContent).toBe("2");
  expect(host.querySelector(".k8s-count")?.getAttribute("aria-label")).toBe("2 resources");
  await click("Workloads");
  expect(host.querySelector(".k8s-count")).toBeNull();
  expect(host.querySelector('section[aria-label="Workloads resources"]')?.getAttribute("aria-busy")).toBe("true");
  await act(async () => finishWorkloads([]));
  expect(host.querySelector(".k8s-count")?.textContent).toBe("0");
  expect(host.querySelector('section[aria-label="Workloads resources"]')?.getAttribute("aria-busy")).toBe("false");
});

it("pins list reads, cache keys and resource navigation to the displayed context", async () => {
  vi.mocked(client.listPods).mockResolvedValue([pod("api")]);
  await render();
  expect(client.listPods).toHaveBeenCalledWith("default", scoped("dev"));
  expect(client.listNamespaces).toHaveBeenCalledWith(scoped("dev"));
  expect(client.k8sCached).toHaveBeenCalledWith(JSON.stringify([config.fingerprint, "dev", "default", "pods"]), 10_000, expect.any(Function));
  const resource = [...host.querySelectorAll("button")].find((item) => item.textContent?.startsWith("api"))!;
  await act(async () => resource.click());
  expect(inspect).toHaveBeenLastCalledWith({ context: "dev", config, kind: "pod", namespace: "default", name: "api" });
});

it("shows Pod controller kinds and names without changing Pod navigation or health", async () => {
  vi.mocked(client.listPods).mockResolvedValue([
    { ...pod("api"), ownership: { status: "controlled", kind: "Deployment", name: "checkout", via: "checkout-rs" } },
    { ...pod("db-0"), ownership: { status: "controlled", kind: "StatefulSet", name: "database" } },
    { ...pod("manual"), ownership: { status: "none" } },
    { ...pod("unknown"), ownership: { status: "unavailable", error: "Metadata denied" } },
  ]);
  await render();
  const rows = [...host.querySelectorAll<HTMLButtonElement>(".k8s-browse-row")];
  expect(rows.map(row => row.textContent)).toEqual([
    "apidefault · Running · 1/1 · 1mDeployment · checkout",
    "db-0default · Running · 1/1 · 1mStatefulSet · database",
    "manualdefault · Running · 1/1 · 1mNo controller",
    "unknowndefault · Running · 1/1 · 1mOwnership unavailable",
  ]);
  expect(rows[0].title).toContain("via ReplicaSet checkout-rs");
  expect(rows[3].title).toContain("Metadata denied");
  expect(rows[3].querySelector(".bg-emerald-500")).not.toBeNull();
  await act(async () => rows[0].click());
  expect(inspect).toHaveBeenLastCalledWith({ context: "dev", config, kind: "pod", namespace: "default", name: "api" });
});

it("clears inspectors on context switch and ignores an old cluster response", async () => {
  let finishOld!: (pods: client.K8sPod[]) => void;
  vi.mocked(client.listPods).mockImplementation((_ns, context) => (typeof context === "object" ? context.context : context) === "dev"
    ? new Promise(resolve => { finishOld = resolve; }) : Promise.resolve([pod("prod-api")]));
  await render();
  const contextPicker = host.querySelector<HTMLSelectElement>('[aria-label="Context"]')!;
  await act(async () => { contextPicker.value = "prod"; contextPicker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(inspect).toHaveBeenCalledWith(null);
  expect(client.listPods).toHaveBeenLastCalledWith("default", scoped("prod"));
  await act(async () => finishOld([pod("stale-dev-pod")]));
  expect(host.textContent).toContain("prod-api");
  expect(host.textContent).not.toContain("stale-dev-pod");
});

it("shows denied reads as unavailable rather than an empty resource list", async () => {
  vi.mocked(client.listPods).mockRejectedValue(new Error("Forbidden: list pods"));
  await render();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Forbidden");
  expect(host.textContent).not.toContain("No resources in this scope");
  expect(host.querySelector(".k8s-count")).toBeNull();
});

it("does not colour unready Deployments or StatefulSets healthy", async () => {
  vi.mocked(client.listDeployments).mockResolvedValue([{ name: "api", namespace: "default", ready: "0/2", desired: 2, current: 2, available: "0", upToDate: "2", age: "1m", strategy: "", selector: {} }]);
  vi.mocked(client.listStatefulSets).mockResolvedValue([{ name: "db", namespace: "default", ready: "0/1", replicas: 1, age: "1m", serviceName: "db" }]);
  await render(); await click("Workloads");
  for (const name of ["api", "db"]) {
    const row = [...host.querySelectorAll("button")].find(item => item.textContent?.startsWith(name))!;
    expect(row.querySelector(".bg-amber-500")).not.toBeNull();
  }
});

it("requires a valid complete readiness fraction", () => {
  expect(readyReplicasMatch("0/1")).toBe(false);
  expect(readyReplicasMatch("1/1")).toBe(true);
  expect(readyReplicasMatch("0/0")).toBe(true);
  expect(readyReplicasMatch("unknown")).toBe(false);
});

it("does not switch clusters when a previously selected context disappears", async () => {
  await render(); inspect.mockClear();
  vi.mocked(client.listContexts).mockResolvedValue(["prod"]);
  vi.mocked(client.currentContext).mockResolvedValue("prod");
  await click("Refresh");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')!.value).toBe("");
  expect(inspect).toHaveBeenCalledWith(null);
  expect(host.textContent).toContain("is no longer in this config");
  await click("Refresh");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Context"]')!.value).toBe("");
  expect(client.listPods).not.toHaveBeenCalledWith("default", scoped("prod"));
});

it("separates same-name contexts across config files and discards late old-source results", async () => {
  let finish!: (pods: client.K8sPod[]) => void;
  const next: K8sConfigSource = { ...config, kind: "file", paths: ["/fixture/second"], fingerprint: "second-source" };
  vi.mocked(client.listPods).mockImplementation((_ns, scope) => typeof scope === "object" && scope.config.fingerprint === config.fingerprint
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve([pod("new-source-api")]));
  await render();
  vi.mocked(open).mockResolvedValue("/fixture/second");
  vi.mocked(resolveK8sConfig).mockResolvedValue(next);
  const picker = host.querySelector<HTMLSelectElement>('[aria-label="Config source"]')!;
  await act(async () => { picker.value = "file"; picker.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(client.currentContext).toHaveBeenCalledTimes(1);
  await click("Use config");
  expect(client.listPods).toHaveBeenLastCalledWith("default", { context: "dev", config: next });
  expect(client.k8sCached).toHaveBeenCalledWith(JSON.stringify([next.fingerprint, "dev", "default", "pods"]), 10_000, expect.any(Function));
  await act(async () => finish([pod("old-source-api")]));
  expect(host.textContent).toContain("new-source-api");
  expect(host.textContent).not.toContain("old-source-api");
});

it("loads the context namespace even when cluster-wide namespace discovery is denied", async () => {
  vi.mocked(getContextNamespace).mockResolvedValue("team-a");
  vi.mocked(client.listNamespaces).mockRejectedValue(new Error('Forbidden: user cannot list resource "namespaces" at the cluster scope'));
  vi.mocked(client.listPods).mockResolvedValue([{ ...pod("team-api"), namespace: "team-a" }]);
  await render();
  expect(getContextNamespace).toHaveBeenCalledWith(scoped("dev"));
  expect(client.listPods).toHaveBeenCalledWith("team-a", scoped("dev"));
  expect(vi.mocked(client.listPods).mock.calls.every(([namespace]) => namespace === "team-a")).toBe(true);
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(host.textContent).toContain("Context default: team-a");
  expect(host.textContent).toContain("team-api");
  expect(host.textContent).toContain('Forbidden: user cannot list resource "namespaces" at the cluster scope');
  expect(host.textContent).toContain("Namespace list unavailable");
  expect(checkNamespaceAccess).not.toHaveBeenCalled();
});

it("allows entering an unlisted namespace after both discovery and default resolution fail", async () => {
  vi.mocked(getContextNamespace).mockRejectedValue(new Error("Context metadata unavailable"));
  vi.mocked(client.listNamespaces).mockRejectedValue(new Error("Forbidden: list namespaces"));
  await render();
  expect(client.listPods).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Context metadata unavailable");
  await enterNamespace("team-a");
  expect(client.listPods).toHaveBeenLastCalledWith("team-a", scoped("dev"));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(host.querySelector('[aria-label="Namespace name"]')).toBeNull();
});

it("does not query invalid manual namespace input", async () => {
  await render();
  vi.mocked(client.listPods).mockClear();
  await enterNamespace("team-a; kubectl get secrets");
  expect(host.querySelector('[aria-label="Namespace name"]')?.getAttribute("aria-invalid")).toBe("true");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("1–63 lowercase");
  expect(client.listPods).not.toHaveBeenCalled();
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("default");
});

it("does not overwrite a manually selected namespace with a delayed context default", async () => {
  let resolveDefault!: (value: string) => void;
  vi.mocked(getContextNamespace).mockReturnValue(new Promise(resolve => { resolveDefault = resolve; }));
  await render();
  expect(client.listPods).not.toHaveBeenCalled();
  await enterNamespace("team-a");
  await act(async () => resolveDefault("late-default"));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(host.textContent).toContain("Context default: late-default");
  expect(client.listPods).toHaveBeenLastCalledWith("team-a", scoped("dev"));
  expect(client.listPods).not.toHaveBeenCalledWith("late-default", expect.anything());
});

it("ignores a prior context's delayed namespace default", async () => {
  let resolveOld!: (value: string) => void;
  vi.mocked(getContextNamespace).mockImplementation(scope => (typeof scope === "object" ? scope.context : scope) === "dev"
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve("prod-team"));
  await render();
  expect(client.listPods).not.toHaveBeenCalled();
  await select("Context", "prod");
  await act(async () => resolveOld("dev-team"));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("prod-team");
  expect(host.textContent).not.toContain("Context default: dev-team");
  expect(client.listPods).toHaveBeenLastCalledWith("prod-team", scoped("prod"));
  expect(client.listPods).not.toHaveBeenCalledWith("dev-team", expect.anything());
});

it("ignores a prior config file's delayed namespace default, even for the same context", async () => {
  let resolveOld!: (value: string) => void;
  const next: K8sConfigSource = { ...config, kind: "file", paths: ["/fixtures/other"], fingerprint: "other-source" };
  vi.mocked(getContextNamespace).mockImplementation(scope => typeof scope === "object" && scope.config.fingerprint === config.fingerprint
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve("other-team"));
  await render();
  vi.mocked(open).mockResolvedValue("/fixtures/other");
  vi.mocked(resolveK8sConfig).mockResolvedValue(next);
  await select("Config source", "file");
  await click("Use config");
  await act(async () => resolveOld("old-team"));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("other-team");
  expect(host.textContent).not.toContain("Context default: old-team");
  expect(client.listPods).toHaveBeenLastCalledWith("other-team", { context: "dev", config: next });
  expect(client.listPods).not.toHaveBeenCalledWith("old-team", expect.anything());
});

it("preserves a manual namespace through tab changes and refresh without broadening the scope", async () => {
  await render();
  await enterNamespace("team-a");
  await click("Services");
  expect(client.listServices).toHaveBeenLastCalledWith("team-a", scoped("dev"));
  await click("Refresh");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  await click("Pods");
  expect(client.listPods).toHaveBeenLastCalledWith("team-a", scoped("dev"));
  expect(getContextNamespace).toHaveBeenCalledTimes(2);
  expect(vi.mocked(client.listPods).mock.calls.some(([namespace]) => namespace === "_all")).toBe(false);
});

it("ignores resource results from the previous namespace after manual selection", async () => {
  let resolveOld!: (value: client.K8sPod[]) => void;
  vi.mocked(client.listPods).mockImplementation(namespace => namespace === "default"
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([{ ...pod("team-api"), namespace: "team-a" }]));
  await render();
  await enterNamespace("team-a");
  await act(async () => resolveOld([pod("old-default-api")]));
  expect(host.textContent).toContain("team-api");
  expect(host.textContent).not.toContain("old-default-api");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(host.querySelector(".k8s-count")?.textContent).toBe("1");
});

it("queries all namespaces only after the user explicitly selects that scope", async () => {
  await render();
  expect(client.listPods).not.toHaveBeenCalledWith("_all", expect.anything());
  await select("Namespace", "_all");
  expect(client.listPods).toHaveBeenLastCalledWith("_all", scoped("dev"));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("_all");
});

it("keeps allowed ConfigMaps visible when Secret listing is denied without reporting a complete count", async () => {
  vi.mocked(client.listConfigMaps).mockResolvedValue([{ name: "public-config", namespace: "default", dataKeys: ["mode"], age: "2h" }]);
  vi.mocked(client.listSecrets).mockRejectedValue(new Error('Forbidden: cannot list resource "secrets" in namespace "default"'));
  await render(); await click("Config");
  expect(client.listConfigMaps).toHaveBeenCalledWith("default", scoped("dev"));
  expect(client.listSecrets).toHaveBeenCalledWith("default", scoped("dev"));
  expect(host.textContent).toContain("public-config");
  expect(host.textContent).toContain('secrets unavailable: Error: Forbidden: cannot list resource "secrets" in namespace "default"');
  expect(host.textContent).not.toContain("No resources in this scope");
  expect(host.querySelector(".k8s-count")).toBeNull();
  const row = [...host.querySelectorAll("button")].find(button => button.textContent?.startsWith("public-config"))!;
  await act(async () => row.click());
  expect(inspect).toHaveBeenLastCalledWith({ context: "dev", config, kind: "configmap", namespace: "default", name: "public-config" });
});

it("does not call a completely denied grouped category an empty successful list", async () => {
  vi.mocked(client.listConfigMaps).mockRejectedValue(new Error("Forbidden: configmaps"));
  vi.mocked(client.listSecrets).mockRejectedValue(new Error("Forbidden: secrets"));
  await render(); await click("Config");
  expect(host.textContent).toContain("configmaps unavailable: Error: Forbidden: configmaps");
  expect(host.textContent).toContain("secrets unavailable: Error: Forbidden: secrets");
  expect(host.textContent).not.toContain("No resources in this scope");
  expect(host.querySelector(".k8s-count")).toBeNull();
});

it("checks only the selected category and namespace, and clears access results when selection changes", async () => {
  vi.mocked(checkNamespaceAccess).mockResolvedValue([{ resource: "pods", allowed: false }]);
  await render();
  expect(checkNamespaceAccess).not.toHaveBeenCalled();
  await click("Check access");
  expect(checkNamespaceAccess).toHaveBeenCalledWith("default", ["pods"], scoped("dev"));
  expect(host.querySelector('[aria-label="Access check results"]')?.textContent).toContain("Not allowed");
  expect(host.textContent).toContain("Cluster-wide administrator access is not required");
  await enterNamespace("team-a");
  expect(host.querySelector('[aria-label="Access check results"]')).toBeNull();
  await click("Config"); await click("Check access");
  expect(checkNamespaceAccess).toHaveBeenLastCalledWith("team-a", ["configmaps", "secrets"], scoped("dev"));
});

it("retries a failed local namespace lookup on refresh without falling back to all namespaces", async () => {
  vi.mocked(getContextNamespace).mockRejectedValueOnce(new Error("Config temporarily unavailable")).mockResolvedValue("team-a");
  await render();
  expect(host.textContent).toContain("Config temporarily unavailable");
  expect(client.listPods).not.toHaveBeenCalled();
  await click("Refresh");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("team-a");
  expect(client.listPods).toHaveBeenCalledExactlyOnceWith("team-a", scoped("dev"));
  expect(host.textContent).not.toContain("Context namespace unavailable");
});

it("refreshes default metadata without replacing an explicit all-namespaces choice", async () => {
  await render(); await select("Namespace", "_all");
  vi.mocked(getContextNamespace).mockResolvedValue("changed-default");
  await click("Refresh");
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Namespace"]')!.value).toBe("_all");
  expect(host.textContent).toContain("Context default: changed-default");
  expect(client.listPods).not.toHaveBeenCalledWith("changed-default", expect.anything());
});

it("explains namespace discovery denial separately from allowed scoped resource access", async () => {
  vi.mocked(client.listNamespaces).mockRejectedValue(new Error("Forbidden: list namespaces"));
  vi.mocked(getContextNamespace).mockResolvedValue("team-a");
  vi.mocked(checkNamespaceAccess).mockResolvedValue([{ resource: "pods", allowed: true }, { resource: "namespaces", allowed: false }]);
  await render(); await click("Check access");
  expect(checkNamespaceAccess).toHaveBeenCalledWith("team-a", ["pods", "namespaces"], scoped("dev"));
  expect(host.textContent).toContain("list namespaces (cluster-wide)");
  expect(host.textContent).toContain("Namespace discovery is optional");
  expect(host.textContent).not.toContain("ask your administrator");
});

it("keeps readable workload kinds visible when a different kind is denied", async () => {
  vi.mocked(client.listDeployments).mockRejectedValue(new Error("Forbidden: deployments"));
  vi.mocked(client.listStatefulSets).mockResolvedValue([{ name: "database", namespace: "default", ready: "1/1", replicas: 1, age: "1m", serviceName: "database" }]);
  await render(); await click("Workloads");
  expect(host.textContent).toContain("database");
  expect(host.textContent).toContain("deployments.apps unavailable: Error: Forbidden: deployments");
  expect(host.textContent).toContain("Partial results");
  expect(host.querySelector(".k8s-count")).toBeNull();
});
