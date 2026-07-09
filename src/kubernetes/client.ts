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
  livenessProbe?: string;
  readinessProbe?: string;
  startupProbe?: string;
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

function nsFlag(namespace: string) {
  return namespace === "_all" ? "--all-namespaces" : `-n ${shq(namespace)}`;
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

export async function listNamespaces(): Promise<string[]> {
  const out = await shell("kubectl get namespaces --no-headers -o custom-columns=NAME:.metadata.name", 10).catch(() => "");
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

export async function currentContext(): Promise<string> {
  return (await shell("kubectl config current-context").catch(() => "")).trim();
}

export async function listContexts(): Promise<string[]> {
  const s = await shell("kubectl config get-contexts -o name").catch(() => "");
  return s.trim().split("\n").filter(Boolean);
}

export const useContext = (ctx: string) => shell(`kubectl config use-context ${shq(ctx)}`);

export async function listPods(namespace: string): Promise<K8sPod[]> {
  const s = await shell(`kubectl get pods ${nsFlag(namespace)} --no-headers`, 8);
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

export async function describePod(namespace: string, name: string): Promise<K8sPodDetail> {
  const [json, yaml, events] = await Promise.all([
    shell(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get pod -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
    getPodEvents(namespace, name),
  ]);
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
    containers: parseContainerStatuses(spec.containers || [], status.containerStatuses || []),
    volumes: (spec.volumes || []).map((v: any) => v.name),
    events,
    resources: parseResources(spec.containers || []),
    yaml,
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

export async function getPodUsage(namespace: string, name: string): Promise<K8sPodUsage | null> {
  const out = await shell(
    `kubectl top pod -n ${shq(namespace)} ${shq(name)} --no-headers`,
    10,
  ).catch(() => "");
  if (!out.trim()) return null;
  const parts = out.trim().split(/\s+/);
  return { cpu: parts[1] || "-", memory: parts[2] || "-" };
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
      type: svc.spec?.type || "ClusterIP",
      clusterIp: svc.spec?.clusterIP || "",
      externalIp: (svc.status?.loadBalancer?.ingress?.[0]?.ip || svc.status?.loadBalancer?.ingress?.[0]?.hostname || "") as string,
      ports: svc.spec?.ports?.map((p: any) => `${p.port}/${p.protocol}`).join(", ") || "",
      selector: svc.spec?.selector || {},
      age: "",
    }));
}

export async function listServices(namespace: string): Promise<K8sService[]> {
  const s = await shell(`kubectl get services ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
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

export async function describeService(namespace: string, name: string): Promise<{ service: K8sService; endpoints: string[]; yaml: string }> {
  const [json, epOut, yaml] = await Promise.all([
    shell(`kubectl get service -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get endpoints -n ${shq(namespace)} ${shq(name)} -o json`, 10).catch(() => "{}"),
    shell(`kubectl get service -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const svc = JSON.parse(json);
  const ep = JSON.parse(epOut);
  const endpoints = (ep.subsets || []).flatMap((sub: any) => (sub.addresses || []).map((a: any) => `${a.ip}:${(sub.ports || []).map((p: any) => p.port).join(",")}`));
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
    yaml,
  };
}

export async function listIngresses(namespace: string): Promise<K8sIngress[]> {
  const s = await shell(`kubectl get ingress ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
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

export async function describeIngress(namespace: string, name: string): Promise<{ ingress: K8sIngress; yaml: string }> {
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

export async function listDeployments(namespace: string): Promise<K8sDeployment[]> {
  const s = await shell(`kubectl get deployments ${nsFlag(namespace)} --no-headers`, 10);
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
        upToDate: p[3] ?? "",
        available: p[4] ?? "",
        age: p[5] ?? "",
        desired: parseInt(p[6] || "0", 10) || 0,
        current: parseInt(p[7] || "0", 10) || 0,
        strategy: "",
        selector: {},
      };
    });
}

export async function describeDeployment(namespace: string, name: string): Promise<{ deployment: K8sDeployment & { strategy: string; selector: Record<string, string> }; pods: K8sPod[]; yaml: string }> {
  const [json, podOut, yaml] = await Promise.all([
    shell(`kubectl get deployment -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get pods ${nsFlag(namespace)} -l app=${shq(name)} --no-headers`, 10).catch(() => ""),
    shell(`kubectl get deployment -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const d = JSON.parse(json);
  const selector = d.spec?.selector?.matchLabels || {};
  const pods = podOut
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", ready: p[2] ?? "", status: p[3] ?? "", restarts: p[4] ?? "", age: p[5] ?? "" };
    });
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
    },
    pods,
    yaml,
  };
}

export async function listReplicaSets(namespace: string): Promise<K8sReplicaSet[]> {
  const s = await shell(`kubectl get replicasets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", desired: parseInt(p[2] || "0", 10), current: parseInt(p[3] || "0", 10), ready: parseInt(p[4] || "0", 10), age: p[5] ?? "", owner: "" };
    });
}

export async function listStatefulSets(namespace: string): Promise<K8sStatefulSet[]> {
  const s = await shell(`kubectl get statefulsets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", ready: p[2] ?? "", age: p[3] ?? "", replicas: parseInt(p[4] || "0", 10), serviceName: "" };
    });
}

export async function listDaemonSets(namespace: string): Promise<K8sDaemonSet[]> {
  const s = await shell(`kubectl get daemonsets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", desired: parseInt(p[2] || "0", 10), current: parseInt(p[3] || "0", 10), ready: parseInt(p[4] || "0", 10), upToDate: parseInt(p[5] || "0", 10), available: parseInt(p[6] || "0", 10), age: p[7] ?? "" };
    });
}

export async function listJobs(namespace: string): Promise<K8sJob[]> {
  const s = await shell(`kubectl get jobs ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", completions: p[2] ?? "", duration: p[3] ?? "", age: p[4] ?? "", status: p[5] ?? "" };
    });
}

export async function describeJob(namespace: string, name: string): Promise<{ job: K8sJob & { selector: Record<string, string> }; pods: K8sPod[]; yaml: string }> {
  const [json, podOut, yaml] = await Promise.all([
    shell(`kubectl get job -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get pods ${nsFlag(namespace)} --no-headers | grep ${shq(name)}`, 10).catch(() => ""),
    shell(`kubectl get job -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const j = JSON.parse(json);
  const selector = j.spec?.selector?.matchLabels || {};
  const pods = podOut
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", ready: p[2] ?? "", status: p[3] ?? "", restarts: p[4] ?? "", age: p[5] ?? "" };
    });
  return {
    job: {
      name: j.metadata?.name || name,
      namespace: j.metadata?.namespace || namespace,
      completions: `${j.status?.succeeded || 0}/${j.spec?.completions || "?"}`,
      duration: "",
      age: j.metadata?.creationTimestamp ? podAgeFromDate(j.metadata.creationTimestamp) : "",
      status: j.status?.succeeded === j.spec?.completions ? "Complete" : "Running",
      selector,
    },
    pods,
    yaml,
  };
}

export async function listConfigMaps(namespace: string): Promise<K8sConfigMap[]> {
  const s = await shell(`kubectl get configmaps ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", dataKeys: (p[2] ?? "0").split(",").filter(Boolean), age: p[3] ?? "" };
    });
}

export async function describeConfigMap(namespace: string, name: string): Promise<{ configMap: K8sConfigMap; data: Record<string, string>; yaml: string }> {
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

export async function listSecrets(namespace: string): Promise<K8sSecret[]> {
  const s = await shell(`kubectl get secrets ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", type: p[2] ?? "", dataKeys: (p[3] ?? "0").split(",").filter(Boolean), age: p[4] ?? "" };
    });
}

export async function describeSecret(namespace: string, name: string): Promise<{ secret: K8sSecret; keys: string[]; yaml: string }> {
  const [json, yaml] = await Promise.all([
    shell(`kubectl get secret -n ${shq(namespace)} ${shq(name)} -o json`, 15),
    shell(`kubectl get secret -n ${shq(namespace)} ${shq(name)} -o yaml`, 15),
  ]);
  const s = JSON.parse(json);
  const keys = Object.keys(s.data || {});
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

export async function listPersistentVolumeClaims(namespace: string): Promise<K8sPersistentVolumeClaim[]> {
  const s = await shell(`kubectl get pvc ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", status: p[2] ?? "", volume: p[3] ?? "", capacity: p[4] ?? "", accessModes: p[5] ?? "", storageClass: p[6] ?? "", age: p[7] ?? "" };
    });
}

export async function describePersistentVolumeClaim(namespace: string, name: string): Promise<{ pvc: K8sPersistentVolumeClaim; yaml: string }> {
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

export async function listResourceQuotas(namespace: string): Promise<K8sResourceQuota[]> {
  const s = await shell(`kubectl get resourcequota ${nsFlag(namespace)} --no-headers`, 10);
  return s
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const p = line.split(/\s+/);
      return { namespace: p[0] ?? "", name: p[1] ?? "", age: p[2] ?? "", scopes: p[3] ?? "", limits: p[4] ?? "" };
    });
}

export async function describeResourceQuota(namespace: string, name: string): Promise<{ quota: K8sResourceQuota; hard: Record<string, string>; used: Record<string, string>; yaml: string }> {
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

export async function getResourceYaml(namespace: string, kind: string, name: string): Promise<string> {
  return shell(`kubectl get ${kind} -n ${shq(namespace)} ${shq(name)} -o yaml`, 15);
}
