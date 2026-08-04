import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkKubectl,
  currentContext,
  listContexts,
  useContext,
  listNamespaces,
  listPods,
  listServices,
  listIngresses,
  listDeployments,
  listReplicaSets,
  listStatefulSets,
  listDaemonSets,
  listJobs,
  listConfigMaps,
  listSecrets,
  listPersistentVolumeClaims,
  listResourceQuotas,
  k8sCached,
  invalidateK8sCache,
  type K8sPod,
  type K8sService,
  type K8sIngress,
  type K8sDeployment,
  type K8sReplicaSet,
  type K8sStatefulSet,
  type K8sDaemonSet,
  type K8sJob,
  type K8sConfigMap,
  type K8sSecret,
  type K8sPersistentVolumeClaim,
  type K8sResourceQuota,
} from "./client";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import { Spinner, LoadingRow } from "@/components/Spinner";
import {
  Database01Icon,
  Refresh01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";

export type K8sResourceKind =
  | "pods"
  | "workloads"
  | "services"
  | "ingresses"
  | "config"
  | "storage"
  | "jobs"
  | "quotas";

export type K8sResourceSelection =
  | { kind: "pod"; namespace: string; name: string }
  | { kind: "service"; namespace: string; name: string }
  | { kind: "ingress"; namespace: string; name: string }
  | { kind: "deployment"; namespace: string; name: string }
  | { kind: "replicaset"; namespace: string; name: string }
  | { kind: "statefulset"; namespace: string; name: string }
  | { kind: "daemonset"; namespace: string; name: string }
  | { kind: "job"; namespace: string; name: string }
  | { kind: "configmap"; namespace: string; name: string }
  | { kind: "secret"; namespace: string; name: string }
  | { kind: "pvc"; namespace: string; name: string }
  | { kind: "quota"; namespace: string; name: string };

const TABS: { id: K8sResourceKind; label: string }[] = [
  { id: "pods", label: "Pods" },
  { id: "workloads", label: "Workloads" },
  { id: "services", label: "Services" },
  { id: "ingresses", label: "Ingress" },
  { id: "config", label: "Config" },
  { id: "storage", label: "Storage" },
  { id: "jobs", label: "Jobs" },
  { id: "quotas", label: "Quotas" },
];

const okStatus = (s: string) => s === "Running" || s === "Completed" || s === "Succeeded" || s === "Bound" || s === "Active";

export function KubernetesView({
  onClose,
  inline,
  onInspectResource,
}: {
  onClose?: () => void;
  inline?: boolean;
  onInspectResource?: (sel: K8sResourceSelection) => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ctx, setCtx] = useState("");
  const [contexts, setContexts] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const [namespace, setNamespace] = useState<string>("_all");
  const [tab, setTab] = useState<K8sResourceKind>("pods");
  const [loading, setLoading] = useState(false);
  const [pods, setPods] = useState<K8sPod[]>([]);
  const [services, setServices] = useState<K8sService[]>([]);
  const [ingresses, setIngresses] = useState<K8sIngress[]>([]);
  const [deployments, setDeployments] = useState<K8sDeployment[]>([]);
  const [replicaSets, setReplicaSets] = useState<K8sReplicaSet[]>([]);
  const [statefulSets, setStatefulSets] = useState<K8sStatefulSet[]>([]);
  const [daemonSets, setDaemonSets] = useState<K8sDaemonSet[]>([]);
  const [jobs, setJobs] = useState<K8sJob[]>([]);
  const [configMaps, setConfigMaps] = useState<K8sConfigMap[]>([]);
  const [secrets, setSecrets] = useState<K8sSecret[]>([]);
  const [pvcs, setPvcs] = useState<K8sPersistentVolumeClaim[]>([]);
  const [quotas, setQuotas] = useState<K8sResourceQuota[]>([]);
  const cancelledRef = useRef(false);

  const refreshContexts = useCallback(async () => {
    const [ok, currentCtx, allCtxs, ns] = await Promise.all([
      checkKubectl(),
      currentContext().catch(() => ""),
      listContexts().catch(() => [] as string[]),
      listNamespaces().catch(() => [] as string[]),
    ]);
    if (cancelledRef.current) return;
    setAvailable(ok);
    setCtx(currentCtx);
    setContexts(allCtxs);
    setNamespaces(ns);
  }, []);

  /* 10s stale window: a tab you flip back to renders from cache immediately and
     revalidates behind, instead of paying another process spawn + API round trip.
     Keyed by namespace only — a context switch clears the cache outright. */
  const cachedList = useCallback(
    <T,>(key: string, load: () => Promise<T>) => k8sCached(`${key}:${namespace}`, 10_000, load),
    [namespace],
  );

  /* Tab data only. Context/namespace discovery deliberately does NOT run here:
     it costs four kubectl calls (one of them a full API round trip for
     listNamespaces) and none of it changes when you switch tabs, yet it used to
     be awaited before the tab's own request even started. */
  const refresh = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    try {
      switch (tab) {
        case "pods":
          setPods(await cachedList("pods", () => listPods(namespace)));
          break;
        case "services":
          setServices(await cachedList("services", () => listServices(namespace)));
          break;
        case "ingresses":
          setIngresses(await cachedList("ingresses", () => listIngresses(namespace)));
          break;
        case "workloads": {
          const [d, r, s, ds] = await Promise.all([
            cachedList("deployments", () => listDeployments(namespace)),
            cachedList("replicasets", () => listReplicaSets(namespace)),
            cachedList("statefulsets", () => listStatefulSets(namespace)),
            cachedList("daemonsets", () => listDaemonSets(namespace)),
          ]);
          setDeployments(d);
          setReplicaSets(r);
          setStatefulSets(s);
          setDaemonSets(ds);
          break;
        }
        case "config": {
          const [cm, sec] = await Promise.all([
            cachedList("configmaps", () => listConfigMaps(namespace)),
            cachedList("secrets", () => listSecrets(namespace)),
          ]);
          setConfigMaps(cm);
          setSecrets(sec);
          break;
        }
        case "storage":
          setPvcs(await cachedList("pvcs", () => listPersistentVolumeClaims(namespace)));
          break;
        case "jobs":
          setJobs(await cachedList("jobs", () => listJobs(namespace)));
          break;
        case "quotas":
          setQuotas(await cachedList("quotas", () => listResourceQuotas(namespace)));
          break;
      }
    } catch (e) {
      toast({ title: "kubectl error", message: e instanceof Error ? e.message : String(e), variant: "error" });
    } finally {
      if (!cancelledRef.current) setLoading(false);
    }
  }, [namespace, tab, cachedList]);

  // Contexts and namespaces: once on mount, and on an explicit refresh. They are
  // independent of the active tab, so they run in parallel with the tab fetch
  // rather than gating it.
  useEffect(() => {
    void refreshContexts();
  }, [refreshContexts]);

  useEffect(() => {
    void refresh();
    return () => {
      cancelledRef.current = true;
    };
  }, [refresh]);

  const switchCtx = async (c: string) => {
    try {
      await useContext(c);
      invalidateK8sCache();
      toast({ title: `Switched to ${c}`, variant: "success" });
      // Namespaces are per-cluster, so the context list has to be reloaded too —
      // it no longer rides along with refresh(). Both run concurrently.
      await Promise.all([refreshContexts(), refresh()]);
    } catch (e) {
      toast({ title: "kubectl error", message: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  /** The explicit refresh action reloads both halves, unlike a tab switch. */
  const refreshAll = () => {
    invalidateK8sCache();
    void Promise.all([refreshContexts(), refresh()]);
  };

  const headerActions = (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      onClick={refreshAll}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
    </button>
  );

  return (
    <Modal title="Kubernetes" onClose={onClose} inline={inline} headerActions={headerActions}>
      {loading && available === null ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          {/* Rotation, not a pulse: a fading icon can read as a static gradient,
              and this is the wait that can take several seconds. */}
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <Spinner size={18} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">Analyzing cluster…</p>
        </div>
      ) : available === false ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={Database01Icon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">kubectl not found</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Context selector */}
          {contexts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Context
              </span>
              <div className="flex flex-col gap-0.5">
                {contexts.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => switchCtx(c)}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition-colors ${
                      c === ctx ? "bg-primary/10 text-primary" : "text-foreground hover:bg-accent/10"
                    }`}
                  >
                    <span className={`size-1.5 rounded-full ${c === ctx ? "bg-primary" : "bg-muted-foreground/40"}`} />
                    <span className="truncate">{c}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Namespace filter */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Namespace</span>
            <div className="relative">
              <select
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                className="h-7 w-full rounded-md border border-border/40 bg-muted/40 px-2 text-[11px] text-foreground outline-none"
              >
                <option value="_all">All namespaces</option>
                {namespaces.map((ns) => (
                  <option key={ns} value={ns}>
                    {ns}
                  </option>
                ))}
              </select>
              <HugeiconsIcon
                icon={ArrowDown01Icon}
                size={10}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          </div>

          {/* Resource type tabs */}
          <div className="flex flex-wrap gap-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`rounded-md px-2 py-1 text-[10.5px] font-medium transition-colors ${
                  tab === t.id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent/10 hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Resource list */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {TABS.find((t) => t.id === tab)?.label}
            </span>
            {loading ? (
              <LoadingRow label={`Loading ${TABS.find((t) => t.id === tab)?.label.toLowerCase() ?? "resources"}`} />
            ) : (
              <div className="flex flex-col gap-0.5">
                {tab === "pods" && pods.map((p) => (
                  <ResourceRow
                    key={`${p.namespace}/${p.name}`}
                    label={p.name}
                    sub={`${p.namespace} · ${p.status} · ${p.ready} · ${p.age}`}
                    status={okStatus(p.status) ? "ok" : "warn"}
                    onClick={() => onInspectResource?.({ kind: "pod", namespace: p.namespace, name: p.name })}
                  />
                ))}
                {tab === "services" && services.map((s) => (
                  <ResourceRow
                    key={`${s.namespace}/${s.name}`}
                    label={s.name}
                    sub={`${s.namespace} · ${s.type} · ${s.clusterIp} · ${s.ports}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ kind: "service", namespace: s.namespace, name: s.name })}
                  />
                ))}
                {tab === "ingresses" && ingresses.map((i) => (
                  <ResourceRow
                    key={`${i.namespace}/${i.name}`}
                    label={i.name}
                    sub={`${i.namespace} · ${i.hosts.join(", ")}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ kind: "ingress", namespace: i.namespace, name: i.name })}
                  />
                ))}
                {tab === "workloads" && (
                  <>
                    {deployments.map((d) => (
                      <ResourceRow
                        key={`${d.namespace}/${d.name}`}
                        label={d.name}
                        sub={`Deployment · ${d.ready} · ${d.age}`}
                        status={d.current === d.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ kind: "deployment", namespace: d.namespace, name: d.name })}
                      />
                    ))}
                    {replicaSets.map((r) => (
                      <ResourceRow
                        key={`${r.namespace}/${r.name}`}
                        label={r.name}
                        sub={`ReplicaSet · ${r.ready}/${r.desired} · ${r.age}`}
                        status={r.ready === r.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ kind: "replicaset", namespace: r.namespace, name: r.name })}
                      />
                    ))}
                    {statefulSets.map((s) => (
                      <ResourceRow
                        key={`${s.namespace}/${s.name}`}
                        label={s.name}
                        sub={`StatefulSet · ${s.ready} · ${s.age}`}
                        status="ok"
                        onClick={() => onInspectResource?.({ kind: "statefulset", namespace: s.namespace, name: s.name })}
                      />
                    ))}
                    {daemonSets.map((ds) => (
                      <ResourceRow
                        key={`${ds.namespace}/${ds.name}`}
                        label={ds.name}
                        sub={`DaemonSet · ${ds.ready}/${ds.desired} · ${ds.age}`}
                        status={ds.ready === ds.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ kind: "daemonset", namespace: ds.namespace, name: ds.name })}
                      />
                    ))}
                  </>
                )}
                {tab === "config" && (
                  <>
                    {configMaps.map((cm) => (
                      <ResourceRow
                        key={`${cm.namespace}/${cm.name}`}
                        label={cm.name}
                        sub={`ConfigMap · ${cm.namespace} · ${cm.dataKeys.length} keys · ${cm.age}`}
                        status="ok"
                        onClick={() => onInspectResource?.({ kind: "configmap", namespace: cm.namespace, name: cm.name })}
                      />
                    ))}
                    {secrets.map((s) => (
                      <ResourceRow
                        key={`${s.namespace}/${s.name}`}
                        label={s.name}
                        sub={`Secret · ${s.type} · ${s.namespace} · ${s.age}`}
                        status="ok"
                        onClick={() => onInspectResource?.({ kind: "secret", namespace: s.namespace, name: s.name })}
                      />
                    ))}
                  </>
                )}
                {tab === "storage" && pvcs.map((p) => (
                  <ResourceRow
                    key={`${p.namespace}/${p.name}`}
                    label={p.name}
                    sub={`PVC · ${p.status} · ${p.capacity} · ${p.storageClass}`}
                    status={okStatus(p.status) ? "ok" : "warn"}
                    onClick={() => onInspectResource?.({ kind: "pvc", namespace: p.namespace, name: p.name })}
                  />
                ))}
                {tab === "jobs" && jobs.map((j) => (
                  <ResourceRow
                    key={`${j.namespace}/${j.name}`}
                    label={j.name}
                    sub={`Job · ${j.completions} · ${j.duration} · ${j.age}`}
                    status={j.status === "Complete" ? "ok" : "warn"}
                    onClick={() => onInspectResource?.({ kind: "job", namespace: j.namespace, name: j.name })}
                  />
                ))}
                {tab === "quotas" && quotas.map((q) => (
                  <ResourceRow
                    key={`${q.namespace}/${q.name}`}
                    label={q.name}
                    sub={`ResourceQuota · ${q.namespace} · ${q.limits}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ kind: "quota", namespace: q.namespace, name: q.name })}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

function ResourceRow({
  label,
  sub,
  status,
  onClick,
}: {
  label: string;
  sub: string;
  status: "ok" | "warn" | "error";
  onClick: () => void;
}) {
  const color =
    status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/10"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${color}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[11.5px] text-foreground">{label}</span>
        <span className="truncate text-[10px] text-muted-foreground">{sub}</span>
      </div>
    </button>
  );
}

export default KubernetesView;
