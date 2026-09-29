import { describe, expect, it } from "vitest";
import type { K8sPodDetail } from "./client";
import { diagnosePod, podTimeline } from "./podDiagnostics";

export function podFixture(overrides: Partial<K8sPodDetail> = {}): K8sPodDetail {
  return { namespace: "apps", name: "web", createdAt: "", labels: {}, annotations: {}, node: "node-a", ip: "", hostIp: "", qosClass: "Burstable", serviceAccount: "default", restartPolicy: "Always", phase: "Running", conditions: [{ type: "Ready", status: "True" }], ownerReferences: [], containers: [{ name: "web", image: "web:1", ready: true, restartCount: 0, state: "running" }], volumes: [], events: [], resources: [], yaml: "kind: Pod", ...overrides };
}

describe("evidence-based Pod findings", () => {
  it("does not invent an incident for a ready or successfully completed Pod", () => {
    expect(diagnosePod(podFixture())).toEqual([]);
    expect(diagnosePod(podFixture({ phase: "Succeeded", conditions: [{ type: "Ready", status: "False" }] }))).toEqual([]);
  });
  it("does not equate Running with ready or claim an unobserved probe failure", () => {
    const finding = diagnosePod(podFixture({ conditions: [{ type: "Ready", status: "False", reason: "ReadinessGatesNotReady", message: "custom gate is false" }] }))[0];
    expect(finding.title).toBe("Pod is running, but not ready");
    expect(finding.evidence).toContain("custom gate is false");
    expect(finding.evidence).not.toContain("HTTP");
    expect(finding.tab).toBe("containers");
  });
  it("treats missing readiness as unknown", () => {
    expect(diagnosePod(podFixture({ conditions: [] }))[0].title).toContain("unknown");
  });
  it("shows crash backoff as a symptom and points at previous logs", () => {
    const finding = diagnosePod(podFixture({ containers: [{ name: "web", image: "web:1", ready: false, restartCount: 4, state: "waiting", reason: "CrashLoopBackOff", lastTermination: { reason: "Error", exitCode: 1 } }] }))[0];
    expect(finding.evidence).toContain("exit 1");
    expect(finding.meaning).toContain("not why");
    expect(finding.previous).toBe(true);
    expect(finding.container).toBe("web");
  });
  it("includes init containers and distinguishes historical OOM evidence", () => {
    const finding = diagnosePod(podFixture({ initContainers: [{ name: "setup", image: "setup:1", ready: false, restartCount: 1, state: "waiting", lastTermination: { reason: "OOMKilled", exitCode: 137 } }] }))[0];
    expect(finding.title).toContain("previous termination");
    expect(finding.evidence).toContain("137");
    expect(finding.meaning).toContain("does not identify a memory leak");
  });
  it("does not assume every Pending Pod is unschedulable", () => {
    const finding = diagnosePod(podFixture({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "True" }] }))[0];
    expect(finding.title).toBe("Pod is pending");
    expect(finding.meaning).toContain("does not by itself prove");
  });
  it("does not combine a previous OOM reason with the current termination's exit code", () => {
    const finding = diagnosePod(podFixture({ containers: [{ name: "web", image: "web:1", ready: false, restartCount: 2, state: "terminated", reason: "Error", exitCode: 1, lastTermination: { reason: "OOMKilled", exitCode: 137 } }] }))[0];
    expect(finding.evidence).toContain("Previous termination reason is OOMKilled (exit 137)");
  });
  it("retains scheduler evidence and image-pull messages", () => {
    const findings = diagnosePod(podFixture({ phase: "Pending", conditions: [{ type: "PodScheduled", status: "False", message: "Insufficient cpu" }], containers: [{ name: "web", image: "web:1", ready: false, restartCount: 0, state: "waiting", reason: "ImagePullBackOff", message: "manifest unknown" }] }));
    expect(findings.find((finding) => finding.id === "pending")?.evidence).toContain("Insufficient cpu");
    expect(findings[0].evidence).toContain("manifest unknown");
    expect(findings[0].tab).toBe("events");
  });
});

describe("Pod incident timeline", () => {
  it("correlates timestamped termination, conditions and aggregated events, newest first", () => {
    const timeline = podTimeline(podFixture({
      containers: [{ name: "web", image: "web:1", ready: false, restartCount: 1, state: "terminated", reason: "Error", exitCode: 1, finishedAt: "2026-01-02T00:00:03Z", lastTermination: { reason: "OOMKilled", exitCode: 137, finishedAt: "2026-01-02T00:00:01Z" } }],
      conditions: [{ type: "Ready", status: "False", lastTransitionTime: "2026-01-02T00:00:04Z" }],
      events: [{ object: "Pod", lastSeen: "2026-01-02T00:00:02Z", type: "Warning", reason: "BackOff", message: "Restart delayed", count: 3 }, { object: "Pod", lastSeen: "", type: "Normal", reason: "Created", message: "Created container" }],
    }));
    expect(timeline.map((entry) => entry.id)).toEqual(["condition:Ready", "termination:web", "event:0", "previous:web", "event:1"]);
    expect(timeline[2].detail).toContain("3 occurrences");
    expect(timeline[3].detail).toContain("137");
  });
});
