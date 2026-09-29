import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listPods } from "./client";
import { CONTROLLER_COLUMNS, parseControllerMetadata, podOwnershipLabel } from "./podOwnership";
import type { K8sConfigSource } from "./configSource";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const mockInvoke = vi.mocked(invoke);
const ok = (stdout: string) => ({ stdout, stderr: "", exit_code: 0, timed_out: false, truncated: false });
const config: K8sConfigSource = { kind: "file", paths: ["/fixtures/team config.yaml"], cwd: "/fixtures", fingerprint: "file-team", label: "Team config", missingPaths: [] };
const scope = { context: "production team's cluster", config };
const podTable = "api-1 1/1 Running 3 (10s ago) 2m\ndb-0 1/1 Running 0 1d\nagent-1 1/1 Running 0 1d\njob-1 0/1 Completed 0 1h\nmanual 1/1 Running 0 1m";
const podMetadata = "team api-1 pod-api ReplicaSet api-rs rs-uid\nteam db-0 pod-db StatefulSet database sts-uid\nteam agent-1 pod-agent DaemonSet node-agent ds-uid\nteam job-1 pod-job Job backup job-uid\nteam manual pod-manual <none> <none> <none>";

function route(table = podTable, metadata = podMetadata, replicaSets = "team api-rs rs-uid Deployment api deploy-uid") {
  mockInvoke.mockImplementation(async (_command, payload) => {
    const { args } = payload as { args: string[] };
    return ok(args[1] === "replicasets.apps" ? replicaSets : args.includes("-o") ? metadata : table);
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe("Pod-list workload ownership", () => {
  it("labels actual controllers and follows ReplicaSet UID to Deployment in one batch", async () => {
    route();
    const pods = await listPods("team", scope);
    expect(pods.map(pod => pod.ownership)).toEqual([
      { status: "controlled", kind: "Deployment", name: "api", via: "api-rs" },
      { status: "controlled", kind: "StatefulSet", name: "database" },
      { status: "controlled", kind: "DaemonSet", name: "node-agent" },
      { status: "controlled", kind: "Job", name: "backup" },
      { status: "none" },
    ]);
    expect(pods[0]).toMatchObject({ ready: "1/1", status: "Running", restarts: "3 (10s ago)", age: "2m" });
    expect(mockInvoke).toHaveBeenCalledTimes(3);
    for (const [command, payload] of mockInvoke.mock.calls) {
      expect(command).toBe("kubernetes_run_command");
      expect(payload).toMatchObject({ kubeconfigPaths: config.paths, cwd: config.cwd, timeoutSecs: 8 });
      const args = (payload as { args: string[] }).args;
      expect(args).toContain(`--context=${scope.context}`);
      expect(args).toContain("--request-timeout=8s");
      expect(args.slice(args.indexOf("-n"), args.indexOf("-n") + 2)).toEqual(["-n", "team"]);
    }
    const metadataArgs = (mockInvoke.mock.calls[1][1] as { args: string[] }).args;
    expect(metadataArgs).toContain(CONTROLLER_COLUMNS);
    expect(CONTROLLER_COLUMNS).not.toMatch(/annotations|spec|env/);
    expect(CONTROLLER_COLUMNS).toContain("controller==true");
  });

  it("keeps direct ReplicaSet ownership when Deployment resolution is denied", async () => {
    route();
    const implementation = mockInvoke.getMockImplementation()!;
    mockInvoke.mockImplementation(async (command, payload) => (payload as { args: string[] }).args[1] === "replicasets.apps"
      ? { ...ok(""), exit_code: 1, stderr: "Forbidden: cannot list replicasets" } : implementation(command, payload));
    const pods = await listPods("team", scope);
    expect(pods).toHaveLength(5);
    expect(pods[0].ownership).toEqual({ status: "controlled", kind: "ReplicaSet", name: "api-rs", note: "Deployment lookup unavailable: Forbidden: cannot list replicasets" });
    expect(pods[1].ownership).toMatchObject({ kind: "StatefulSet" });
  });

  it("never follows a same-named ReplicaSet with a different UID", async () => {
    route(undefined, undefined, "team api-rs recreated-rs Deployment unrelated other-deployment-uid");
    const [pod] = await listPods("team", scope);
    expect(pod.ownership).toMatchObject({ status: "controlled", kind: "ReplicaSet", name: "api-rs" });
    expect(podOwnershipLabel(pod.ownership).title).toContain("could not be verified");
    expect(podOwnershipLabel(pod.ownership).label).not.toContain("Deployment");
  });

  it("does not infer Deployment from ReplicaSet names or a missing parent reference", async () => {
    route(undefined, undefined, "team api-rs rs-uid <none> <none> <none>");
    expect((await listPods("team", scope))[0].ownership).toEqual({ status: "controlled", kind: "ReplicaSet", name: "api-rs" });
  });

  it("matches all-namespace Pods and ReplicaSets by namespace and UID, not name", async () => {
    route("first api 1/1 Running 0 1m\nsecond api 1/1 Running 0 1m", "first api pod-1 ReplicaSet same rs-1\nsecond api pod-2 ReplicaSet same rs-2", "first same rs-1 Deployment first-api d-1\nsecond same rs-2 Deployment second-api d-2");
    const pods = await listPods("_all", scope);
    expect(pods.map(pod => pod.ownership)).toEqual([
      { status: "controlled", kind: "Deployment", name: "first-api", via: "same" },
      { status: "controlled", kind: "Deployment", name: "second-api", via: "same" },
    ]);
    for (const [, payload] of mockInvoke.mock.calls) expect((payload as { args: string[] }).args).toContain("--all-namespaces");
  });

  it("keeps custom-controller kinds without guessing workload categories", async () => {
    route("custom-1 1/1 Running 0 1m", "team custom-1 pod-custom Widget widgets widget-uid");
    expect((await listPods("team", scope))[0].ownership).toEqual({ status: "controlled", kind: "Widget", name: "widgets" });
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it.each([
    { exit_code: 1, stderr: "Forbidden" },
    { timed_out: true },
    { truncated: true },
  ])("retains Pod rows when the optional metadata read fails: %j", async extra => {
    mockInvoke.mockImplementation(async (_command, payload) => (payload as { args: string[] }).args.includes("-o") ? { ...ok("partial metadata"), ...extra } : ok(podTable));
    const pods = await listPods("team", scope);
    expect(pods).toHaveLength(5);
    expect(pods.every(pod => pod.ownership?.status === "unavailable")).toBe(true);
    expect(podOwnershipLabel(pods[0].ownership).label).toBe("Ownership unavailable");
    expect(mockInvoke).toHaveBeenCalledTimes(2);
  });

  it("does not call a Pod standalone when it is absent from the metadata snapshot", async () => {
    route("missing 1/1 Running 0 1m", "team other other-uid <none> <none> <none>");
    expect((await listPods("team", scope))[0].ownership).toMatchObject({ status: "unavailable" });
  });

  it("does not fetch metadata for an empty Pod list", async () => {
    route("");
    expect(await listPods("team", scope)).toEqual([]);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });
});

describe("controller metadata presentation", () => {
  it.each([
    "team pod uid ReplicaSet rs <none>",
    "team pod uid ReplicaSet,Job rs,job rs-uid,job-uid",
    "team pod uid ReplicaSet rs rs-uid extra",
    "team pod <none> <none> <none> <none>",
    "team pod uid <none> <none> <none>\nteam pod another-uid <none> <none> <none>",
  ])("rejects ambiguous/incomplete metadata without inventing ownership: %s", output => {
    expect(() => parseControllerMetadata(output)).toThrow();
  });

  it("shows the verified controller and full chain in accessible hover text", () => {
    expect(podOwnershipLabel({ status: "controlled", kind: "Deployment", name: "api", via: "api-rs" })).toEqual({ label: "Deployment · api", title: "Controller: Deployment api via ReplicaSet api-rs." });
    expect(podOwnershipLabel({ status: "none" }).label).toBe("No controller");
    expect(podOwnershipLabel({ status: "none" }).title).toContain("does not establish");
    expect(podOwnershipLabel(undefined).label).toBe("Ownership unavailable");
  });
});
