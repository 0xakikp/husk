import { invoke } from "@tauri-apps/api/core";
import { shq, tokenizeCommand } from "../lib/shellQuote";
import type { K8sConfigSource, K8sReadScope } from "./configSource";
import { CONTROLLER_COLUMNS, parseControllerMetadata, type PodOwnership } from "./podOwnership";

export type K8sPod = {
  namespace: string;
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
  ownership?: PodOwnership;
};

export type K8sContainer = {
  name: string;
  image: string;
  ready: boolean;
  restartCount: number;
  state: string;
  reason?: string;
  message?: string;
  startedAt?: string;
  finishedAt?: string;
  exitCode?: number;
  signal?: number;
  lastTermination?: {
    reason?: string;
    message?: string;
    exitCode?: number;
    signal?: number;
    startedAt?: string;
    finishedAt?: string;
  };
  livenessProbe?: string;
  readinessProbe?: string;
  startupProbe?: string;
};

export type K8sPodDetail = {
  uid?: string;
  namespace: string;
  name: string;
  createdAt: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  node: string;
  ip: string;
  hostIp: string;
  qosClass: string;
  serviceAccount: string;
  restartPolicy: string;
  phase: string;
  conditions: { type: string; status: string; reason?: string; message?: string; lastTransitionTime?: string }[];
  ownerReferences: { kind: string; name: string }[];
  containers: K8sContainer[];
  initContainers?: K8sContainer[];
  volumes: string[];
  events: K8sEvent[];
  eventsError?: string;
  resources: K8sContainerResources[];
  nodeInfo?: K8sNodeInfo;
  usage?: K8sPodUsage;
  yaml: string;
};

export type K8sContainerResources = {
  name: string;
  requests: { cpu?: string; memory?: string; ephemeralStorage?: string };
  limits: { cpu?: string; memory?: string; ephemeralStorage?: string };
};

export type K8sPodUsage = {
  cpu: string;
  memory: string;
};

export type K8sNodeInfo = {
  name: string;
  status: string;
  roles: string;
  age: string;
  version: string;
  internalIp: string;
  externalIp: string;
  osImage: string;
  kernelVersion: string;
  containerRuntime: string;
  architecture: string;
  topCpu: string;
  topMem: string;
  metricsError?: string;
  capacity: { cpu: string; memory: string; pods: string };
  allocatable: { cpu: string; memory: string; pods: string };
};

export type K8sEvent = {
  lastSeen: string;
  type: string;
  reason: string;
  object: string;
  message: string;
  firstSeen?: string;
  lastTimestamp?: string;
  count?: number;
};

export type K8sService = {
  name: string;
  namespace: string;
  type: string;
  clusterIp: string;
  externalIp: string;
  ports: string;
  selector: Record<string, string>;
  age: string;
};

export type K8sIngress = {
  name: string;
  namespace: string;
  hosts: string[];
  class?: string;
  age: string;
  rules: { host?: string; paths: { path: string; service: string; port: string }[] }[];
};

export type K8sDeployment = {
  name: string;
  namespace: string;
  ready: string;
  upToDate: string;
  available: string;
  age: string;
  desired: number;
  current: number;
  strategy: string;
  selector: Record<string, string>;
};

export type K8sReplicaSet = {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  age: string;
  owner?: string;
};

export type K8sStatefulSet = {
  name: string;
  namespace: string;
  ready: string;
  age: string;
  replicas: number;
  serviceName: string;
};

export type K8sDaemonSet = {
  name: string;
  namespace: string;
  desired: number;
  current: number;
  ready: number;
  upToDate: number;
  available: number;
  age: string;
};

export type K8sJob = {
  name: string;
  namespace: string;
  completions: string;
  duration: string;
  age: string;
  status: string;
  selector?: Record<string, string>;
};

export type K8sConfigMap = {
  name: string;
  namespace: string;
  dataKeys: string[];
  age: string;
};

export type K8sSecret = {
  name: string;
  namespace: string;
  type: string;
  dataKeys: string[];
  age: string;
};

export type K8sPersistentVolumeClaim = {
  name: string;
  namespace: string;
  status: string;
  volume: string;
  capacity: string;
  accessModes: string;
  storageClass: string;
  age: string;
};

export type K8sResourceQuota = {
  name: string;
  namespace: string;
  age: string;
  scopes: string;
  limits: string;
};

export type K8sEndpointSlice = {
  name: string;
  addressType: string;
  ports: { name?: string; port: number | null; protocol?: string }[];
  endpoints: {
    addresses: string[];
    ready: boolean | null;
    targetRef?: { kind: string; name: string; namespace?: string };
  }[];
};

export type K8sWorkloadDetail = {
  workload: {
    kind: "replicaset" | "statefulset" | "daemonset";
    name: string;
    namespace: string;
    desired: number;
    current: number;
    ready: number;
    available: number;
    updated: number;
    selector: Record<string, string>;
    selectorText: string;
    ownerReferences: { kind: string; name: string }[];
    conditions: { type: string; status: string; reason?: string; message?: string }[];
    strategy: string;
    serviceName: string;
    age: string;
  };
  pods: K8sPod[];
  podsError?: string;
  yaml: string;
};

export type K8sServiceDetail = {
  service: K8sService;
  endpoints: string[];
  endpointSlices: K8sEndpointSlice[];
  endpointSlicesError?: string;
  pods: K8sPod[];
  podsError?: string;
  selectorText: string;
  yaml: string;
};

type ShellOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

async function shell(cmd: string, timeoutSecs = 15, config?: K8sConfigSource): Promise<string> {
  const tokens = tokenizeCommand(cmd);
  const [program, ...args] = tokens;
  if (!program) throw new Error("empty command");
  const out = config ? await invoke<ShellOutput>("kubernetes_run_command", {
    args,
    kubeconfigPaths: config.paths,
    cwd: config.cwd,
    timeoutSecs,
  }) : await invoke<ShellOutput>("shell_run_command", {
    program,
    args,
    cwd: null,
    timeout_secs: timeoutSecs,
  });
  if (out.timed_out) throw new Error(`kubectl timed out after ${timeoutSecs}s. Check cluster connectivity and try again.`);
  if (out.exit_code !== 0) throw new Error(out.stderr || `exit ${out.exit_code ?? "?"}`);
  if (out.truncated) throw new Error("kubectl output exceeded the local size limit. Narrow the namespace or selection and try again.");
  return out.stdout;
}

/** Bind each read to the inspector's context, never the mutable kubectl default. */
function clusterRead(scope?: K8sReadScope) {
  const context = typeof scope === "object" ? scope.context : scope;
  const config = typeof scope === "object" ? scope.config : undefined;
  return (cmd: string, timeoutSecs = 15) => shell(
    `${cmd}${context ? ` --context=${shq(context)}` : ""} --request-timeout=${timeoutSecs}s`,
    timeoutSecs,
    config,
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nsFlag(namespace: string) {
  return namespace === "_all" ? "--all-namespaces" : `-n ${shq(namespace)}`;
}

type LabelSelector = {
  matchLabels?: Record<string, string>;
  matchExpressions?: { key: string; operator: string; values?: string[] }[];
};

/** Preserve Kubernetes selector semantics, including set-based expressions. */
export function selectorToString(selector?: LabelSelector): string {
  const terms = Object.entries(selector?.matchLabels || {}).map(([key, value]) => `${key}=${value}`);
  for (const expression of selector?.matchExpressions || []) {
    const { key, operator, values = [] } = expression;
    if (operator === "In" || operator === "NotIn") {
      if (!values.length) throw new Error(`Invalid ${operator} selector for ${key}: no values.`);
      terms.push(`${key} ${operator === "In" ? "in" : "notin"} (${values.join(",")})`);
    } else if (operator === "Exists") terms.push(key);
    else if (operator === "DoesNotExist") terms.push(`!${key}`);
    else throw new Error(`Unsupported label selector operator: ${operator}`);
  }
  return terms.join(",");
}

async function podsForSelector(namespace: string, selectorText: string, context?: K8sReadScope): Promise<{ pods: K8sPod[]; podsError?: string }> {
  if (!selectorText) return { pods: [], podsError: "No label selector is available; associated Pods were not queried." };
  try {
    const output = await clusterRead(context)(`kubectl get pods ${nsFlag(namespace)} -l ${shq(selectorText)} --no-headers`, 10);
    return { pods: output.trim().split("\n").filter(Boolean).map((line) => parsePodLine(namespace, line)) };
  } catch (error) {
    return { pods: [], podsError: errorText(error) };
  }
}

/**
 * kubectl only prints a NAMESPACE column with --all-namespaces, so the
 * positional layout of `--no-headers` output differs between the two modes.
 * Splitting a single-namespace line with the all-namespaces indices shifts every
 * field by one — which is how a pod ended up "named" 1/1 (its READY column) and
 * produced `kubectl get pod -n <podname> 1/1`, an error about resource/name form.
 *
 * Normalise both shapes to namespace-first so callers can use one index set.
 */
function nsCols(namespace: string, line: string): string[] {
  const p = line.trim().split(/\s+/);
  return namespace === "_all" ? p : [namespace, ...p];
}

function probeDesc(p: any): string {
  if (!p) return "none";
  const parts: string[] = [];
  if (p.httpGet) parts.push(`HTTP ${p.httpGet.path}:${p.httpGet.port}`);
  if (p.tcpSocket) parts.push(`TCP ${p.tcpSocket.port}`);
  if (p.exec?.command) parts.push(`exec ${p.exec.command.join(" ")}`);
  parts.push(`initial=${p.initialDelaySeconds || 0}s`);
  parts.push(`period=${p.periodSeconds || 10}s`);
  parts.push(`timeout=${p.timeoutSeconds || 1}s`);
  parts.push(`failure=${p.failureThreshold || 3}`);
  return parts.join(", ");
}

function parseContainerStatuses(containerSpec: any[], statuses: any[]): K8sContainer[] {
  return containerSpec.map((c) => {
    const cs = statuses.find((s) => s.name === c.name) || {};
    const stateKey = Object.keys(cs.state || {})[0] || "Unknown";
    const state = cs.state?.[stateKey] || {};
    return {
      name: c.name,
      image: c.image,
      ready: cs.ready === true,
      restartCount: cs.restartCount ?? 0,
      state: stateKey,
      reason: state.reason,
      message: state.message,
      startedAt: state.startedAt,
      finishedAt: state.finishedAt,
      exitCode: state.exitCode,
      signal: state.signal,
      lastTermination: cs.lastState?.terminated,
      livenessProbe: probeDesc(c.livenessProbe),
      readinessProbe: probeDesc(c.readinessProbe),
      startupProbe: probeDesc(c.startupProbe),
    };
  });
}

function parseResources(containerSpec: any[]): K8sContainerResources[] {
  return containerSpec.map((c) => {
    const r = c.resources?.requests || {};
    const l = c.resources?.limits || {};
    return {
      name: c.name,
      requests: {
        cpu: r.cpu,
        memory: r.memory,
        ephemeralStorage: r["ephemeral-storage"],
      },
      limits: {
        cpu: l.cpu,
        memory: l.memory,
        ephemeralStorage: l["ephemeral-storage"],
      },
    };
  });
}

/* ── Read-through cache for list calls ───────────────────────────────────────
   Every kubectl invocation is a process spawn plus an API round trip, so
   re-running one because the user flipped a tab and came back is pure latency.
   Fresh entries are reused briefly. Expired entries wait for revalidation so
   stale evidence and failed refreshes are never presented as current results.
   Concurrent misses for one key share a single call. */

type K8sCacheEntry = { at: number; data: unknown };
const k8sCache = new Map<string, K8sCacheEntry>();
const k8sInflight = new Map<string, Promise<unknown>>();
let k8sCacheGeneration = 0;

/** Called after any mutation (context switch, delete, scale) that invalidates reads. */
export function invalidateK8sCache() {
  k8sCacheGeneration += 1;
  k8sCache.clear();
  k8sInflight.clear();
}

export async function k8sCached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const refresh = (): Promise<T> => {
    const existing = k8sInflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const generation = k8sCacheGeneration;
    const p = load()
      .then((data) => {
        if (generation === k8sCacheGeneration) k8sCache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => {
        if (k8sInflight.get(key) === p) k8sInflight.delete(key);
      });
    k8sInflight.set(key, p);
    return p;
  };

  const hit = k8sCache.get(key) as { at: number; data: T } | undefined;
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  return refresh();
}

export async function listNamespaces(context?: K8sReadScope): Promise<string[]> {
  const shell = clusterRead(context);
  const out = await shell("kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name", 10);
  return out.trim().split("\n").filter(Boolean);
}

export async function checkKubectl(): Promise<boolean> {
  try {
    await shell("kubectl version --client=true");
    return true;
  } catch {
    return false;
  }
}

export async function currentContext(config?: K8sConfigSource): Promise<string> {
  return (await shell("kubectl config current-context", 15, config).catch(() => "")).trim();
}

export async function listContexts(config?: K8sConfigSource): Promise<string[]> {
  const s = await shell("kubectl config get-contexts -o name", 15, config);
  return s.trim().split("\n").filter(Boolean);
}

export const useContext = (ctx: string) => shell(`kubectl config use-context ${shq(ctx)}`);

/**
 * Layout after nsCols(): NAMESPACE NAME READY STATUS RESTARTS… AGE
 *
 * RESTARTS is not always one token — kubectl renders a recent restart as
 * "3 (26h ago)", which is three. Anchoring AGE to the end and treating
 * everything between STATUS and AGE as the restart count keeps every field
 * aligned regardless. Parsed from text rather than -o json on purpose: the Rust
 * shell bridge truncates stdout at 256KB, and a busy namespace's pod JSON
 * exceeds that, which would break JSON.parse outright.
 */
function parsePodLine(namespace: string, line: string): K8sPod {
  const p = nsCols(namespace, line);
  return {
    namespace: p[0] ?? "",
    name: p[1] ?? "",
    ready: p[2] ?? "",
    status: p[3] ?? "",
    restarts: p.length > 5 ? p.slice(4, -1).join(" ") : (p[4] ?? ""),
    age: p.length > 5 ? (p[p.length - 1] ?? "") : "",
  };
}

export async function listPods(namespace: string, context?: K8sReadScope): Promise<K8sPod[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get pods ${nsFlag(namespace)} --no-headers`, 8);
  const pods = s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => parsePodLine(namespace, line));
  if (!pods.length) return pods;

  // One compact metadata read for the entire list; never spawn one read per Pod.
  // Optional ownership evidence must not hide an otherwise readable Pod list.
  try {
    const metadata = parseControllerMetadata(await shell(`kubectl get pods ${nsFlag(namespace)} --no-headers -o ${shq(CONTROLLER_COLUMNS)}`, 8));
    let replicaSets: ReturnType<typeof parseControllerMetadata> | undefined;
    let replicaSetsError: string | undefined;
    const needsReplicaSets = pods.some(pod => metadata.get(`${pod.namespace}/${pod.name}`)?.controller?.kind === "ReplicaSet");
    if (needsReplicaSets) {
      try {
        replicaSets = parseControllerMetadata(await shell(`kubectl get replicasets.apps ${nsFlag(namespace)} --no-headers -o ${shq(CONTROLLER_COLUMNS)}`, 8));
      } catch (error) { replicaSetsError = errorText(error); }
    }
    return pods.map(pod => {
      const record = metadata.get(`${pod.namespace}/${pod.name}`);
      let ownership: PodOwnership;
      if (!record) ownership = { status: "unavailable", error: "This Pod was absent from the controller metadata snapshot. Refresh to check again." };
      else if (!record.controller) ownership = { status: "none" };
      else {
        const owner = record.controller;
        ownership = { status: "controlled", kind: owner.kind, name: owner.name };
        if (owner.kind === "ReplicaSet") {
          const replicaSet = replicaSets?.get(`${pod.namespace}/${owner.name}`);
          // Name alone is insufficient: a deleted ReplicaSet may have been
          // recreated with another UID. Never infer Deployment from a name.
          if (replicaSet?.uid === owner.uid && replicaSet.controller?.kind === "Deployment") {
            ownership = { status: "controlled", kind: "Deployment", name: replicaSet.controller.name, via: owner.name };
          } else if (replicaSetsError) ownership.note = `Deployment lookup unavailable: ${replicaSetsError}`;
          else if (!replicaSet || replicaSet.uid !== owner.uid) ownership.note = "The referenced ReplicaSet could not be verified in this snapshot.";
        }
      }
      return { ...pod, ownership };
    });
  } catch (error) {
    return pods.map(pod => ({ ...pod, ownership: { status: "unavailable", error: errorText(error) } }));
  }
}

export async function describePod(namespace: string, name: string, context?: K8sReadScope): Promise<K8sPodDetail> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const p = JSON.parse(json);
  const metadata = p.metadata || {};
  const spec = p.spec || {};
  const status = p.status || {};
  let events: K8sEvent[] = [];
  let eventsError: string | undefined;
  try {
    if (!metadata.uid) throw new Error("Pod UID unavailable; events cannot be tied to this Pod instance.");
    events = await readPodEvents(namespace, name, metadata.uid, context);
  } catch (error) {
    eventsError = errorText(error);
  }
  const ownerReferences = (metadata.ownerReferences || []).map((r: any) => ({
    kind: r.kind,
    name: r.name,
  }));
  const conditions = (status.conditions || []).map((c: any) => ({
    type: c.type,
    status: c.status,
    reason: c.reason,
    message: c.message,
    lastTransitionTime: c.lastTransitionTime,
  }));
  return {
    uid: metadata.uid,
    namespace: metadata.namespace || namespace,
    name: metadata.name || name,
    createdAt: metadata.creationTimestamp || "",
    labels: metadata.labels || {},
    annotations: metadata.annotations || {},
    node: spec.nodeName || "",
    ip: status.podIP || "",
    hostIp: status.hostIP || "",
    qosClass: status.qosClass || "",
    serviceAccount: spec.serviceAccountName || "",
    restartPolicy: spec.restartPolicy || "",
    phase: status.phase || "Unknown",
    conditions,
    ownerReferences,
    containers: parseContainerStatuses(spec.containers || [], status.containerStatuses || []),
    initContainers: parseContainerStatuses(spec.initContainers || [], status.initContainerStatuses || []),
    volumes: (spec.volumes || []).map((v: any) => v.name),
    events,
    eventsError,
    resources: parseResources([...(spec.initContainers || []), ...(spec.containers || [])]),
    yaml,
  };
}

export async function getPodEvents(namespace: string, name: string, context?: K8sReadScope): Promise<K8sEvent[]> {
  const json = await clusterRead(context)(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o json`, 10);
  const uid = JSON.parse(json).metadata?.uid;
  if (!uid) throw new Error("Pod UID unavailable; events cannot be tied to this Pod instance.");
  return readPodEvents(namespace, name, uid, context);
}

async function readPodEvents(namespace: string, name: string, uid: string, context?: K8sReadScope): Promise<K8sEvent[]> {
  const shell = clusterRead(context);
  const out = await shell(
    `kubectl get events -n ${shq(namespace)} --field-selector ${shq(`involvedObject.uid=${uid},involvedObject.kind=Pod`)} -o json`,
    15,
  );
  return (JSON.parse(out).items || [])
    .filter((event: any) => event.involvedObject?.uid === uid)
    .map((event: any) => {
      const lastTimestamp = event.series?.lastObservedTime || event.lastTimestamp || event.eventTime || event.metadata?.creationTimestamp || "";
      return {
        lastSeen: lastTimestamp,
        lastTimestamp,
        firstSeen: event.firstTimestamp || event.eventTime || event.metadata?.creationTimestamp || "",
        count: event.series?.count ?? event.count ?? 1,
        type: event.type || "",
        reason: event.reason || "",
        object: `${event.involvedObject?.kind || "Pod"}/${event.involvedObject?.name || name}`,
        message: event.message || "",
      };
    }).sort((a: K8sEvent, b: K8sEvent) => a.lastSeen.localeCompare(b.lastSeen));
}

export async function getPodLogs(namespace: string, name: string, container?: string, tail = 200, options: { previous?: boolean; timestamps?: boolean; context?: K8sReadScope } = {}): Promise<string> {
  const shell = clusterRead(options.context);
  const containerFlag = container ? ` -c ${shq(container)}` : "";
  const boundedTail = Number.isFinite(tail) ? Math.max(1, Math.min(5000, Math.floor(tail))) : 200;
  return shell(
    `kubectl logs -n ${shq(namespace)} ${shq(name)}${containerFlag} --tail=${boundedTail}${options.previous ? " --previous=true" : ""}${options.timestamps ? " --timestamps=true" : ""}`,
    20,
  );
}

export async function getPodUsage(namespace: string, name: string, context?: K8sReadScope): Promise<K8sPodUsage | null> {
  const shell = clusterRead(context);
  const out = await shell(
    `kubectl top pod -n ${shq(namespace)} ${shq(name)} --no-headers`,
    10,
  );
  if (!out.trim()) return null;
  const parts = out.trim().split(/\s+/);
  return { cpu: parts[1] || "-", memory: parts[2] || "-" };
}

export async function getNodeInfo(name: string, context?: K8sReadScope): Promise<K8sNodeInfo> {
  const shell = clusterRead(context);
  let metricsError: string | undefined;
  const [json, statusOut] = await Promise.all([
    shell(`kubectl get node ${shq(name)} -o json`, 15),
    shell(`kubectl top node ${shq(name)} --no-headers`, 10).catch((error) => { metricsError = errorText(error); return ""; }),
  ]);
  const n = JSON.parse(json);
  const ready = n.status?.conditions?.find((c: any) => c.type === "Ready")?.status;
  const status = ready === "True" ? "Ready" : ready === "False" ? "NotReady" : "Unknown";
  const addresses = (n.status?.addresses || []) as { type: string; address: string }[];
  const internalIp = addresses.find((a) => a.type === "InternalIP")?.address || "";
  const externalIp = addresses.find((a) => a.type === "ExternalIP")?.address || "";
  const roles = Object.keys(n.metadata?.labels || {}).filter((k) => k.startsWith("node-role.kubernetes.io/")).map((k) => k.split("/")[1]).join(", ") || "none";
  const topParts = statusOut.trim().split(/\s+/);
  const topCpu = topParts[1] || "-";
  const topMem = topParts[3] || "-";
  return {
    name: n.metadata?.name || name,
    status,
    roles,
    age: n.metadata?.creationTimestamp ? podAgeFromDate(n.metadata.creationTimestamp) : "",
    version: n.status?.nodeInfo?.kubeletVersion || "",
    internalIp,
    externalIp,
    osImage: n.status?.nodeInfo?.osImage || "",
    kernelVersion: n.status?.nodeInfo?.kernelVersion || "",
    containerRuntime: n.status?.nodeInfo?.containerRuntimeVersion || "",
    architecture: n.status?.nodeInfo?.architecture || "",
    topCpu,
    topMem,
    metricsError,
    capacity: {
      cpu: n.status?.capacity?.cpu || "",
      memory: n.status?.capacity?.memory || "",
      pods: n.status?.capacity?.pods || "",
    },
    allocatable: {
      cpu: n.status?.allocatable?.cpu || "",
      memory: n.status?.allocatable?.memory || "",
      pods: n.status?.allocatable?.pods || "",
    },
  };
}

export async function getServicesForPod(namespace: string, podLabels: Record<string, string>, context?: K8sReadScope): Promise<K8sService[]> {
  const shell = clusterRead(context);
  const json = await shell(`kubectl get services -n ${shq(namespace)} -o json`, 15);
  const services = JSON.parse(json).items || [];
  return services
    .filter((svc: any) => {
      const selector = svc.spec?.selector || {};
      return Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => podLabels[k] === v);
    })
    .map((svc: any) => ({
      name: svc.metadata?.name || "",
      namespace: svc.metadata?.namespace || namespace,
      type: svc.spec?.type || "ClusterIP",
      clusterIp: svc.spec?.clusterIP || "",
      externalIp: (svc.status?.loadBalancer?.ingress?.[0]?.ip || svc.status?.loadBalancer?.ingress?.[0]?.hostname || "") as string,
      ports: svc.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(", ") || "",
      selector: svc.spec?.selector || {},
      age: "",
    }));
}

export async function listServices(namespace: string, context?: K8sReadScope): Promise<K8sService[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get services ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return {
        namespace: p[0] ?? "",
        name: p[1] ?? "",
        type: p[2] ?? "",
        clusterIp: p[3] ?? "",
        externalIp: p[4] ?? "",
        ports: p[5] ?? "",
        selector: {},
        age: p[6] ?? "",
      };
    });
}

export async function describeService(namespace: string, name: string, context?: K8sReadScope): Promise<K8sServiceDetail> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get service -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get service -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const svc = JSON.parse(json);
  const selectorText = selectorToString({ matchLabels: svc.spec?.selector });
  let endpointSlices: K8sEndpointSlice[] = [];
  let endpointSlicesError: string | undefined;
  const [association] = await Promise.all([
    selectorText ? podsForSelector(namespace, selectorText, context) : Promise.resolve({ pods: [] as K8sPod[] }),
    shell(`kubectl get endpointslices.discovery.k8s.io -n ${shq(namespace)} -l ${shq(`kubernetes.io/service-name=${name}`)} -o json`, 10)
      .then((output) => {
        endpointSlices = (JSON.parse(output).items || []).map((slice: any) => ({
          name: slice.metadata?.name || "",
          addressType: slice.addressType || "",
          ports: (slice.ports || []).map((port: any) => ({ name: port.name, port: port.port ?? null, protocol: port.protocol })),
          endpoints: (slice.endpoints || []).map((endpoint: any) => ({
            addresses: endpoint.addresses || [],
            ready: endpoint.conditions?.ready ?? null,
            targetRef: endpoint.targetRef ? { kind: endpoint.targetRef.kind, name: endpoint.targetRef.name, namespace: endpoint.targetRef.namespace } : undefined,
          })),
        }));
      }).catch((error) => { endpointSlicesError = errorText(error); }),
  ]);
  const endpoints = endpointSlices.flatMap((slice) => slice.endpoints
    .filter((endpoint) => endpoint.ready !== false)
    .flatMap((endpoint) => endpoint.addresses.map((address) => `${address}:${slice.ports.map((port) => port.port ?? "?").join(",")}`)));
  return {
    service: {
      name: svc.metadata?.name || name,
      namespace: svc.metadata?.namespace || namespace,
      type: svc.spec?.type || "ClusterIP",
      clusterIp: svc.spec?.clusterIP || "",
      externalIp: (svc.status?.loadBalancer?.ingress?.[0]?.ip || svc.status?.loadBalancer?.ingress?.[0]?.hostname || "") as string,
      ports: svc.spec?.ports?.map((p: any) => `${p.port}/${p.protocol} → ${p.targetPort}`).join(", ") || "",
      selector: svc.spec?.selector || {},
      age: svc.metadata?.creationTimestamp ? podAgeFromDate(svc.metadata.creationTimestamp) : "",
    },
    endpoints,
    endpointSlices,
    endpointSlicesError,
    ...association,
    selectorText,
    yaml,
  };
}

export async function listIngresses(namespace: string, context?: K8sReadScope): Promise<K8sIngress[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get ingress ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return {
        namespace: p[0] ?? "",
        name: p[1] ?? "",
        hosts: (p[2] ?? "").split(",").filter(Boolean),
        class: p[3] ?? "",
        age: p[4] ?? "",
        rules: [],
      };
    });
}

export async function describeIngress(namespace: string, name: string, context?: K8sReadScope): Promise<{ ingress: K8sIngress; yaml: string }> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get ingress -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get ingress -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const i = JSON.parse(json);
  const rules = (i.spec?.rules || []).map((r: any) => ({
    host: r.host,
    paths: (r.http?.paths || []).map((p: any) => ({
      path: p.path || "/",
      service: p.backend?.service?.name || p.backend?.resource?.name || "-",
      port: String(p.backend?.service?.port?.number || p.backend?.service?.port?.name || "-"),
    })),
  }));
  return {
    ingress: {
      name: i.metadata?.name || name,
      namespace: i.metadata?.namespace || namespace,
      hosts: rules.flatMap((r: any) => (r.host ? [r.host] : [])),
      class: i.spec?.ingressClassName || "",
      age: i.metadata?.creationTimestamp ? podAgeFromDate(i.metadata.creationTimestamp) : "",
      rules,
    },
    yaml,
  };
}

export async function listDeployments(namespace: string, context?: K8sReadScope): Promise<K8sDeployment[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get deployments ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return {
        namespace: p[0] ?? "",
        name: p[1] ?? "",
        ready: p[2] ?? "",
        upToDate: p[3] ?? "",
        available: p[4] ?? "",
        age: p[5] ?? "",
        desired: parseInt((p[2] || "0/0").split("/")[1], 10) || 0,
        current: parseInt(p[3] || "0", 10) || 0,
        strategy: "",
        selector: {},
      };
    });
}

export async function describeDeployment(namespace: string, name: string, context?: K8sReadScope): Promise<{
  deployment: K8sDeployment & { selectorText: string };
  pods: K8sPod[];
  podsError?: string;
  replicaSets: K8sReplicaSet[];
  replicaSetsError?: string;
  yaml: string;
}> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get deployment -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get deployment -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const d = JSON.parse(json);
  const selector = d.spec?.selector?.matchLabels || {};
  const selectorText = selectorToString(d.spec?.selector);
  let replicaSets: K8sReplicaSet[] = [];
  let replicaSetsError: string | undefined;
  const [association] = await Promise.all([
    podsForSelector(namespace, selectorText, context),
    (async () => {
      try {
        if (!selectorText || !d.metadata?.uid) throw new Error("Deployment selector or UID unavailable; ReplicaSet ownership cannot be verified.");
        const output = await shell(`kubectl get replicasets -n ${shq(namespace)} -l ${shq(selectorText)} -o json`, 10);
        replicaSets = (JSON.parse(output).items || [])
          .filter((rs: any) => (rs.metadata?.ownerReferences || []).some((owner: any) => owner.uid === d.metadata.uid && owner.kind === "Deployment"))
          .map((rs: any) => ({
            name: rs.metadata?.name || "", namespace: rs.metadata?.namespace || namespace,
            desired: rs.spec?.replicas ?? 0, current: rs.status?.replicas ?? 0, ready: rs.status?.readyReplicas ?? 0,
            owner: name, age: rs.metadata?.creationTimestamp ? podAgeFromDate(rs.metadata.creationTimestamp) : "",
          }));
      } catch (error) { replicaSetsError = errorText(error); }
    })(),
  ]);
  return {
    deployment: {
      name: d.metadata?.name || name,
      namespace: d.metadata?.namespace || namespace,
      ready: `${d.status?.readyReplicas || 0}/${d.spec?.replicas || 0}`,
      upToDate: String(d.status?.updatedReplicas || 0),
      available: String(d.status?.availableReplicas || 0),
      age: d.metadata?.creationTimestamp ? podAgeFromDate(d.metadata.creationTimestamp) : "",
      desired: d.spec?.replicas || 0,
      current: d.status?.replicas || 0,
      strategy: d.spec?.strategy?.type || "RollingUpdate",
      selector,
      selectorText,
    },
    ...association,
    replicaSets,
    replicaSetsError,
    yaml,
  };
}

export async function listReplicaSets(namespace: string, context?: K8sReadScope): Promise<K8sReplicaSet[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get replicasets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", desired: parseInt(p[2] || "0", 10), current: parseInt(p[3] || "0", 10), ready: parseInt(p[4] || "0", 10), age: p[5] ?? "", owner: "" };
    });
}

export async function listStatefulSets(namespace: string, context?: K8sReadScope): Promise<K8sStatefulSet[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get statefulsets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", ready: p[2] ?? "", age: p[3] ?? "", replicas: parseInt((p[2] || "0/0").split("/")[1], 10) || 0, serviceName: "" };
    });
}

export async function listDaemonSets(namespace: string, context?: K8sReadScope): Promise<K8sDaemonSet[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get daemonsets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", desired: parseInt(p[2] || "0", 10), current: parseInt(p[3] || "0", 10), ready: parseInt(p[4] || "0", 10), upToDate: parseInt(p[5] || "0", 10), available: parseInt(p[6] || "0", 10), age: p[7] ?? "" };
    });
}

export async function describeWorkload(kind: "replicaset" | "statefulset" | "daemonset", namespace: string, name: string, context?: K8sReadScope): Promise<K8sWorkloadDetail> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get ${kind} -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get ${kind} -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const resource = JSON.parse(json);
  const spec = resource.spec || {};
  const status = resource.status || {};
  const daemon = kind === "daemonset";
  const selectorText = selectorToString(spec.selector);
  return {
    workload: {
      kind, name: resource.metadata?.name || name, namespace: resource.metadata?.namespace || namespace,
      desired: daemon ? (status.desiredNumberScheduled ?? 0) : (spec.replicas ?? 0),
      current: daemon ? (status.currentNumberScheduled ?? 0) : (status.replicas ?? 0),
      ready: daemon ? (status.numberReady ?? 0) : (status.readyReplicas ?? 0),
      available: daemon ? (status.numberAvailable ?? 0) : (status.availableReplicas ?? status.readyReplicas ?? 0),
      updated: daemon ? (status.updatedNumberScheduled ?? 0) : (status.updatedReplicas ?? status.replicas ?? 0),
      selector: spec.selector?.matchLabels || {}, selectorText,
      ownerReferences: (resource.metadata?.ownerReferences || []).map((owner: any) => ({ kind: owner.kind, name: owner.name })),
      conditions: (status.conditions || []).map((condition: any) => ({ type: condition.type, status: condition.status, reason: condition.reason, message: condition.message })),
      strategy: spec.updateStrategy?.type || "", serviceName: spec.serviceName || "",
      age: resource.metadata?.creationTimestamp ? podAgeFromDate(resource.metadata.creationTimestamp) : "",
    },
    ...await podsForSelector(namespace, selectorText, context),
    yaml,
  };
}

export async function listJobs(namespace: string, context?: K8sReadScope): Promise<K8sJob[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get jobs ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", completions: p[2] ?? "", duration: p[3] ?? "", age: p[4] ?? "", status: p[5] ?? "" };
    });
}

export async function describeJob(namespace: string, name: string, context?: K8sReadScope): Promise<{ job: K8sJob & { selector: Record<string, string> }; pods: K8sPod[]; podsError?: string; yaml: string }> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get job -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get job -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const j = JSON.parse(json);
  const selector = j.spec?.selector?.matchLabels || {};
  const association = await podsForSelector(namespace, selectorToString(j.spec?.selector), context);
  return {
    job: {
      name: j.metadata?.name || name,
      namespace: j.metadata?.namespace || namespace,
      completions: `${j.status?.succeeded || 0}/${j.spec?.completions || "?"}`,
      duration: "",
      age: j.metadata?.creationTimestamp ? podAgeFromDate(j.metadata.creationTimestamp) : "",
      status: (j.status?.conditions || []).some((condition: any) => condition.type === "Failed" && condition.status === "True") ? "Failed"
        : (j.status?.conditions || []).some((condition: any) => condition.type === "Complete" && condition.status === "True") ? "Complete" : "Running",
      selector,
    },
    ...association,
    yaml,
  };
}

export async function listConfigMaps(namespace: string, context?: K8sReadScope): Promise<K8sConfigMap[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get configmaps ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", dataKeys: (p[2] ?? "0").split(",").filter(Boolean), age: p[3] ?? "" };
    });
}

export async function describeConfigMap(namespace: string, name: string, context?: K8sReadScope): Promise<{ configMap: K8sConfigMap; data: Record<string, string>; yaml: string }> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get configmap -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get configmap -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const cm = JSON.parse(json);
  const data = cm.data || {};
  return {
    configMap: {
      name: cm.metadata?.name || name,
      namespace: cm.metadata?.namespace || namespace,
      dataKeys: Object.keys(data),
      age: cm.metadata?.creationTimestamp ? podAgeFromDate(cm.metadata.creationTimestamp) : "",
    },
    data,
    yaml,
  };
}

export async function listSecrets(namespace: string, context?: K8sReadScope): Promise<K8sSecret[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get secrets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", type: p[2] ?? "", dataKeys: (p[3] ?? "0").split(",").filter(Boolean), age: p[4] ?? "" };
    });
}

export async function describeSecret(namespace: string, name: string, context?: K8sReadScope): Promise<{ secret: K8sSecret; keys: string[]; yaml: string }> {
  const shell = clusterRead(context);
  const json = await shell(`kubectl get secret -n ${shq(namespace)} ${shq(name)} -o json`, 15);
  const s = JSON.parse(json);
  const keys = [...new Set([...Object.keys(s.data || {}), ...Object.keys(s.stringData || {})])];
  // Build an allowlisted projection rather than redacting known keys in-place:
  // last-applied annotations and arbitrary fields can contain a second copy of values.
  // JSON is a YAML subset and avoids needing to parse/re-emit raw Secret YAML.
  const yaml = "# Redacted Secret. Values, annotations and other metadata are hidden.\n" + JSON.stringify({
    apiVersion: s.apiVersion || "v1", kind: "Secret",
    metadata: { name: s.metadata?.name || name, namespace: s.metadata?.namespace || namespace },
    type: s.type || "Opaque",
    data: Object.fromEntries(keys.map((key) => [key, "[REDACTED]"])),
  }, null, 2);
  return {
    secret: {
      name: s.metadata?.name || name,
      namespace: s.metadata?.namespace || namespace,
      type: s.type || "Opaque",
      dataKeys: keys,
      age: s.metadata?.creationTimestamp ? podAgeFromDate(s.metadata.creationTimestamp) : "",
    },
    keys,
    yaml,
  };
}

/** Fetch raw values only after explicit reveal in the Secret inspector. Never cached. */
export async function getSecretYaml(namespace: string, name: string, context?: K8sReadScope): Promise<string> {
  return clusterRead(context)(`kubectl get secret -n ${shq(namespace)} ${shq(name)} -o yaml`, 15);
}

export async function listPersistentVolumeClaims(namespace: string, context?: K8sReadScope): Promise<K8sPersistentVolumeClaim[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get pvc ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", status: p[2] ?? "", volume: p[3] ?? "", capacity: p[4] ?? "", accessModes: p[5] ?? "", storageClass: p[6] ?? "", age: p[7] ?? "" };
    });
}

export async function describePersistentVolumeClaim(namespace: string, name: string, context?: K8sReadScope): Promise<{ pvc: K8sPersistentVolumeClaim; yaml: string }> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get pvc -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get pvc -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const p = JSON.parse(json);
  return {
    pvc: {
      name: p.metadata?.name || name,
      namespace: p.metadata?.namespace || namespace,
      status: p.status?.phase || "",
      volume: p.spec?.volumeName || "",
      capacity: p.status?.capacity?.storage || "",
      accessModes: (p.spec?.accessModes || []).join(", "),
      storageClass: p.spec?.storageClassName || "",
      age: p.metadata?.creationTimestamp ? podAgeFromDate(p.metadata.creationTimestamp) : "",
    },
    yaml,
  };
}

export async function listResourceQuotas(namespace: string, context?: K8sReadScope): Promise<K8sResourceQuota[]> {
  const shell = clusterRead(context);
  const s = await shell(`kubectl get resourcequota ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = nsCols(namespace, line);
      return { namespace: p[0] ?? "", name: p[1] ?? "", age: p[2] ?? "", scopes: p[3] ?? "", limits: p[4] ?? "" };
    });
}

export async function describeResourceQuota(namespace: string, name: string, context?: K8sReadScope): Promise<{ quota: K8sResourceQuota; hard: Record<string, string>; used: Record<string, string>; yaml: string }> {
  const shell = clusterRead(context);
  const [json, yaml] = await Promise.all([
    shell(`kubectl get resourcequota -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get resourcequota -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const q = JSON.parse(json);
  return {
    quota: {
      name: q.metadata?.name || name,
      namespace: q.metadata?.namespace || namespace,
      age: q.metadata?.creationTimestamp ? podAgeFromDate(q.metadata.creationTimestamp) : "",
      scopes: (q.spec?.scopes || []).join(", ") || "",
      limits: "",
    },
    hard: q.status?.hard || {},
    used: q.status?.used || {},
    yaml,
  };
}

function podAgeFromDate(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

export async function getResourceYaml(namespace: string, kind: string, name: string, context?: K8sReadScope): Promise<string> {
  if (/^secrets?(?:\.v1)?$/i.test(kind)) return (await describeSecret(namespace, name, context)).yaml;
  if (!/^[a-z][a-z0-9.-]*$/i.test(kind)) throw new Error("Invalid resource kind.");
  return clusterRead(context)(`kubectl get ${shq(kind)} -n ${shq(namespace)} ${shq(name)} -o yaml`, 15);
}
