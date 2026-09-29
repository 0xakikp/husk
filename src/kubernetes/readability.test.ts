// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("./client", async (original) => ({
  ...await original<typeof import("./client")>(),
  describePod: vi.fn(), getServicesForPod: vi.fn(), getNodeInfo: vi.fn(), getPodUsage: vi.fn(), getPodLogs: vi.fn(),
}));

import { CheckWarnings, ConceptHelp, KVGrid, RelationshipLinks, ResourceList, YamlView } from "./K8sDetailCommon";
import { K8sInspectorProvider } from "./K8sInspectorContext";
import { PodDetailPanel } from "./PodDetailPanel";
import type { K8sResourceSelection } from "./KubernetesView";
import * as client from "./client";

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
const selection: K8sResourceSelection = {
  context: "production-europe-platform-cluster",
  kind: "deployment",
  namespace: "customer-facing-applications",
  name: "customer-account-notifications-worker",
};
const readyPod = (): client.K8sPodDetail => ({
  namespace: selection.namespace, name: selection.name, createdAt: "2026-01-01T12:00:00Z", labels: {}, annotations: {}, node: "",
  ip: "10.0.0.1", hostIp: "", qosClass: "Burstable", serviceAccount: "default", restartPolicy: "Always", phase: "Running",
  conditions: [{ type: "Ready", status: "True" }, { type: "ContainersReady", status: "True" }], ownerReferences: [],
  containers: [{ name: "worker", image: "worker:v1", state: "running", ready: true, restartCount: 0 }],
  initContainers: [], volumes: [], events: [], resources: [], yaml: "kind: Pod",
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(client.describePod).mockResolvedValue(readyPod());
  vi.mocked(client.getServicesForPod).mockResolvedValue([]);
  vi.mocked(client.getPodUsage).mockResolvedValue(null);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

async function render(children: ReactNode) {
  await act(async () => root.render(createElement(K8sInspectorProvider, {
    selection,
    onNavigate: navigate,
    children,
  })));
}

it("keeps complete diagnostic facts in semantic label/value pairs without truncation", async () => {
  const rows = [
    { label: "Service Account", value: "customer-notification-worker-production-europe-west-service-account" },
    { label: "Node", value: "ip-10-25-100-200.eu-west-1.compute.internal" },
    { label: "Container Runtime", value: "containerd://2.1.3-build-with-a-long-runtime-identifier" },
  ];
  await render(createElement(KVGrid, { rows }));

  const list = host.querySelector("dl");
  expect(list).not.toBeNull();
  expect(list!.querySelectorAll("dt")).toHaveLength(rows.length);
  expect(list!.querySelectorAll("dd")).toHaveLength(rows.length);
  rows.forEach((row, index) => {
    const group = list!.children[index];
    const label = group.querySelector("dt");
    const value = group.querySelector("dd");
    expect(label?.textContent).toBe(row.label);
    expect(value?.textContent).toBe(row.value);
    expect(value?.getAttribute("title")).toBe(row.value);
    for (const element of [group, label!, value!]) {
      expect(element.className).not.toMatch(/\b(?:truncate|text-ellipsis|line-clamp-\d+)\b/);
    }
  });
});

it("preserves zero values and marks missing facts without removing their labels", async () => {
  await render(createElement(KVGrid, { rows: [
    { label: "Restarts", value: "0" },
    { label: "External IP", value: "" },
  ] }));
  expect([...host.querySelectorAll("dt")].map((label) => label.textContent)).toEqual(["Restarts", "External IP"]);
  expect([...host.querySelectorAll("dd")].map((value) => value.textContent)).toEqual(["0", "-"]);
});

it("keeps the full related resource name and navigates within the inspected scope", async () => {
  const name = "customer-account-notifications-worker-rollout-7d989a869b";
  await render(createElement(RelationshipLinks, {
    items: [{ kind: "ReplicaSet", name, label: `ReplicaSet · ${name}` }],
  }));
  const button = host.querySelector("button")!;
  expect(button.textContent).toContain(name);
  expect(button.title).toContain(name);
  await act(async () => button.click());
  expect(navigate).toHaveBeenCalledWith({ ...selection, kind: "replicaset", name });
});

it("preserves unsupported relationship names as descriptive text, not broken navigation", async () => {
  const name = "custom-controller-for-notifications-in-production-europe";
  await render(createElement(RelationshipLinks, { items: [{ kind: "CustomController", name }] }));
  expect(host.textContent).toContain(name);
  expect(host.querySelector("button")).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

it("keeps long resource list names and health details available", async () => {
  const onClick = vi.fn();
  const name = "customer-account-notifications-worker-rollout-7d989a869b-abcde";
  const sub = "CrashLoopBackOff · 0/2 ready · waiting for container restart";
  await render(createElement(ResourceList, { items: [{ label: name, sub, onClick }], empty: "No Pods" }));
  const button = host.querySelector("button")!;
  expect(button.textContent).toBe(name);
  expect(host.textContent).toContain(sub);
  await act(async () => button.click());
  expect(onClick).toHaveBeenCalledOnce();
});

it("renders YAML verbatim so typography does not alter indentation or long scalar values", async () => {
  const yaml = "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: customer-account-notifications-settings\ndata:\n  endpoint: https://service.example.test/a/very/long/unbroken/path\n  message: |\n    preserve two spaces  here\n    <value> & literal markup\n";
  await render(createElement(YamlView, { yaml }));
  expect(host.querySelector("pre")?.textContent).toBe(yaml);
  expect(host.querySelector("value")).toBeNull();
});

it("retains full concept explanations and the cluster-scoped read-only source command", async () => {
  await render(createElement(ConceptHelp, { concept: "readiness", value: "0/2 containers ready" }));
  const disclosure = host.querySelector("details")!;
  expect(disclosure.open).toBe(false);
  expect(disclosure.querySelector("summary")?.textContent).toBe("Explain readiness");
  expect(disclosure.textContent).toContain("Running is not the same as ready");
  expect(disclosure.textContent).toContain("0/2 containers ready");
  expect(disclosure.querySelector("code")?.textContent).toBe(
    "kubectl --context 'production-europe-platform-cluster' -n 'customer-facing-applications' get 'deployment' 'customer-account-notifications-worker' -o yaml",
  );
  expect(navigate).not.toHaveBeenCalled();
});

it("preserves an explicit source command without rewriting it for presentation", async () => {
  const command = "kubectl --context 'production cluster' -n 'apps' get pods -l 'app in (web,worker)' -o yaml";
  await render(createElement(ConceptHelp, { concept: "selectors", command }));
  expect(host.querySelector("code")?.textContent).toBe(command);
});

it("keeps optional check failures in a closed disclosure without presenting a Pod failure", async () => {
  const failure = "Metrics API not available: custom.metrics.k8s.io is not registered";
  vi.mocked(client.getPodUsage).mockRejectedValue(new Error(failure));
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));

  const disclosure = [...host.querySelectorAll("details")].find((item) => item.textContent?.includes(failure));
  expect(disclosure).toBeDefined();
  expect(disclosure!.open).toBe(false);
  expect(disclosure!.firstElementChild?.tagName).toBe("SUMMARY");
  expect(disclosure!.querySelector("summary")?.textContent).toMatch(/unavailable|check/i);
  expect(disclosure!.textContent).toContain("Metrics");
  expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(host.textContent).toContain("Ready");

  await act(async () => (disclosure!.querySelector("summary") as HTMLElement).click());
  expect(disclosure!.open).toBe(true);
  expect(disclosure!.textContent).toContain(failure);
  expect(client.getPodUsage).toHaveBeenCalledTimes(1);
  expect(navigate).not.toHaveBeenCalled();
});

it("does not hide a failed primary Pod read behind optional diagnostics", async () => {
  const failure = "Forbidden: user cannot get pods in namespace customer-facing-applications";
  vi.mocked(client.describePod).mockRejectedValue(new Error(failure));
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));

  const alert = host.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain(failure);
  expect(alert?.closest("details")).toBeNull();
  expect(client.getPodUsage).not.toHaveBeenCalled();
});

it("does not reserve warning space when all supplementary checks succeeded", async () => {
  await render(createElement(CheckWarnings, { errors: {} }));
  expect(host.childElementCount).toBe(0);
  expect(host.textContent).toBe("");
});

it("preserves every unavailable check and exact error inside one accessible disclosure", async () => {
  const errors = {
    Metrics: "Metrics API not available",
    Node: "Forbidden: system:serviceaccount:team:viewer cannot get node 'worker-1'",
    Events: "request timed out after 30s\nretry after the API server recovers",
  };
  await render(createElement(CheckWarnings, { errors }));
  const disclosure = host.querySelector("details")!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  const summary = disclosure.querySelector("summary")!;
  expect(summary.textContent).toMatch(/unavailable|check/i);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  const labels = [...disclosure.querySelectorAll("dt")].map((item) => item.textContent);
  const messages = [...disclosure.querySelectorAll("dd")].map((item) => item.textContent);
  expect(labels).toEqual(Object.keys(errors));
  expect(messages).toEqual(Object.values(errors));
  await act(async () => summary.click());
  expect(disclosure.open).toBe(true);
});

it("collapses all-true conditions while retaining their exact status for inspection", async () => {
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const disclosure = host.querySelector<HTMLDetailsElement>("details.k8s-conditions")!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  expect(disclosure.textContent).toContain("Ready");
  expect(disclosure.textContent).toContain("ContainersReady");
  expect(disclosure.textContent).toContain("True");
  await act(async () => disclosure.querySelector("summary")!.click());
  expect(disclosure.open).toBe(true);
});

it("keeps Pod facts and status in independent layout columns rather than shared row tracks", async () => {
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const overview = host.querySelector(".k8s-pod-overview")!;
  expect(overview).not.toBeNull();
  const columns = [...overview.querySelectorAll(":scope > .k8s-pod-column")];
  expect(columns).toHaveLength(2);
  const factsColumn = columns.find((column) => column.querySelector(".k8s-facts"));
  const conditionsColumn = columns.find((column) => column.querySelector(".k8s-conditions"));
  expect(factsColumn).toBeDefined();
  expect(conditionsColumn).toBeDefined();
  expect(factsColumn).not.toBe(conditionsColumn);
});

it("keeps non-readiness conditions visible without interpreting True as healthy", async () => {
  const detail = readyPod();
  detail.conditions = [{ type: "DisruptionTarget", status: "True", reason: "EvictionByEvictionAPI" }];
  vi.mocked(client.describePod).mockResolvedValue(detail);
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const disclosure = host.querySelector<HTMLDetailsElement>("details.k8s-conditions")!;
  expect(disclosure.open).toBe(true);
  expect(disclosure.textContent).toContain("EvictionByEvictionAPI");
  expect(disclosure.querySelector(".k8s-condition-value")?.getAttribute("data-state")).toBe("unknown");
});

it.each(["False", "Unknown"])("opens %s conditions with their diagnostic evidence intact", async (status) => {
  const detail = readyPod();
  detail.conditions = [{
    type: "Ready", status, reason: "ContainersNotReady",
    message: "containers with unready status: [customer-account-notifications-worker]",
  }];
  vi.mocked(client.describePod).mockResolvedValue(detail);
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const disclosure = host.querySelector<HTMLDetailsElement>("details.k8s-conditions")!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(true);
  expect(disclosure.textContent).toContain(status);
  expect(disclosure.textContent).toContain(detail.conditions[0].reason);
  expect(disclosure.textContent).toContain(detail.conditions[0].message);
  expect(disclosure.querySelector(".k8s-condition-value")?.getAttribute("data-state")).toBe(status === "False" ? "false" : "unknown");
});

it.each(["Unknown", "Pending", "Failed"])("does not present phase %s as Ready when a True readiness condition is stale", async (phase) => {
  vi.mocked(client.describePod).mockResolvedValue({ ...readyPod(), phase });
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const health = host.querySelector('[aria-label="Pod health"]')!;
  expect(health).not.toBeNull();
  expect(health.querySelector(".k8s-health-state")?.getAttribute("data-state")).not.toBe("ready");
  expect(health.querySelector("h3")?.textContent).not.toBe("Ready");
});

it("presents successful completion separately from readiness to serve traffic", async () => {
  const detail = readyPod();
  detail.phase = "Succeeded";
  detail.conditions = [{ type: "Ready", status: "False" }];
  detail.containers = [{ ...detail.containers[0], state: "terminated", ready: false, exitCode: 0 }];
  vi.mocked(client.describePod).mockResolvedValue(detail);
  await render(createElement(PodDetailPanel, {
    namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
  }));
  const health = host.querySelector('[aria-label="Pod health"]')!;
  expect(health.querySelector("h3")?.textContent).toBe("Completed");
  expect(health.textContent).toContain("Pod completed successfully");
  expect(health.querySelector(".k8s-health-state")?.getAttribute("data-state")).toBe("ready");
});
