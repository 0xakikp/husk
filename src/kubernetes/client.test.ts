import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import * as client from "./client";
import type { K8sConfigSource } from "./configSource";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const ok = (stdout: string) => ({ stdout, stderr: "", exit_code: 0, timed_out: false, truncated: false });
const json = (value: unknown) => ok(JSON.stringify(value));
type Command = { program: string; args: string[]; timeout_secs: number };
const argsFor = (call: unknown[]) => (call[1] as Command).args;
const commands = () => mockInvoke.mock.calls.map((call) => argsFor(call));

function route(handler: (args: string[]) => ReturnType<typeof ok>) {
  mockInvoke.mockImplementation(async (_command, payload) => handler((payload as unknown as Command).args));
}

beforeEach(() => {
  vi.clearAllMocks();
  client.invalidateK8sCache();
});

describe("context-bound Kubernetes reads", () => {
  it("pins every read and nested association to its explicit context", async () => {
    route((args) => args.includes("json") ? json({ metadata: { uid: "uid", name: "fixture" }, spec: { selector: { matchLabels: { app: "web" } } }, items: [] }) : ok(""));
    const context = "prod's cluster";
    const listReads = [client.listPods, client.listServices, client.listIngresses, client.listDeployments,
      client.listReplicaSets, client.listStatefulSets, client.listDaemonSets, client.listJobs,
      client.listConfigMaps, client.listSecrets, client.listPersistentVolumeClaims, client.listResourceQuotas];
    await Promise.all(listReads.map((read) => read("team", context)));
    const detailReads = [client.describePod, client.describeService, client.describeIngress, client.describeDeployment,
      client.describeJob, client.describeConfigMap, client.describeSecret, client.describePersistentVolumeClaim, client.describeResourceQuota];
    await Promise.all(detailReads.map((read) => read("team", "fixture", context)));
    await client.listNamespaces(context);
    await client.getPodEvents("team", "fixture", context);
    await client.getPodLogs("team", "fixture", "app", 200, { context });
    await client.getPodUsage("team", "fixture", context);
    await client.getNodeInfo("worker", context);
    await client.getServicesForPod("team", { app: "web" }, context);
    await client.getResourceYaml("team", "service", "fixture", context);
    await client.getSecretYaml("team", "fixture", context);
    for (const kind of ["replicaset", "statefulset", "daemonset"] as const) await client.describeWorkload(kind, "team", "fixture", context);
    expect(mockInvoke.mock.calls.length).toBeGreaterThan(40);
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("shell_run_command");
      expect(payload).toMatchObject({ program: "kubectl" });
      const { args, timeout_secs } = payload as unknown as Command;
      expect(args).toContain(`--context=${context}`);
      expect(args).toContain(`--request-timeout=${timeout_secs}s`);
      expect(args).not.toContain("use-context");
    }
  });

  it.each([
    [{ timed_out: true }, "timed out"],
    [{ truncated: true }, "size limit"],
    [{ exit_code: 1, stderr: "Forbidden: pods is forbidden" }, "Forbidden"],
  ])("rejects unavailable or incomplete evidence: %j", async (extra, message) => {
    mockInvoke.mockResolvedValue({ ...ok("partial output"), ...extra });
    await expect(client.listPods("team", "prod")).rejects.toThrow(message);
  });

  it("does not turn denied namespace/metrics access into an empty successful result", async () => {
    mockInvoke.mockResolvedValue({ ...ok(""), exit_code: 1, stderr: "Forbidden" });
    await expect(client.listNamespaces("prod")).rejects.toThrow("Forbidden");
    await expect(client.getPodUsage("team", "web", "prod")).rejects.toThrow("Forbidden");
  });

  it("keeps unknown node readiness and unavailable metrics explicit", async () => {
    route((args) => args[0] === "top" ? { ...ok(""), exit_code: 1, stderr: "Metrics API unavailable" } : json({ metadata: { name: "worker" }, status: {} }));
    const node = await client.getNodeInfo("worker", "prod");
    expect(node.status).toBe("Unknown");
    expect(node.metricsError).toBe("Metrics API unavailable");
  });
});

describe("explicit kubeconfig sources", () => {
  const config: K8sConfigSource = {
    kind: "terminal", paths: ["/fixtures/team config", "/fixtures/shared.yaml"],
    cwd: "/fixtures/terminal-cwd", fingerprint: "terminal-team-and-shared", label: "Terminal snapshot", missingPaths: [],
  };
  const scope = { context: "same-named-context", config };

  it("pins every resource read and nested association to both config paths and context", async () => {
    route((args) => args.includes("json") ? json({ metadata: { uid: "uid", name: "fixture" }, spec: { selector: { matchLabels: { app: "web" } } }, items: [] }) : ok(""));
    const listReads = [client.listPods, client.listServices, client.listIngresses, client.listDeployments,
      client.listReplicaSets, client.listStatefulSets, client.listDaemonSets, client.listJobs,
      client.listConfigMaps, client.listSecrets, client.listPersistentVolumeClaims, client.listResourceQuotas];
    await Promise.all(listReads.map((read) => read("team", scope)));
    const detailReads = [client.describePod, client.describeService, client.describeIngress, client.describeDeployment,
      client.describeJob, client.describeConfigMap, client.describeSecret, client.describePersistentVolumeClaim, client.describeResourceQuota];
    await Promise.all(detailReads.map((read) => read("team", "fixture", scope)));
    await client.listNamespaces(scope);
    await client.getPodEvents("team", "fixture", scope);
    await client.getPodLogs("team", "fixture", "app", 200, { context: scope, previous: true });
    await client.getPodUsage("team", "fixture", scope);
    await client.getNodeInfo("worker", scope);
    await client.getServicesForPod("team", { app: "web" }, scope);
    await client.getResourceYaml("team", "service", "fixture", scope);
    await client.getSecretYaml("team", "fixture", scope);
    for (const kind of ["replicaset", "statefulset", "daemonset"] as const) await client.describeWorkload(kind, "team", "fixture", scope);

    expect(mockInvoke.mock.calls.length).toBeGreaterThan(40);
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("kubernetes_run_command");
      expect(payload).toMatchObject({ kubeconfigPaths: config.paths, cwd: config.cwd });
      const { args, timeoutSecs } = payload as { args: string[]; timeoutSecs: number };
      expect(args).toContain(`--context=${scope.context}`);
      expect(args).toContain(`--request-timeout=${timeoutSecs}s`);
      expect(args).not.toContain("use-context");
    }
  });

  it("lists contexts and reads the default context from the selected files without changing them", async () => {
    route((args) => ok(args.includes("current-context") ? "same-named-context\n" : "same-named-context\nsecond-context\n"));
    expect(await client.currentContext(config)).toBe("same-named-context");
    expect(await client.listContexts(config)).toEqual(["same-named-context", "second-context"]);
    expect(mockInvoke).toHaveBeenCalledTimes(2);
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("kubernetes_run_command");
      expect(payload).toMatchObject({ kubeconfigPaths: config.paths, cwd: config.cwd });
      expect((payload as { args: string[] }).args).not.toContain("use-context");
    }
  });

  it("does not mix concurrent same-context resource reads from different files", async () => {
    const otherConfig = { ...config, paths: ["/fixtures/other.yaml"], fingerprint: "other-source", cwd: "/fixtures/other-cwd" };
    let finishFirst!: (result: ReturnType<typeof ok>) => void;
    mockInvoke.mockImplementation((_command, payload) => {
      const paths = (payload as { kubeconfigPaths: string[] }).kubeconfigPaths;
      if ((payload as unknown as Command).args.includes("-o")) return Promise.resolve(ok("team web web-uid <none> <none> <none>"));
      return paths[0] === config.paths[0]
        ? new Promise((resolve) => { finishFirst = resolve; })
        : Promise.resolve(ok("web 0/1 Pending 0 1m"));
    });
    const first = client.listPods("team", scope);
    const second = await client.listPods("team", { context: scope.context, config: otherConfig });
    expect(second[0]).toMatchObject({ name: "web", ready: "0/1", status: "Pending" });
    finishFirst(ok("web 1/1 Running 0 1m"));
    expect((await first)[0]).toMatchObject({ name: "web", ready: "1/1", status: "Running" });
    expect(mockInvoke.mock.calls.map(([, payload]) => (payload as { kubeconfigPaths: string[] }).kubeconfigPaths)).toEqual([config.paths, otherConfig.paths, otherConfig.paths, config.paths]);
  });

  it("keeps redacted and explicit Secret reads on the chosen source", async () => {
    route((args) => args.includes("json") ? json({ data: { password: "secret-fixture" } }) : ok("data:\n  password: secret-fixture"));
    expect(await client.getResourceYaml("team", "secret", "web", scope)).not.toContain("secret-fixture");
    expect(commands()).toHaveLength(1);
    expect(commands()[0]).not.toContain("yaml");
    expect(await client.getSecretYaml("team", "web", scope)).toContain("secret-fixture");
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("kubernetes_run_command");
      expect(payload).toMatchObject({ kubeconfigPaths: config.paths, cwd: config.cwd });
      expect((payload as { args: string[] }).args).toContain(`--context=${scope.context}`);
    }
  });
});

describe("selector and owner relationships", () => {
  it("preserves all label-selector operators", () => {
    expect(client.selectorToString({ matchLabels: { app: "web" }, matchExpressions: [
      { key: "tier", operator: "In", values: ["frontend", "edge"] },
      { key: "environment", operator: "NotIn", values: ["test"] },
      { key: "enabled", operator: "Exists" },
      { key: "retired", operator: "DoesNotExist" },
    ] })).toBe("app=web,tier in (frontend,edge),environment notin (test),enabled,!retired");
    expect(() => client.selectorToString({ matchExpressions: [{ key: "x", operator: "Unknown" }] })).toThrow("Unsupported");
  });

  it("uses the Deployment selector rather than its name, and verifies ReplicaSet owner UID", async () => {
    route((args) => {
      if (args[1] === "deployment" && args.includes("json")) return json({
        metadata: { name: "checkout", uid: "deploy-1" },
        spec: { replicas: 3, selector: { matchLabels: { component: "api" }, matchExpressions: [{ key: "tier", operator: "In", values: ["backend"] }] } },
        status: { replicas: 3, readyReplicas: 1, availableReplicas: 1, updatedReplicas: 2 },
      });
      if (args[1] === "replicasets") return json({ items: [
        { metadata: { name: "owned-rs", ownerReferences: [{ kind: "Deployment", uid: "deploy-1" }] }, spec: { replicas: 3 }, status: { readyReplicas: 1 } },
        { metadata: { name: "other-rs", ownerReferences: [{ kind: "Deployment", uid: "another" }] } },
      ] });
      if (args[1] === "pods") return ok("checkout-123 1/1 Running 2 (10s ago) 2m");
      return ok("kind: Deployment");
    });
    const result = await client.describeDeployment("team", "checkout", "prod");
    expect(result.deployment.ready).toBe("1/3");
    expect(result.pods[0]).toMatchObject({ name: "checkout-123", restarts: "2 (10s ago)", namespace: "team" });
    expect(result.replicaSets.map((rs) => rs.name)).toEqual(["owned-rs"]);
    expect(commands().find((args) => args[1] === "pods")).toContain("component=api,tier in (backend)");
    expect(JSON.stringify(commands())).not.toContain("app=checkout");
  });

  it("distinguishes denied Pod associations from an empty matching list", async () => {
    route((args) => {
      if (args[1] === "deployment" && args.includes("json")) return json({ metadata: { uid: "uid" }, spec: { selector: { matchLabels: { app: "web" } } } });
      if (args[1] === "pods") return { ...ok(""), exit_code: 1, stderr: "Forbidden: cannot list pods" };
      return args.includes("json") ? json({ items: [] }) : ok("");
    });
    const result = await client.describeDeployment("team", "web", "prod");
    expect(result.pods).toEqual([]);
    expect(result.podsError).toContain("Forbidden");
  });

  it.each(["replicaset", "statefulset", "daemonset"] as const)("returns meaningful %s counts and ownership", async (kind) => {
    route((args) => args.includes("json") ? json({
      metadata: { name: "work", ownerReferences: [{ kind: "Deployment", name: "parent" }] },
      spec: { replicas: 4, serviceName: "headless", selector: { matchLabels: { app: "work" } } },
      status: { replicas: 4, readyReplicas: 2, availableReplicas: 1, desiredNumberScheduled: 4, currentNumberScheduled: 4, numberReady: 2, numberAvailable: 1 },
    }) : ok(""));
    const result = await client.describeWorkload(kind, "team", "work", "prod");
    expect(result.workload).toMatchObject({ kind, desired: 4, current: 4, ready: 2, available: 1, ownerReferences: [{ kind: "Deployment", name: "parent" }] });
  });

  it("fixes desired counts parsed from standard Deployment and StatefulSet columns", async () => {
    route((args) => ok(args[1] === "deployments" ? "web 1/3 2 1 2d" : "db 1/3 2d"));
    expect((await client.listDeployments("team", "prod"))[0]).toMatchObject({ ready: "1/3", desired: 3 });
    expect((await client.listStatefulSets("team", "prod"))[0]).toMatchObject({ ready: "1/3", replicas: 3 });
  });

  it("associates Job Pods by selector rather than substring name matching", async () => {
    route((args) => args.includes("json") ? json({ spec: { selector: { matchLabels: { "batch.kubernetes.io/controller-uid": "job-uid" } } } }) : ok(""));
    await client.describeJob("team", "job", "prod");
    expect(commands().find((args) => args[1] === "pods")).toContain("batch.kubernetes.io/controller-uid=job-uid");
  });

  it("does not treat selector-less Services as matching every Pod", async () => {
    mockInvoke.mockResolvedValue(json({ items: [
      { metadata: { name: "manual" }, spec: {} },
      { metadata: { name: "web" }, spec: { selector: { app: "web" } } },
      { metadata: { name: "other" }, spec: { selector: { app: "other" } } },
    ] }));
    expect((await client.getServicesForPod("team", { app: "web" }, "prod")).map((s) => s.name)).toEqual(["web"]);
  });
});

describe("Pod crash evidence", () => {
  it("preserves init containers, exit reasons and UID-bound events", async () => {
    route((args) => {
      if (args[1] === "pod" && args.includes("json")) return json({
        metadata: { uid: "current-uid" },
        spec: { containers: [{ name: "app", image: "web" }], initContainers: [{ name: "setup", image: "setup" }] },
        status: {
          phase: "Running", conditions: [{ type: "Ready", status: "False", reason: "ContainersNotReady", message: "app not ready" }],
          containerStatuses: [{ name: "app", restartCount: 3, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-01-01T12:00:00Z" } } }],
          initContainerStatuses: [{ name: "setup", state: { terminated: { reason: "Completed", exitCode: 0 } } }],
        },
      });
      if (args[1] === "events") return json({ items: [
        { involvedObject: { uid: "old-uid" }, reason: "OldEvent" },
        { involvedObject: { uid: "current-uid", kind: "Pod", name: "web" }, reason: "BackOff", message: "Back-off restarting container", series: { count: 3, lastObservedTime: "2026-01-01T12:01:00Z" } },
      ] });
      return ok("kind: Pod");
    });
    const pod = await client.describePod("team", "web", "prod");
    expect(pod.containers[0].lastTermination).toMatchObject({ reason: "OOMKilled", exitCode: 137 });
    expect(pod.initContainers?.[0]).toMatchObject({ name: "setup", state: "terminated", exitCode: 0 });
    expect(pod.conditions[0]).toMatchObject({ status: "False", message: "app not ready" });
    expect(pod.events).toHaveLength(1);
    expect(pod.events[0]).toMatchObject({ reason: "BackOff", count: 3, lastTimestamp: "2026-01-01T12:01:00Z" });
    expect(commands().find((args) => args[1] === "events")).toContain("involvedObject.uid=current-uid,involvedObject.kind=Pod");
  });

  it("keeps Pod details available when events are forbidden, without claiming no events", async () => {
    route((args) => args[1] === "events" ? { ...ok(""), exit_code: 1, stderr: "Forbidden events" } : args.includes("json") ? json({ metadata: { uid: "uid" } }) : ok(""));
    const pod = await client.describePod("team", "web", "prod");
    expect(pod.eventsError).toBe("Forbidden events");
    expect(pod.events).toEqual([]);
  });

  it("requests bounded previous-container logs with optional timestamps", async () => {
    mockInvoke.mockResolvedValue(ok("2026-01-01T12:00:00Z failed"));
    await client.getPodLogs("team", "web", "setup", 999999, { previous: true, timestamps: true, context: "prod" });
    expect(commands()[0]).toEqual(expect.arrayContaining(["-c", "setup", "--tail=5000", "--previous=true", "--timestamps=true", "--context=prod"]));
  });
});

describe("Service EndpointSlice evidence", () => {
  it("returns endpoint readiness, Pod targets and selected Pods without legacy Endpoints", async () => {
    route((args) => {
      if (args[1] === "service" && args.includes("json")) return json({ spec: { selector: { app: "web" } } });
      if (args[1] === "endpointslices.discovery.k8s.io") return json({ items: [{
        metadata: { name: "web-123" }, addressType: "IPv4", ports: [{ port: 8080 }],
        endpoints: [
          { addresses: ["10.0.0.1"], conditions: { ready: true }, targetRef: { kind: "Pod", name: "web-1", namespace: "team" } },
          { addresses: ["10.0.0.2"], conditions: { ready: false }, targetRef: { kind: "Pod", name: "web-2" } },
        ],
      }] });
      if (args[1] === "pods") return ok("web-1 1/1 Running 0 2m");
      return ok("");
    });
    const service = await client.describeService("team", "web", "prod");
    expect(service.endpoints).toEqual(["10.0.0.1:8080"]);
    expect(service.endpointSlices[0].endpoints[1]).toMatchObject({ ready: false, targetRef: { kind: "Pod", name: "web-2" } });
    expect(service.pods[0].name).toBe("web-1");
    expect(commands().find((args) => args[1] === "endpointslices.discovery.k8s.io")).toContain("kubernetes.io/service-name=web");
    expect(commands().some((args) => args.includes("endpoints"))).toBe(false);
  });

  it("distinguishes denied EndpointSlice access from no endpoints", async () => {
    route((args) => args[1] === "endpointslices.discovery.k8s.io" ? { ...ok(""), exit_code: 1, stderr: "Forbidden endpointslices" } : args.includes("json") ? json({ spec: {} }) : ok(""));
    const service = await client.describeService("team", "manual", "prod");
    expect(service.endpointSlicesError).toBe("Forbidden endpointslices");
    expect(commands().some((args) => args[1] === "pods")).toBe(false);
  });
});

describe("Secret reveal boundary", () => {
  it("returns only redacted data and excludes copied values in annotations and arbitrary metadata", async () => {
    mockInvoke.mockResolvedValue(json({
      apiVersion: "v1", type: "Opaque",
      metadata: { name: "db", annotations: { "kubectl.kubernetes.io/last-applied-configuration": "secret-from-annotation" }, labels: { token: "secret-label" } },
      data: { password: "c2VjcmV0" }, stringData: { token: "secret-plaintext" }, arbitrary: "secret-custom",
    }));
    const result = await client.describeSecret("team", "db", "prod");
    expect(result.keys).toEqual(["password", "token"]);
    expect(result.yaml).toContain("[REDACTED]");
    for (const value of ["c2VjcmV0", "secret-plaintext", "secret-from-annotation", "secret-label", "secret-custom"]) expect(JSON.stringify(result)).not.toContain(value);
    expect(commands()).toHaveLength(1);
    expect(commands()[0]).not.toContain("yaml");
  });

  it("requires the explicit reveal function to request raw YAML", async () => {
    route((args) => args.includes("json") ? json({ data: { password: "sensitive" } }) : ok("data:\n  password: sensitive"));
    expect(await client.getResourceYaml("team", "secret", "db", "prod")).not.toContain("sensitive");
    expect(await client.getSecretYaml("team", "db", "prod")).toContain("sensitive");
    expect(commands().filter((args) => args.includes("yaml"))).toHaveLength(1);
  });
});

describe("cache invalidation during in-flight reads", () => {
  it("waits for expired evidence and surfaces refresh failures", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1000);
    expect(await client.k8sCached("pods", 100, async () => "old")).toBe("old");
    now.mockReturnValue(1200);
    await expect(client.k8sCached("pods", 100, async () => { throw new Error("Forbidden"); })).rejects.toThrow("Forbidden");
    expect(await client.k8sCached("pods", 100, async () => "fresh")).toBe("fresh");
  });
  it("does not let old results repopulate an invalidated cache or remove a newer request", async () => {
    let finishOld!: (value: string) => void;
    let finishNew!: (value: string) => void;
    const old = client.k8sCached("prod:pods", 10000, () => new Promise<string>((resolve) => { finishOld = resolve; }));
    client.invalidateK8sCache();
    const newer = client.k8sCached("prod:pods", 10000, () => new Promise<string>((resolve) => { finishNew = resolve; }));
    finishOld("stale");
    await old;
    const unexpected = vi.fn(async () => "wrong");
    const concurrent = client.k8sCached("prod:pods", 10000, unexpected);
    expect(unexpected).not.toHaveBeenCalled();
    finishNew("fresh");
    expect(await newer).toBe("fresh");
    expect(await concurrent).toBe("fresh");
    expect(await client.k8sCached("prod:pods", 10000, unexpected)).toBe("fresh");
  });
});
