// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@hugeicons/react", () => ({ HugeiconsIcon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("./client", async (original) => ({
  ...await original<typeof import("./client")>(),
  describePod: vi.fn(), getServicesForPod: vi.fn(), getNodeInfo: vi.fn(), getPodUsage: vi.fn(), getPodLogs: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import * as client from "./client";
import { K8sInspectorProvider } from "./K8sInspectorContext";
import type { K8sResourceSelection } from "./KubernetesView";
import { PodDetailPanel } from "./PodDetailPanel";

let root: Root;
let host: HTMLDivElement;
const navigate = vi.fn();
const selection: K8sResourceSelection = {
  context: "production-europe-platform-cluster",
  kind: "pod",
  namespace: "customer-facing-applications",
  name: "customer-account-notifications-worker",
};
const container = (overrides: Partial<client.K8sContainer> = {}): client.K8sContainer => ({
  name: "customer-account-notifications-worker",
  image: "registry.example.test/customer-facing-applications/customer-account-notifications-worker@sha256:1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  state: "running", ready: true, restartCount: 0,
  livenessProbe: "HTTP GET /internal/health/live on port 8080, initial delay 30s, timeout 5s, period 10s",
  readinessProbe: "HTTP GET /internal/health/ready on port 8080, initial delay 5s, timeout 3s, period 5s",
  startupProbe: "exec /usr/local/bin/wait-for-customer-account-notifications-database --timeout=120, period 10s",
  ...overrides,
});
const pod = (overrides: Partial<client.K8sPodDetail> = {}): client.K8sPodDetail => ({
  namespace: selection.namespace, name: selection.name, createdAt: "2026-01-01T12:00:00Z",
  labels: {}, annotations: {}, node: "", ip: "10.0.0.1", hostIp: "", qosClass: "Burstable",
  serviceAccount: "default", restartPolicy: "Always", phase: "Running",
  conditions: [{ type: "Ready", status: "True" }], ownerReferences: [],
  containers: [container()], initContainers: [], volumes: [], events: [], resources: [], yaml: "kind: Pod",
  ...overrides,
});

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  vi.mocked(client.describePod).mockResolvedValue(pod());
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

async function renderPod() {
  await act(async () => root.render(createElement(K8sInspectorProvider, {
    selection, onNavigate: navigate,
    children: createElement(PodDetailPanel, {
      namespace: selection.namespace, name: selection.name, onClose: vi.fn(),
    }),
  })));
}

async function clickTab(label: string) {
  const button = [...host.querySelectorAll<HTMLButtonElement>(".k8s-tabs > button")]
    .find((item) => item.textContent === label);
  expect(button, `Tab ${label}`).toBeDefined();
  await act(async () => button!.click());
}

function expectReadCountsUnchanged(counts: number[]) {
  expect(readCounts()).toEqual(counts);
  expect(client.getPodLogs).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
}

function readCounts() {
  return [
    vi.mocked(client.describePod).mock.calls.length,
    vi.mocked(client.getServicesForPod).mock.calls.length,
    vi.mocked(client.getPodUsage).mock.calls.length,
    vi.mocked(client.getNodeInfo).mock.calls.length,
  ];
}

it("places a lone container in one full-width list, not the generic two-column overview", async () => {
  await renderPod();
  await clickTab("Containers");

  const list = host.querySelector(".k8s-container-list");
  expect(list).not.toBeNull();
  expect(host.querySelectorAll(".k8s-container-list")).toHaveLength(1);
  expect(list!.closest(".k8s-overview")).toBeNull();
  const cards = list!.querySelectorAll(":scope > .k8s-container-card");
  expect(cards).toHaveLength(1);
  const layout = cards[0].querySelector(".k8s-container-layout");
  expect(layout).not.toBeNull();
  const probes = layout!.querySelector(":scope > .k8s-probes");
  const runtime = layout!.querySelector(":scope > .k8s-container-runtime");
  expect(probes).not.toBeNull();
  expect(runtime).not.toBeNull();
  expect(layout!.children.length).toBe(2);
  expect(runtime?.textContent).toContain("State");
  expect(runtime?.textContent).toContain("Restarts");
  expect(host.querySelector(".k8s-snapshot")?.textContent).toContain("Read-only");
  expect(host.querySelector(".k8s-check-warnings")).toBeNull();
});

it("retains complete container facts, zero exit codes, and long diagnostic text", async () => {
  const detail = container({
    state: "terminated", ready: false, restartCount: 12,
    reason: "ApplicationConfigurationError",
    message: "Required customer-account-notifications configuration is unavailable at /etc/customer-account-notifications/configuration.yaml",
    startedAt: "2026-01-01T12:34:56Z", finishedAt: "2026-01-01T13:45:56Z", exitCode: 0, signal: 0,
    lastTermination: {
      reason: "PreviousConfigurationError", message: "Previous process could not load customer-notifications configuration",
      exitCode: 2, signal: 9, startedAt: "2026-01-01T10:11:22Z", finishedAt: "2026-01-01T11:22:33Z",
    },
  });
  vi.mocked(client.describePod).mockResolvedValue(pod({ containers: [detail] }));
  await renderPod();
  await clickTab("Containers");

  const card = host.querySelector(".k8s-container-card")!;
  expect(card).not.toBeNull();
  for (const fact of [
    detail.name, detail.image, detail.state, String(detail.restartCount), detail.reason!, detail.message!,
    detail.startedAt!, detail.finishedAt!, detail.lastTermination!.reason!, detail.lastTermination!.finishedAt!,
    detail.lastTermination!.startedAt!, detail.lastTermination!.message!,
  ]) expect(card.textContent).toContain(fact);
  expect(card.textContent).toMatch(/Not [Rr]eady/);
  const facts = Object.fromEntries([...card.querySelectorAll(".k8s-facts > div")].map((fact) => [
    fact.querySelector("dt")?.textContent, fact.querySelector("dd")?.textContent,
  ]));
  expect(facts).toEqual(expect.objectContaining({ State: "terminated", Restarts: "12", "Exit code": "0", Signal: "0" }));
  expect(card.textContent).toMatch(/[Ee]xit\s*2/);
  expect(card.textContent).toMatch(/[Ss]ignal\s*9/);
  expect(card.querySelectorAll(".truncate, .text-ellipsis, [class*='line-clamp-']")).toHaveLength(0);
});

it("keeps all three full probe values and expands explanatory help without running commands", async () => {
  await renderPod();
  await clickTab("Containers");
  const counts = readCounts();
  const probes = host.querySelector(".k8s-probes")!;
  expect(probes).not.toBeNull();
  expect([...probes.querySelectorAll(".k8s-probe > h3")].map((heading) => heading.textContent))
    .toEqual(["Liveness", "Readiness", "Startup"]);
  for (const value of [container().livenessProbe!, container().readinessProbe!, container().startupProbe!]) {
    expect(probes.textContent).toContain(value);
  }
  const disclosures = [...probes.querySelectorAll<HTMLDetailsElement>("details.k8s-concept")];
  expect(disclosures.map((item) => item.querySelector("summary")?.textContent)).toEqual([
    "Explain liveness", "Explain readiness", "Explain startup probe",
  ]);
  const command = "kubectl --context 'production-europe-platform-cluster' -n 'customer-facing-applications' get 'pod' 'customer-account-notifications-worker' -o yaml";
  for (const disclosure of disclosures) {
    expect(disclosure.open).toBe(false);
    await act(async () => disclosure.querySelector("summary")!.click());
    expect(disclosure.open).toBe(true);
    expect(disclosure.querySelector("code")?.textContent).toBe(command);
    expect(disclosure.querySelectorAll("button")).toHaveLength(0);
    await act(async () => disclosure.querySelector("summary")!.click());
    expect(disclosure.open).toBe(false);
  }
  expectReadCountsUnchanged(counts);
});

it("distinguishes missing probe configuration without removing probe labels or explanations", async () => {
  vi.mocked(client.describePod).mockResolvedValue(pod({ containers: [container({
    livenessProbe: undefined, readinessProbe: "none", startupProbe: "",
  })] }));
  await renderPod();
  await clickTab("Containers");
  const probes = host.querySelector(".k8s-probes")!;
  expect(probes).not.toBeNull();
  expect(probes.textContent?.match(/Not configured/g)).toHaveLength(3);
  expect(probes.querySelectorAll("details.k8s-concept")).toHaveLength(3);
  for (const label of ["Liveness", "Readiness", "Startup"]) expect(probes.textContent).toContain(label);
});

it("preserves a container error message even when Kubernetes returns no reason", async () => {
  const message = "Container status was unavailable while the node connection was interrupted";
  vi.mocked(client.describePod).mockResolvedValue(pod({ containers: [container({ reason: undefined, message })] }));
  await renderPod();
  await clickTab("Containers");
  expect(host.querySelector(".k8s-container-card")?.textContent).toContain(message);
});

it("keeps init and regular containers with the same name in separate labelled cards", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(client.describePod).mockResolvedValue(pod({
    initContainers: [container({ name: "shared-name", image: "setup:v2", state: "terminated", ready: false, exitCode: 0 })],
    containers: [container({ name: "shared-name", image: "application:v3" }), container({ name: "sidecar", image: "sidecar:v4" })],
  }));
  await renderPod();
  await clickTab("Containers");

  const cards = [...host.querySelectorAll(".k8s-container-list > .k8s-container-card")];
  expect(cards).toHaveLength(3);
  const init = cards.find((card) => card.textContent?.includes("setup:v2"))!;
  const regular = cards.find((card) => card.textContent?.includes("application:v3"))!;
  expect(init.textContent).toContain("shared-name");
  expect(init.getAttribute("aria-label")).toBe("Init container shared-name");
  expect(init.querySelector("h3")?.textContent).toContain("init container");
  expect(init.textContent).toContain("Completed");
  expect(init.textContent).not.toMatch(/Not [Rr]eady/);
  expect(regular.textContent).toContain("shared-name");
  expect(regular.getAttribute("aria-label")).toBe("Container shared-name");
  expect(regular.querySelector("h3")?.textContent).not.toContain("init container");
  expect(regular).not.toBe(init);
  expect(cards.every((card) => card.querySelectorAll(".k8s-probes").length === 1)).toBe(true);
  expect(error.mock.calls.filter((args) => args.some((arg) => /same key|unique.*key/i.test(String(arg))))).toEqual([]);
});

it("shows init-only Pods without incorrectly declaring their containers empty", async () => {
  vi.mocked(client.describePod).mockResolvedValue(pod({
    containers: [], initContainers: [container({ name: "initialize-schema", image: "schema:v1" })],
  }));
  await renderPod();
  await clickTab("Containers");
  const list = host.querySelector(".k8s-container-list")!;
  expect(list).not.toBeNull();
  expect(list.querySelectorAll(".k8s-container-card")).toHaveLength(1);
  expect(list.textContent).toContain("initialize-schema");
  expect(list.querySelector(".k8s-container-card")?.getAttribute("aria-label")).toBe("Init container initialize-schema");
  expect(list.textContent).not.toMatch(/no containers/i);
});

it.each([[], undefined])("shows a meaningful empty state when no regular or init containers were returned (%j)", async (initContainers) => {
  vi.mocked(client.describePod).mockResolvedValue(pod({ containers: [], initContainers }));
  await renderPod();
  await clickTab("Containers");
  expect(host.querySelectorAll(".k8s-container-card")).toHaveLength(0);
  expect(host.textContent).toMatch(/no containers/i);
  expect(host.querySelector('[role="alert"]')).toBeNull();
});

it("keeps expanded check failures in the snapshot group as individual, exact records", async () => {
  const failures = {
    Services: "Forbidden: user system:serviceaccount:customer-facing-applications:viewer cannot list services",
    Metrics: "Metrics API not available: metrics.k8s.io is not registered",
    Events: "request timed out after 30s\nretry after the API server recovers",
  };
  vi.mocked(client.describePod).mockResolvedValue(pod({ eventsError: failures.Events }));
  vi.mocked(client.getServicesForPod).mockRejectedValue(new Error(failures.Services));
  vi.mocked(client.getPodUsage).mockRejectedValue(new Error(failures.Metrics));
  await renderPod();
  await clickTab("Containers");
  const counts = readCounts();

  const snapshot = host.querySelector(".k8s-snapshot")!;
  const disclosure = snapshot.querySelector<HTMLDetailsElement>(":scope > .k8s-check-warnings")!;
  expect(disclosure).not.toBeNull();
  expect(disclosure.open).toBe(false);
  const summary = disclosure.querySelector<HTMLElement>(":scope > summary")!;
  expect(summary.textContent).toContain("unavailable");
  expect(summary.textContent).toContain("Read-only");
  await act(async () => summary.click());
  expect(disclosure.open).toBe(true);
  expect(disclosure.parentElement).toBe(snapshot);
  expect(disclosure.querySelector(":scope > summary")).toBe(summary);
  const records = [...disclosure.querySelectorAll(".k8s-check-content dl > div")];
  expect(records).toHaveLength(3);
  expect(Object.fromEntries(records.map((record) => [
    record.querySelector("dt")?.textContent, record.querySelector("dd")?.textContent,
  ]))).toEqual(failures);
  expect(disclosure.querySelectorAll(".truncate, .text-ellipsis, [class*='line-clamp-']")).toHaveLength(0);
  expect(host.querySelector('[role="alert"]')).toBeNull();
  await act(async () => summary.click());
  expect(disclosure.open).toBe(false);
  expectReadCountsUnchanged(counts);
});
