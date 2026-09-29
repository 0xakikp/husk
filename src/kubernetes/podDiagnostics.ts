import type { K8sPodDetail } from "./client";

export type PodFinding = {
  id: string;
  title: string;
  evidence: string;
  meaning: string;
  next: string;
  tab: "events" | "logs" | "containers" | "resources";
  container?: string;
  previous?: boolean;
};

/** Local observations, not inferred root causes or AI-generated diagnoses. */
export function diagnosePod(pod: K8sPodDetail): PodFinding[] {
  const findings: PodFinding[] = [];
  for (const container of [...(pod.initContainers || []), ...pod.containers]) {
    const last = container.lastTermination;
    if (container.reason === "OOMKilled" || last?.reason === "OOMKilled") {
      const termination = container.reason === "OOMKilled" ? container : last;
      findings.push({
        id: `oom:${container.name}`, title: `${container.name}: ${container.reason === "OOMKilled" ? "terminated" : "previous termination"} from out-of-memory`,
        evidence: `${container.reason === "OOMKilled" ? "Current" : "Previous"} termination reason is OOMKilled${termination?.exitCode != null ? ` (exit ${termination.exitCode})` : ""}.`,
        meaning: "Kubernetes reports an out-of-memory termination. This alone does not identify a memory leak or prove which limit was exceeded.",
        next: "Compare memory requests, limits and available usage; inspect previous-container logs.", tab: "resources", container: container.name,
      });
    }
    if (container.reason === "CrashLoopBackOff") {
      findings.push({
        id: `crash:${container.name}`, title: `${container.name}: restarting with backoff`,
        evidence: `Waiting reason is CrashLoopBackOff; restart count is ${container.restartCount}.${last?.reason ? ` Previous termination: ${last.reason}${last.exitCode != null ? ` (exit ${last.exitCode})` : ""}.` : ""}`,
        meaning: "Kubernetes is delaying repeated restarts. Backoff describes the symptom, not why the process stopped.",
        next: "Inspect the previous container's logs and termination details before changing configuration.", tab: "logs", container: container.name, previous: true,
      });
    } else if (["ImagePullBackOff", "ErrImagePull", "InvalidImageName"].includes(container.reason || "")) {
      findings.push({
        id: `image:${container.name}`, title: `${container.name}: image unavailable`,
        evidence: `${container.reason}: ${container.message || container.image}`,
        meaning: "The container cannot start with this image. The error message may distinguish an image reference, registry access or authentication problem.",
        next: "Read the image-pull events and verify the image reference. Do not reveal registry credentials.", tab: "events", container: container.name,
      });
    } else if (container.state === "waiting" && container.reason && !["ContainerCreating", "PodInitializing"].includes(container.reason)) {
      findings.push({ id: `waiting:${container.name}`, title: `${container.name}: waiting`, evidence: `${container.reason}${container.message ? `: ${container.message}` : ""}`, meaning: "Kubernetes has not started this container. The reported reason is the available evidence, not a complete diagnosis.", next: "Inspect container configuration and related warning events.", tab: "containers", container: container.name });
    }
  }
  const scheduled = pod.conditions.find((condition) => condition.type === "PodScheduled");
  if (pod.phase === "Pending") {
    findings.push({
      id: "pending", title: scheduled?.status === "False" ? "Pod has not been scheduled" : "Pod is pending",
      evidence: `Phase: Pending.${scheduled ? ` PodScheduled: ${scheduled.status}${scheduled.reason ? ` (${scheduled.reason})` : ""}.${scheduled.message ? ` ${scheduled.message}` : ""}` : " Scheduling condition is unavailable."}`,
      meaning: scheduled?.status === "False" ? "A node has not been assigned. The scheduler's events can explain constraints such as resources, affinity or storage." : "Pending covers scheduling and container setup; it does not by itself prove insufficient resources.",
      next: "Read scheduling and startup events to identify the blocked step.", tab: "events",
    });
  }
  const ready = pod.conditions.find((condition) => condition.type === "Ready");
  if (pod.phase === "Running" && ready?.status !== "True") {
    findings.push({
      id: "readiness", title: ready?.status === "False" ? "Pod is running, but not ready" : "Pod readiness is unknown",
      evidence: ready ? `Ready: ${ready.status}${ready.reason ? ` (${ready.reason})` : ""}.${ready.message ? ` ${ready.message}` : ""}` : "Phase: Running; no Ready condition was returned.",
      meaning: "Running describes the Pod's lifecycle, not its readiness to serve traffic. Readiness probes and readiness gates can keep a running Pod unready.",
      next: "Inspect container readiness and probe configuration, then correlate with events and logs.", tab: "containers",
    });
  }
  if (pod.phase === "Failed" || pod.phase === "Unknown") {
    findings.push({ id: "phase", title: `Pod phase: ${pod.phase}`, evidence: `Kubernetes reports phase ${pod.phase}.`, meaning: pod.phase === "Failed" ? "The Pod has finished unsuccessfully. Inspect container termination reasons before concluding why." : "The Pod state could not be determined. Do not treat missing status as healthy.", next: "Inspect termination details and events.", tab: "events" });
  }
  return findings;
}

export type PodTimelineEntry = { id: string; timestamp: string; title: string; detail: string; warning: boolean };

export function podTimeline(pod: K8sPodDetail): PodTimelineEntry[] {
  const entries: PodTimelineEntry[] = pod.events.map((event, index) => ({
    id: `event:${index}`, timestamp: event.lastTimestamp || event.lastSeen,
    title: event.reason, detail: `${event.message}${event.count && event.count > 1 ? ` · ${event.count} occurrences` : ""}`,
    warning: event.type === "Warning",
  }));
  for (const container of [...(pod.initContainers || []), ...pod.containers]) {
    if (container.lastTermination) {
      const last = container.lastTermination;
      entries.push({ id: `previous:${container.name}`, timestamp: last.finishedAt || "", title: `${container.name}: previous termination`, detail: `${last.reason || "Reason unavailable"}${last.exitCode != null ? ` · exit ${last.exitCode}` : ""}${last.message ? ` · ${last.message}` : ""}`, warning: last.exitCode !== 0 });
    }
    if (container.state === "terminated") {
      entries.push({ id: `termination:${container.name}`, timestamp: container.finishedAt || "", title: `${container.name}: terminated`, detail: `${container.reason || "Reason unavailable"}${container.exitCode != null ? ` · exit ${container.exitCode}` : ""}${container.message ? ` · ${container.message}` : ""}`, warning: container.exitCode !== 0 });
    }
  }
  for (const condition of pod.conditions) {
    if (condition.lastTransitionTime) entries.push({ id: `condition:${condition.type}`, timestamp: condition.lastTransitionTime, title: `${condition.type}: ${condition.status}`, detail: [condition.reason, condition.message].filter(Boolean).join(" · ") || "Condition transition", warning: condition.status !== "True" });
  }
  const time = (value: string) => Number.isFinite(Date.parse(value)) ? Date.parse(value) : -Infinity;
  return entries.sort((a, b) => time(b.timestamp) - time(a.timestamp));
}
