import { invoke } from "@tauri-apps/api/core";
import { shq } from "../lib/shellQuote";

export type K8sPod = {
  namespace: string;
  name: string;
  ready: string;
  status: string;
  restarts: string;
  age: string;
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
};

export type K8sPodDetail = {
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
  conditions: { type: string; status: string }[];
  ownerReferences: { kind: string; name: string }[];
  containers: K8sContainer[];
  volumes: string[];
  events: K8sEvent[];
  resources: K8sContainerResources[];
  nodeInfo?: K8sNodeInfo;
  usage?: K8sPodUsage;
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
  capacity: { cpu: string; memory: string; pods: string };
  allocatable: { cpu: string; memory: string; pods: string };
};

export type K8sEvent = {
  lastSeen: string;
  type: string;
  reason: string;
  object: string;
  message: string;
};

type ShellOutput = {
  stdout: string;
  stderr: string;
  exit_code: number | null;
  timed_out: boolean;
  truncated: boolean;
};

async function shell(cmd: string, timeoutSecs = 15): Promise<string> {
  const out = await invoke<ShellOutput>("shell_run_command", {
    command: cmd,
    cwd: null,
    timeout_secs: timeoutSecs,
  });
  if (out.exit_code !== 0) throw new Error(out.stderr || `exit ${out.exit_code ?? "?"}`);
  return out.stdout;
}

function parseContainerStatuses(statuses: any[]): K8sContainer[] {
  return statuses.map((cs) => {
    const stateKey = Object.keys(cs.state || {})[0] || "Unknown";
    const state = cs.state?.[stateKey] || {};
    return {
      name: cs.name,
      image: cs.image,
      ready: cs.ready === true,
      restartCount: cs.restartCount ?? 0,
      state: stateKey,
      reason: state.reason,
      message: state.message,
      startedAt: state.startedAt,
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

export async function getNodeInfo(name: string): Promise<K8sNodeInfo> {
  const [json, statusOut] = await Promise.all([
    shell(`kubectl get node ${shq(name)} -o json`, 15),
    shell(`kubectl top node ${shq(name)} --no-headers`, 10).catch(() => ""),
  ]);
  const n = JSON.parse(json);
  const status = n.status?.conditions?.find((c: any) => c.type === "Ready")?.status === "True" ? "Ready" : "NotReady";
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

export async function getPodUsage(namespace: string, name: string): Promise<K8sPodUsage | null> {
  const out = await shell(
    `kubectl top pod -n ${shq(namespace)} ${shq(name)} --no-headers`,
    10,
  ).catch(() => "");
  if (!out.trim()) return null;
  const parts = out.trim().split(/\s+/);
  return { cpu: parts[1] || "-", memory: parts[2] || "-" };
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

export async function describePod(namespace: string, name: string): Promise<K8sPodDetail> {
  const json = await shell(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o json`, 15);
  const p = JSON.parse(json);
  const metadata = p.metadata || {};
  const spec = p.spec || {};
  const status = p.status || {};
  const ownerReferences = (metadata.ownerReferences || []).map((r: any) => ({
    kind: r.kind,
    name: r.name,
  }));
  const conditions = (status.conditions || []).map((c: any) => ({
    type: c.type,
    status: c.status,
  }));
  const events = await getPodEvents(namespace, name);
  return {
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
    containers: parseContainerStatuses(status.containerStatuses || []),
    volumes: (spec.volumes || []).map((v: any) => v.name),
    events,
    resources: parseResources(spec.containers || []),
  };
}

export async function getPodEvents(namespace: string, name: string): Promise<K8sEvent[]> {
  const out = await shell(
    `kubectl get events -n ${shq(namespace)} --field-selector involvedObject.name=${shq(name)} --no-headers -o custom-columns=LAST:.lastTimestamp,TYPE:.type,REASON:.reason,OBJ:.involvedObject.kind,MSG:.message`,
    15,
  );
  return out
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/\s+/);
      return {
        lastSeen: parts[0] || "",
        type: parts[1] || "",
        reason: parts[2] || "",
        object: parts[3] || "",
        message: parts.slice(4).join(" ") || "",
      };
    });
}

export async function getPodLogs(namespace: string, name: string, container?: string, tail = 200): Promise<string> {
  const containerFlag = container ? ` -c ${shq(container)}` : "";
  return shell(
    `kubectl logs -n ${shq(namespace)} ${shq(name)}${containerFlag} --tail=${tail}`,
    20,
  );
}

export type K8sService = {
  name: string;
  namespace: string;
  clusterIp: string;
  ports: string;
  selector: Record<string, string>;
};

export async function getServicesForPod(namespace: string, podLabels: Record<string, string>): Promise<K8sService[]> {
  const json = await shell(`kubectl get services -n ${shq(namespace)} -o json`, 15);
  const services = JSON.parse(json).items || [];
  return services
    .filter((svc: any) => {
      const selector = svc.spec?.selector || {};
      return Object.entries(selector).every(([k, v]) => podLabels[k] === v);
    })
    .map((svc: any) => ({
      name: svc.metadata?.name || "",
      namespace: svc.metadata?.namespace || namespace,
      clusterIp: svc.spec?.clusterIP || "",
      ports:
        svc.spec?.ports
          ?.map((p: any) => `${p.port}/${p.protocol}`)
          .join(", ") || "",
      selector: svc.spec?.selector || {},
    }));
}

export async function checkKubectl(): Promise<boolean> {
  try {
    await shell("kubectl version --client=true");
    return true;
  } catch {
    return false;
  }
}

export async function currentContext(): Promise<string> {
  return (await shell("kubectl config current-context").catch(() => "")).trim();
}

export async function listContexts(): Promise<string[]> {
  const s = await shell("kubectl config get-contexts -o name").catch(() => "");
  return s.trim().split("\n").filter(Boolean);
}

export const useContext = (ctx: string) => shell(`kubectl config use-context ${shq(ctx)}`);

export async function listPods(): Promise<K8sPod[]> {
  // Shorter timeout: listing all pods across all namespaces can hang on large clusters
  const s = await shell("kubectl get pods -A --no-headers", 8);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return {
        namespace: p[0] ?? "",
        name: p[1] ?? "",
        ready: p[2] ?? "",
        status: p[3] ?? "",
        restarts: p[4] ?? "",
        age: p[5] ?? "",
      };
    });
}
