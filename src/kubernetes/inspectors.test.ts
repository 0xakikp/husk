// @vitest-environment happy-dom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("./client", async (original) => ({
  ...await original<typeof import("./client")>(),
  describePod: vi.fn(), getServicesForPod: vi.fn(), getNodeInfo: vi.fn(), getPodUsage: vi.fn(), getPodLogs: vi.fn(),
  describeSecret: vi.fn(), getSecretYaml: vi.fn(), describeWorkload: vi.fn(), describeService: vi.fn(),
}));
import * as client from "./client";
import { PodDetailPanel } from "./PodDetailPanel";
import { SecretDetailPanel } from "./ConfigAndStoragePanels";
import { WorkloadDetailPanel } from "./WorkloadDetailPanel";
import { ServiceDetailPanel } from "./ServiceDetailPanel";
import { K8sInspectorProvider } from "./K8sInspectorContext";
import type { K8sResourceSelection } from "./KubernetesView";
import type { K8sConfigSource } from "./configSource";

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
const selection: K8sResourceSelection = { context: "dev", kind: "pod", namespace: "team", name: "web" };
const configA: K8sConfigSource = { kind: "file", paths: ["/fixtures/cluster-a.yaml"], cwd: "/fixtures", fingerprint: "config-a", label: "Selected file", missingPaths: [] };
const configB: K8sConfigSource = { ...configA, paths: ["/fixtures/cluster-b.yaml"], fingerprint: "config-b" };
const configSelection = (config: K8sConfigSource, kind: K8sResourceSelection["kind"] = "pod"): K8sResourceSelection => ({ ...selection, config, kind });
const configScope = (config: K8sConfigSource) => ({ context: selection.context, config });
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};
const pod = (name = "web"): client.K8sPodDetail => ({
  namespace: "team", name, createdAt: "2026-01-01T12:00:00Z", labels: { app: name }, annotations: {}, node: "",
  ip: "10.0.0.1", hostIp: "", qosClass: "Burstable", serviceAccount: "default", restartPolicy: "Always", phase: "Running",
  conditions: [{ type: "Ready", status: "False" }], ownerReferences: [{ kind: "ReplicaSet", name: `${name}-rs` }],
  containers: [{ name: "app", image: `${name}:v1`, state: "waiting", reason: "CrashLoopBackOff", ready: false, restartCount: 2,
    lastTermination: { reason: "Error", exitCode: 1, finishedAt: "2026-01-01T12:00:00Z" } }],
  initContainers: [{ name: "setup", image: "setup:v1", state: "terminated", ready: false, restartCount: 0, exitCode: 0 }],
  volumes: [], events: [], resources: [], yaml: `name: ${name}`,
});
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.mocked(client.describePod).mockResolvedValue(pod());
  vi.mocked(client.getServicesForPod).mockResolvedValue([]);
  vi.mocked(client.getPodUsage).mockResolvedValue(null);
  vi.mocked(client.getPodLogs).mockResolvedValue("normal startup\nfatal: configuration missing");
  vi.mocked(client.describeSecret).mockResolvedValue({ secret: { name: "web", namespace: "team", type: "Opaque", dataKeys: ["password"], age: "1d" }, keys: ["password"], yaml: "password: [REDACTED]" });
  vi.mocked(client.getSecretYaml).mockResolvedValue("password: sensitive-value");
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
const render = async (Panel: ComponentType<any>, scope = selection, extra: Record<string, unknown> = {}) => {
  await act(async () => root.render(createElement(K8sInspectorProvider, { selection: scope, onNavigate: navigate,
    children: createElement(Panel, { name: scope.name, namespace: scope.namespace, onClose: () => {}, ...extra }) })));
};
const click = async (label: string) => {
  const button = [...host.querySelectorAll("button")].find((item) => item.textContent === label || item.getAttribute("aria-label") === label);
  expect(button, label).toBeDefined(); await act(async () => button!.click());
};
const select = async (label: string, value: string) => {
  const element = host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
  await act(async () => { element.value = value; element.dispatchEvent(new Event("change", { bubbles: true })); });
};

it("ignores a late Pod response after switching identity and context", async () => {
  const old = deferred<client.K8sPodDetail>();
  vi.mocked(client.describePod).mockImplementation((_ns, name) => name === "web" ? old.promise : Promise.resolve(pod("other")));
  await render(PodDetailPanel);
  await render(PodDetailPanel, { ...selection, context: "prod", name: "other" });
  await act(async () => old.resolve(pod("web")));
  await click("Containers");
  expect(host.textContent).toContain("other:v1");
  expect(host.textContent).not.toContain("web:v1");
  expect(client.getServicesForPod).toHaveBeenCalledWith("team", { app: "other" }, "prod");
  expect(client.getServicesForPod).not.toHaveBeenCalledWith("team", { app: "web" }, "dev");
});

it("opens previous-container logs directly from a crash finding", async () => {
  await render(PodDetailPanel); await click("Next check");
  expect(client.getPodLogs).toHaveBeenLastCalledWith("team", "web", "app", 200, { context: "dev", previous: true, timestamps: true });
  expect(host.textContent).toContain("fatal: configuration missing");
  expect(host.querySelectorAll("summary")).toHaveLength(1);
  expect(host.textContent).toContain("Restart & event timeline");
});

it("does not mix delayed current logs into the previous-container view", async () => {
  const old = deferred<string>();
  vi.mocked(client.getPodLogs).mockImplementation((_ns, _name, _container, _tail, options) => options?.previous ? Promise.resolve("previous crash") : old.promise);
  await render(PodDetailPanel); await click("Logs"); await select("Container log instance", "previous");
  await act(async () => old.resolve("stale current logs"));
  expect(host.querySelector("pre")?.textContent).toBe("previous crash");
  expect(host.textContent).not.toContain("stale current logs");
});

it("selects init-container logs and shows denied previous logs as unavailable", async () => {
  await render(PodDetailPanel); await click("Logs"); await select("Log container", "setup");
  expect(client.getPodLogs).toHaveBeenLastCalledWith("team", "web", "setup", 200, expect.objectContaining({ previous: false, context: "dev" }));
  vi.mocked(client.getPodLogs).mockRejectedValue(new Error("Forbidden: pods/log"));
  await select("Container log instance", "previous");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Previous-container logs unavailable: Forbidden");
});

it("filters loaded log lines without fetching again and toggles timestamps explicitly", async () => {
  await render(PodDetailPanel); await click("Logs");
  const before = vi.mocked(client.getPodLogs).mock.calls.length;
  const search = host.querySelector('[aria-label="Search loaded logs"]') as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "fatal");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector("pre")?.textContent).toBe("fatal: configuration missing");
  expect(client.getPodLogs).toHaveBeenCalledTimes(before);
  const timestamps = [...host.querySelectorAll("label")].find(label => label.textContent === "Timestamps")!.querySelector("input")!;
  await act(async () => timestamps.click());
  expect(client.getPodLogs).toHaveBeenLastCalledWith("team", "web", "app", 200, expect.objectContaining({ timestamps: false }));
});

it("never fetches Secret YAML until explicit reveal, and hides it when leaving the tab", async () => {
  await render(SecretDetailPanel, { ...selection, kind: "secret" }); await click("YAML");
  expect(client.getSecretYaml).not.toHaveBeenCalled();
  expect(host.querySelector("pre")?.textContent).toContain("[REDACTED]");
  await click("Reveal sensitive YAML");
  expect(client.getSecretYaml).toHaveBeenCalledWith("team", "web", "dev");
  expect(host.querySelector("pre")?.textContent).toContain("sensitive-value");
  await click("Overview"); await click("YAML");
  expect(host.querySelector("pre")?.textContent).not.toContain("sensitive-value");
  expect(client.getSecretYaml).toHaveBeenCalledTimes(1);
});

it("reopening a closed Secret fetches fresh metadata and requires a new reveal", async () => {
  const resource = configSelection(configA, "secret");
  await render(SecretDetailPanel, resource);
  await click("YAML");
  await click("Reveal sensitive YAML");
  expect(host.textContent).toContain("sensitive-value");
  await act(async () => root.render(null));
  await render(SecretDetailPanel, resource);
  expect(client.describeSecret).toHaveBeenCalledTimes(2);
  expect(client.describeSecret).toHaveBeenLastCalledWith("team", "web", configScope(configA));
  await click("YAML");
  expect(host.textContent).not.toContain("sensitive-value");
  expect(client.getSecretYaml).toHaveBeenCalledTimes(1);
  expect(host.textContent).toContain("Reveal sensitive YAML");
});

it("cancels an in-flight reveal and prevents sensitive data from reappearing", async () => {
  const raw = deferred<string>(); vi.mocked(client.getSecretYaml).mockReturnValue(raw.promise);
  await render(SecretDetailPanel, { ...selection, kind: "secret" }); await click("YAML");
  await click("Reveal sensitive YAML"); await click("Cancel reveal");
  await act(async () => raw.resolve("secret-that-must-stay-hidden"));
  expect(host.textContent).not.toContain("secret-that-must-stay-hidden");
  expect(host.querySelector("pre")?.textContent).toContain("[REDACTED]");
});

it("does not keep a revealed Secret across cluster changes", async () => {
  await render(SecretDetailPanel, { ...selection, kind: "secret" }); await click("YAML"); await click("Reveal sensitive YAML");
  await render(SecretDetailPanel, { ...selection, context: "prod", kind: "secret" });
  expect(client.describeSecret).toHaveBeenLastCalledWith("team", "web", "prod");
  expect(host.querySelector("pre")?.textContent).not.toContain("sensitive-value");
});

it("refreshes non-Pod details without retaining revealed Secret contents", async () => {
  await render(SecretDetailPanel, { ...selection, kind: "secret" }); await click("YAML"); await click("Reveal sensitive YAML");
  await click("Refresh details");
  expect(client.describeSecret).toHaveBeenCalledTimes(2);
  expect(host.querySelector("pre")?.textContent).toContain("[REDACTED]");
  expect(host.textContent).not.toContain("sensitive-value");
});

it("renders real workload readiness, conditions and scoped Pod navigation", async () => {
  vi.mocked(client.describeWorkload).mockResolvedValue({ workload: { kind: "statefulset", name: "web", namespace: "team", ready: 0, desired: 1, current: 1, updated: 1, available: 0, selector: { app: "web" }, selectorText: "app=web", ownerReferences: [], conditions: [], strategy: "RollingUpdate", serviceName: "web-headless", age: "1d" }, pods: [{ name: "web-0", namespace: "team", ready: "0/1", status: "Pending", restarts: "0", age: "1m" }], yaml: "kind: StatefulSet" });
  await render(WorkloadDetailPanel, { ...selection, kind: "statefulset" }, { kind: "statefulset" });
  expect(host.textContent).toContain("StatefulSet is not fully ready");
  await click("Pods"); await click("web-0");
  expect(navigate).toHaveBeenCalledWith({ ...selection, kind: "pod", name: "web-0" });
});

it("does not diagnose absent Service endpoints when endpoint access is denied", async () => {
  vi.mocked(client.describeService).mockResolvedValue({ service: { namespace: "team", name: "web", selector: { app: "web" }, type: "ClusterIP", clusterIp: "10.0.0.1", externalIp: "", ports: "80/TCP → 8080", age: "1d" }, selectorText: "app=web", pods: [], podsError: "Forbidden", endpoints: [], endpointSlices: [], endpointSlicesError: "Forbidden", yaml: "kind: Service" });
  await render(ServiceDetailPanel, { ...selection, kind: "service" });
  expect(host.textContent).toContain("Unable to check EndpointSlices: Forbidden");
  expect(host.textContent).not.toContain("No Service endpoints found");
  expect(host.textContent).not.toContain("Selector matches no Pods");
});

it("ignores old Pod evidence when only the kubeconfig source changes", async () => {
  const old = deferred<client.K8sPodDetail>();
  vi.mocked(client.describePod).mockImplementation((_namespace, _name, scope) =>
    typeof scope === "object" && scope.config.fingerprint === configA.fingerprint
      ? old.promise : Promise.resolve({ ...pod(), containers: [{ ...pod().containers[0], image: "cluster-b-only:v2" }] }));
  await render(PodDetailPanel, configSelection(configA));
  await render(PodDetailPanel, configSelection(configB));
  await act(async () => old.resolve({ ...pod(), containers: [{ ...pod().containers[0], image: "stale-cluster-a:v1" }] }));
  await click("Containers");
  expect(host.textContent).toContain("cluster-b-only:v2");
  expect(host.textContent).not.toContain("stale-cluster-a:v1");
  expect(client.describePod).toHaveBeenLastCalledWith("team", "web", configScope(configB));
  expect(client.getServicesForPod).toHaveBeenCalledWith("team", { app: "web" }, configScope(configB));
  expect(client.getServicesForPod).not.toHaveBeenCalledWith("team", { app: "web" }, configScope(configA));
});

it("retains the source for supplemental reads, logs, refresh and related navigation", async () => {
  vi.mocked(client.describePod).mockResolvedValue({ ...pod(), node: "worker" });
  vi.mocked(client.getNodeInfo).mockResolvedValue({
    name: "worker", status: "Ready", roles: "worker", age: "1d", version: "v1.30", internalIp: "10.0.0.2", externalIp: "",
    osImage: "Linux", kernelVersion: "6", containerRuntime: "containerd", architecture: "amd64", topCpu: "10m", topMem: "1Gi",
    capacity: { cpu: "4", memory: "8Gi", pods: "100" }, allocatable: { cpu: "4", memory: "7Gi", pods: "100" },
  });
  await render(PodDetailPanel, configSelection(configA));
  expect(client.getServicesForPod).toHaveBeenLastCalledWith("team", { app: "web" }, configScope(configA));
  expect(client.getPodUsage).toHaveBeenLastCalledWith("team", "web", configScope(configA));
  expect(client.getNodeInfo).toHaveBeenLastCalledWith("worker", configScope(configA));
  const owner = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("ReplicaSet · web-rs"))!;
  expect(owner).toBeDefined();
  await act(async () => owner.click());
  expect(navigate).toHaveBeenLastCalledWith({ ...configSelection(configA), kind: "replicaset", name: "web-rs" });
  await click("Logs");
  expect(client.getPodLogs).toHaveBeenLastCalledWith("team", "web", "app", 200, expect.objectContaining({ context: configScope(configA) }));
  await click("Refresh");
  expect(client.describePod).toHaveBeenLastCalledWith("team", "web", configScope(configA));
  expect(client.getNodeInfo).toHaveBeenLastCalledWith("worker", configScope(configA));
});

it("rejects late logs from another config with the same context, Pod and container names", async () => {
  const old = deferred<string>();
  vi.mocked(client.getPodLogs).mockImplementation((_namespace, _name, _container, _tail, options) =>
    typeof options?.context === "object" && options.context.config.fingerprint === configA.fingerprint
      ? old.promise : Promise.resolve("cluster-b log evidence"));
  await render(PodDetailPanel, configSelection(configA));
  await click("Logs");
  await render(PodDetailPanel, configSelection(configB));
  await act(async () => old.resolve("stale cluster-a logs"));
  expect(host.querySelector("pre")?.textContent).toBe("cluster-b log evidence");
  expect(host.textContent).not.toContain("stale cluster-a logs");
  expect(client.getPodLogs).toHaveBeenLastCalledWith("team", "web", "app", 200, expect.objectContaining({ context: configScope(configB) }));
});

it("clears revealed Secret data on a config-only change and requires a new scoped reveal", async () => {
  await render(SecretDetailPanel, configSelection(configA, "secret"));
  await click("YAML"); await click("Reveal sensitive YAML");
  expect(client.getSecretYaml).toHaveBeenLastCalledWith("team", "web", configScope(configA));
  expect(host.querySelector("pre")?.textContent).toContain("sensitive-value");
  await render(SecretDetailPanel, configSelection(configB, "secret"));
  expect(client.describeSecret).toHaveBeenLastCalledWith("team", "web", configScope(configB));
  expect(host.querySelector("pre")?.textContent).toContain("[REDACTED]");
  expect(host.textContent).not.toContain("sensitive-value");
  expect(client.getSecretYaml).toHaveBeenCalledTimes(1);
  await click("Reveal sensitive YAML");
  expect(client.getSecretYaml).toHaveBeenLastCalledWith("team", "web", configScope(configB));
});

it("discards a pending Secret reveal when a different file has the same context and Secret name", async () => {
  const old = deferred<string>();
  vi.mocked(client.getSecretYaml).mockReturnValueOnce(old.promise);
  await render(SecretDetailPanel, configSelection(configA, "secret"));
  await click("YAML"); await click("Reveal sensitive YAML");
  await render(SecretDetailPanel, configSelection(configB, "secret"));
  await act(async () => old.resolve("must-not-leak-from-cluster-a"));
  expect(host.textContent).not.toContain("must-not-leak-from-cluster-a");
  expect(host.querySelector("pre")?.textContent).toContain("[REDACTED]");
  expect(client.getSecretYaml).toHaveBeenCalledTimes(1);
  expect(client.getSecretYaml).toHaveBeenLastCalledWith("team", "web", configScope(configA));
});

it("ignores late generic detail responses when only the config fingerprint changes", async () => {
  const old = deferred<Awaited<ReturnType<typeof client.describeSecret>>>();
  const secret = (key: string) => ({ secret: { name: "web", namespace: "team", type: "Opaque", dataKeys: [key], age: "1d" }, keys: [key], yaml: `${key}: [REDACTED]` });
  vi.mocked(client.describeSecret).mockImplementation((_namespace, _name, scope) =>
    typeof scope === "object" && scope.config.fingerprint === configA.fingerprint ? old.promise : Promise.resolve(secret("cluster-b-key")));
  await render(SecretDetailPanel, configSelection(configA, "secret"));
  await render(SecretDetailPanel, configSelection(configB, "secret"));
  await act(async () => old.resolve(secret("stale-cluster-a-key")));
  expect(host.textContent).toContain("cluster-b-key");
  expect(host.textContent).not.toContain("stale-cluster-a-key");
  expect(client.describeSecret).toHaveBeenLastCalledWith("team", "web", configScope(configB));
});
