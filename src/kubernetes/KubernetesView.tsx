import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { K8sConfigSourcePicker } from "./K8sConfigSourcePicker";
import { K8sNamespacePicker } from "./K8sNamespacePicker";
import { K8sAccessCheck } from "./K8sAccessCheck";
import { K8sLastResource } from "./K8sLastResource";
import type { K8sBrowseRequest } from "./useK8sNavigation";
import { podOwnershipLabel } from "./podOwnership";
import { getContextNamespace, isValidNamespace } from "./namespaceAccess";
import type { K8sConfigSource, K8sReadScope } from "./configSource";
import {
  checkKubectl,
  currentContext,
  listContexts,
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
import { Modal } from "../components/Modal";
import "./kubernetes.css";
import { HugeiconsIcon } from "@hugeicons/react";
import { Spinner, LoadingRow } from "@/components/Spinner";
import {
  Database01Icon,
  Refresh01Icon,
  ArrowLeft01Icon,
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

export type K8sResourceSelection = {
  context: string;
  config?: K8sConfigSource;
  namespace: string;
  name: string;
  kind: "pod" | "service" | "ingress" | "deployment" | "replicaset" |
    "statefulset" | "daemonset" | "job" | "configmap" | "secret" | "pvc" | "quota";
};

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

const ACCESS_RESOURCES: Record<K8sResourceKind, readonly string[]> = {
  pods: ["pods"], workloads: ["deployments.apps", "replicasets.apps", "statefulsets.apps", "daemonsets.apps"],
  services: ["services"], ingresses: ["ingresses.networking.k8s.io"], config: ["configmaps", "secrets"],
  storage: ["persistentvolumeclaims"], jobs: ["jobs.batch"], quotas: ["resourcequotas"],
};

const okStatus = (s: string) => s === "Running" || s === "Completed" || s === "Succeeded" || s === "Bound" || s === "Active";

export function readyReplicasMatch(ready: string): boolean {
  const match = /^(\d+)\/(\d+)$/.exec(ready);
  return !!match && Number(match[1]) === Number(match[2]);
}

export function KubernetesView({
  onClose,
  onBack,
  inline,
  onInspectResource,
  selectedResource = null,
  lastResource = null,
  browseRequest = null,
  onBrowseSelectionChange,
}: {
  onClose?: () => void;
  /** Present when this built-in panel was opened from Tools. */
  onBack?: () => void;
  inline?: boolean;
  onInspectResource?: (sel: K8sResourceSelection | null) => void;
  selectedResource?: K8sResourceSelection | null;
  lastResource?: K8sResourceSelection | null;
  browseRequest?: K8sBrowseRequest | null;
  onBrowseSelectionChange?: () => void;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const preferredContextRef = useRef<string | null>(null);
  const appliedBrowseRequest = useRef<K8sBrowseRequest | null>(null);
  const [ctx, setCtx] = useState("");
  const [config, setConfig] = useState<K8sConfigSource | null>(null);
  const readScope = useMemo<K8sReadScope>(() => config ? { context: ctx, config } : ctx, [ctx, config]);
  const [contexts, setContexts] = useState<string[]>([]);
  const [namespaces, setNamespaces] = useState<string[]>([]);
  const namespaceScope = JSON.stringify([config?.fingerprint, ctx]);
  const [namespaceSelection, setNamespaceSelection] = useState({ scope: "", value: "" });
  const namespace = namespaceSelection.scope === namespaceScope ? namespaceSelection.value : "";
  const namespaceChoiceRef = useRef(0);
  const [namespaceDefault, setNamespaceDefault] = useState({ scope: "", value: "", loading: false, error: "" });
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
  const requestRef = useRef(0);
  const discoveryRef = useRef(0);
  const contextRef = useRef(ctx);
  contextRef.current = ctx;
  const initialContextRef = useRef(true);
  const inspectRef = useRef(onInspectResource);
  inspectRef.current = onInspectResource;
  const [loadedScope, setLoadedScope] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<Record<string, string>>({});
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [namespaceError, setNamespaceError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState("");
  const scope = JSON.stringify([config?.fingerprint, ctx, namespace, tab]);
  const resourceListId = useId();
  const categoryLabel = TABS.find((item) => item.id === tab)!.label;
  const resourceCount = {
    pods: pods.length,
    workloads: deployments.length + replicaSets.length + statefulSets.length + daemonSets.length,
    services: services.length,
    ingresses: ingresses.length,
    config: configMaps.length + secrets.length,
    storage: pvcs.length,
    jobs: jobs.length,
    quotas: quotas.length,
  }[tab];
  const listReady = !!ctx && !!namespace && loadedScope === scope && !loading && !listError;

  const refreshContexts = useCallback(async () => {
    const request = ++discoveryRef.current;
    if (!config) return;
    try {
      const ok = await checkKubectl();
      if (request !== discoveryRef.current) return;
      setAvailable(ok);
      if (!ok) return;
      const [currentCtx, allCtxs] = await Promise.all([currentContext(config), listContexts(config)]);
      if (request !== discoveryRef.current) return;
      const previous = contextRef.current;
      const removed = !!previous && !allCtxs.includes(previous);
      const desired = preferredContextRef.current ?? currentCtx;
      const missingRequested = initialContextRef.current && preferredContextRef.current !== null && !allCtxs.includes(desired);
      if (removed) {
        requestRef.current++;
        inspectRef.current?.(null);
        setCtx("");
        setLoadedScope("");
        setNamespaceSelection({ scope: "", value: "" });
      } else if (initialContextRef.current && allCtxs.includes(desired)) {
        setCtx(desired);
      }
      initialContextRef.current = false;
      setContexts(allCtxs);
      setDiscoveryError(removed ? `Context “${previous}” is no longer in this config. Select a context to continue.`
        : missingRequested ? `Context “${desired}” is not in App default. Select a context to continue.` : null);
    } catch (error) {
      if (request === discoveryRef.current) setDiscoveryError(String(error));
    }
  }, [config]);

  const selectConfig = useCallback((next: K8sConfigSource) => {
    requestRef.current++;
    discoveryRef.current++;
    invalidateK8sCache();
    onInspectResource?.(null);
    setConfig(next);
    preferredContextRef.current = null;
    initialContextRef.current = true;
    contextRef.current = "";
    setCtx("");
    setContexts([]);
    setNamespaces([]);
    namespaceChoiceRef.current++;
    setNamespaceSelection({ scope: "", value: "" });
    setLoadedScope("");
    setRefreshedAt("");
    setListError(null);
    setDiscoveryError(null);
  }, [onInspectResource]);

  useEffect(() => {
    if (!browseRequest || appliedBrowseRequest.current === browseRequest) return;
    appliedBrowseRequest.current = browseRequest;
    // A palette context belongs to App default, not an identically named
    // context in the custom kubeconfig the sidebar may currently be browsing.
    selectConfig({ ...browseRequest.config });
    preferredContextRef.current = browseRequest.context;
  }, [browseRequest, selectConfig]);

  // Both cache identity and every command bind to the displayed context.
  const cachedList = useCallback(
    <T,>(key: string, load: () => Promise<T>) => k8sCached(JSON.stringify([config?.fingerprint, ctx, namespace, key]), 10_000, load),
    [config, ctx, namespace],
  );

  const refresh = useCallback(async () => {
    const request = ++requestRef.current;
    if (!ctx || !config || !namespace) return;
    setLoading(true);
    setListError(null);
    setPartialErrors({});
    const accept = <T,>(setter: (value: T) => void, value: T) => {
      if (request === requestRef.current) setter(value);
    };
    try {
      switch (tab) {
        case "pods":
          accept(setPods, await cachedList("pods", () => listPods(namespace, readScope)));
          break;
        case "services":
          accept(setServices, await cachedList("services", () => listServices(namespace, readScope)));
          break;
        case "ingresses":
          accept(setIngresses, await cachedList("ingresses", () => listIngresses(namespace, readScope)));
          break;
        case "workloads": {
          const results = await Promise.allSettled([
            cachedList("deployments", () => listDeployments(namespace, readScope)),
            cachedList("replicasets", () => listReplicaSets(namespace, readScope)),
            cachedList("statefulsets", () => listStatefulSets(namespace, readScope)),
            cachedList("daemonsets", () => listDaemonSets(namespace, readScope)),
          ]);
          const [d, r, s, ds] = results;
          accept(setDeployments, d.status === "fulfilled" ? d.value : []);
          accept(setReplicaSets, r.status === "fulfilled" ? r.value : []);
          accept(setStatefulSets, s.status === "fulfilled" ? s.value : []);
          accept(setDaemonSets, ds.status === "fulfilled" ? ds.value : []);
          accept(setPartialErrors, Object.fromEntries(results.flatMap((result, index) => result.status === "rejected" ? [[ACCESS_RESOURCES.workloads[index], String(result.reason)]] : [])));
          break;
        }
        case "config": {
          const [cm, sec] = await Promise.allSettled([
            cachedList("configmaps", () => listConfigMaps(namespace, readScope)),
            cachedList("secrets", () => listSecrets(namespace, readScope)),
          ]);
          accept(setConfigMaps, cm.status === "fulfilled" ? cm.value : []);
          accept(setSecrets, sec.status === "fulfilled" ? sec.value : []);
          accept(setPartialErrors, {
            ...(cm.status === "rejected" ? { configmaps: String(cm.reason) } : {}),
            ...(sec.status === "rejected" ? { secrets: String(sec.reason) } : {}),
          });
          break;
        }
        case "storage":
          accept(setPvcs, await cachedList("pvcs", () => listPersistentVolumeClaims(namespace, readScope)));
          break;
        case "jobs":
          accept(setJobs, await cachedList("jobs", () => listJobs(namespace, readScope)));
          break;
        case "quotas":
          accept(setQuotas, await cachedList("quotas", () => listResourceQuotas(namespace, readScope)));
          break;
      }
      if (request === requestRef.current) setRefreshedAt(new Date().toLocaleTimeString());
    } catch (e) {
      if (request === requestRef.current) setListError(e instanceof Error ? e.message : String(e));
    } finally {
      if (request === requestRef.current) {
        setLoading(false);
        setLoadedScope(scope);
      }
    }
  }, [ctx, config, readScope, namespace, tab, scope, cachedList]);

  // Contexts and namespaces: once on mount, and on an explicit refresh. They are
  // independent of the active tab, so they run in parallel with the tab fetch
  // rather than gating it.
  useEffect(() => {
    void refreshContexts();
    return () => { discoveryRef.current++; };
  }, [refreshContexts]);

  const [namespaceRevision, setNamespaceRevision] = useState(0);
  // Resolve locally before the first resource request. A namespace-limited user
  // must never need a successful cluster-wide namespace list to browse.
  useEffect(() => {
    let active = true;
    const choice = ++namespaceChoiceRef.current;
    if (!ctx || !config) return;
    setNamespaceDefault({ scope: namespaceScope, value: "", loading: true, error: "" });
    void getContextNamespace(readScope).then(value => {
      if (!active) return;
      setNamespaceDefault({ scope: namespaceScope, value, loading: false, error: "" });
      // Never overwrite a manually selected namespace with a delayed default.
      if (choice === namespaceChoiceRef.current) setNamespaceSelection(previous => previous.scope === namespaceScope && previous.value ? previous : { scope: namespaceScope, value });
    }).catch(error => {
      if (active) setNamespaceDefault({ scope: namespaceScope, value: "", loading: false, error: String(error) });
    });
    return () => { active = false; };
  }, [ctx, config, readScope, namespaceScope, namespaceRevision]);

  useEffect(() => {
    let cancelled = false;
    setNamespaces([]);
    setNamespaceError(null);
    if (!ctx) return;
    void listNamespaces(readScope).then((items) => {
      if (!cancelled) setNamespaces(items);
    }).catch((error) => {
      if (!cancelled) setNamespaceError(`Namespaces unavailable: ${String(error)}`);
    });
    return () => { cancelled = true; };
  }, [ctx, readScope, namespaceRevision]);

  useEffect(() => {
    void refresh();
    return () => {
      requestRef.current++;
    };
  }, [refresh]);

  const switchCtx = (c: string) => {
    if (c === ctx) return;
    onBrowseSelectionChange?.();
    requestRef.current++;
    onInspectResource?.(null);
    setCtx(c);
    namespaceChoiceRef.current++;
    setNamespaceSelection({ scope: "", value: "" });
    setListError(null);
  };

  const switchNamespace = (value: string) => {
    if (value !== "_all" && !isValidNamespace(value)) return;
    onBrowseSelectionChange?.();
    namespaceChoiceRef.current++;
    requestRef.current++;
    onInspectResource?.(null);
    setNamespaceSelection({ scope: namespaceScope, value });
    setListError(null);
  };

  /** The explicit refresh action reloads both halves, unlike a tab switch. */
  const refreshAll = () => {
    invalidateK8sCache();
    setNamespaceRevision((value) => value + 1);
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

  const leadingAction = onBack ? (
    <button
      type="button"
      aria-label="Back to tools"
      title="Back to tools"
      onClick={onBack}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
    </button>
  ) : undefined;

  return (
    <Modal title="Kubernetes" icon={Database01Icon} context="Local CLI" onClose={onClose} inline={inline} headerActions={<>{leadingAction}{headerActions}</>}>
      <div className="k8s-surface k8s-browser">
      <details className="mb-2 text-[11px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer rounded outline-none focus-visible:ring-1 focus-visible:ring-ring">Local kubeconfig</summary>
        <p className="mt-1">Uses this computer’s kubectl, not an SSH terminal. The selected config source and context are pinned. Terminal exports are captured only when you explicitly choose that source. Existing terminals may need a fresh shell for integration support.</p>
      </details>
      <K8sConfigSourcePicker source={config} onChange={next => {
        if (config) onBrowseSelectionChange?.();
        selectConfig(next);
      }} />
      {!config ? <p className="k8s-meta">Choose a config source to browse resources.</p> : available === null ? (
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
          {discoveryError && <p role="alert" className="text-[12px] text-rose-400">Context discovery unavailable: {discoveryError}</p>}
          {!ctx && <p className="text-[12px] text-muted-foreground">Select a context to browse resources.</p>}
          {/* Context selector */}
          {contexts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="k8s-browse-label text-[11px] font-medium text-muted-foreground">
                Context
              </span>
              <select aria-label="Context" value={ctx} onChange={(event) => switchCtx(event.target.value)} className="k8s-context-select">
                {!ctx && <option value="" disabled>Choose a context…</option>}
                {contexts.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          {/* Namespace filter */}
          <K8sNamespacePicker key={namespaceScope} namespace={namespace} namespaces={namespaces}
            defaultNamespace={namespaceDefault.scope === namespaceScope ? namespaceDefault.value : ""}
            loadingDefault={!!ctx && (namespaceDefault.scope !== namespaceScope || namespaceDefault.loading)}
            defaultError={namespaceDefault.scope === namespaceScope ? namespaceDefault.error : ""}
            discoveryError={namespaceError} disabled={!ctx} onChange={switchNamespace} />

          {/* Resource type tabs */}
          <div className="k8s-browse-tabs" role="group" aria-label="Resource categories">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-pressed={tab === t.id}
                aria-controls={resourceListId}
                onClick={() => setTab(t.id)}
                className="k8s-browse-tab"
              >
                {t.label}
              </button>
            ))}
          </div>

          <K8sAccessCheck namespace={namespace} resources={namespaceError ? [...ACCESS_RESOURCES[tab], "namespaces"] : ACCESS_RESOURCES[tab]} scope={readScope} />

          {onInspectResource && <K8sLastResource resource={lastResource} selected={selectedResource}
            config={config} context={ctx} onReopen={onInspectResource} />}

          {/* Resource list */}
          <section id={resourceListId} className="k8s-browse-list flex flex-col gap-1" aria-label={`${categoryLabel} resources`} aria-busy={!!ctx && !!namespace && (loading || loadedScope !== scope)}>
            <h3 className="k8s-browse-heading">
              {categoryLabel}
              {listReady && Object.keys(partialErrors).length === 0 && <span className="k8s-count" aria-label={`${resourceCount} ${resourceCount === 1 ? "resource" : "resources"}`}>{resourceCount}</span>}
            </h3>
            {ctx && !namespace ? <p className="k8s-meta">Choose a namespace to browse resources.</p> : ctx && listError ? <p role="alert" className="break-words text-[12px] text-rose-400">Unable to load resources: {listError}</p> : ctx && (loading || loadedScope !== scope) ? (
              <LoadingRow label={`Loading ${categoryLabel.toLowerCase()}`} />
            ) : ctx ? (
              <div className="flex flex-col gap-0.5">
                {Object.entries(partialErrors).map(([resource, error]) => <p key={resource} role="status" className="k8s-source-error">{resource} unavailable: {error}</p>)}
                {tab === "pods" && pods.map((p) => (
                  <ResourceRow
                    key={`${p.namespace}/${p.name}`}
                    label={p.name}
                    sub={`${p.namespace} · ${p.status} · ${p.ready} · ${p.age}`}
                    ownership={podOwnershipLabel(p.ownership)}
                    status={((p.status === "Running" && readyReplicasMatch(p.ready)) || p.status === "Completed" || p.status === "Succeeded") ? "ok" : "warn"}
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "pod", namespace: p.namespace, name: p.name })}
                  />
                ))}
                {tab === "services" && services.map((s) => (
                  <ResourceRow
                    key={`${s.namespace}/${s.name}`}
                    label={s.name}
                    sub={`${s.namespace} · ${s.type} · ${s.clusterIp} · ${s.ports}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "service", namespace: s.namespace, name: s.name })}
                  />
                ))}
                {tab === "ingresses" && ingresses.map((i) => (
                  <ResourceRow
                    key={`${i.namespace}/${i.name}`}
                    label={i.name}
                    sub={`${i.namespace} · ${i.hosts.join(", ")}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "ingress", namespace: i.namespace, name: i.name })}
                  />
                ))}
                {tab === "workloads" && (
                  <>
                    {deployments.map((d) => (
                      <ResourceRow
                        key={`${d.namespace}/${d.name}`}
                        label={d.name}
                        sub={`Deployment · ${d.ready} · ${d.age}`}
                        status={readyReplicasMatch(d.ready) && Number(d.available) >= d.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "deployment", namespace: d.namespace, name: d.name })}
                      />
                    ))}
                    {replicaSets.map((r) => (
                      <ResourceRow
                        key={`${r.namespace}/${r.name}`}
                        label={r.name}
                        sub={`ReplicaSet · ${r.ready}/${r.desired} · ${r.age}`}
                        status={r.ready === r.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "replicaset", namespace: r.namespace, name: r.name })}
                      />
                    ))}
                    {statefulSets.map((s) => (
                      <ResourceRow
                        key={`${s.namespace}/${s.name}`}
                        label={s.name}
                        sub={`StatefulSet · ${s.ready} · ${s.age}`}
                        status={readyReplicasMatch(s.ready) ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "statefulset", namespace: s.namespace, name: s.name })}
                      />
                    ))}
                    {daemonSets.map((ds) => (
                      <ResourceRow
                        key={`${ds.namespace}/${ds.name}`}
                        label={ds.name}
                        sub={`DaemonSet · ${ds.ready}/${ds.desired} · ${ds.age}`}
                        status={ds.ready === ds.desired ? "ok" : "warn"}
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "daemonset", namespace: ds.namespace, name: ds.name })}
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
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "configmap", namespace: cm.namespace, name: cm.name })}
                      />
                    ))}
                    {secrets.map((s) => (
                      <ResourceRow
                        key={`${s.namespace}/${s.name}`}
                        label={s.name}
                        sub={`Secret · ${s.type} · ${s.namespace} · ${s.age}`}
                        status="ok"
                        onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "secret", namespace: s.namespace, name: s.name })}
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
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "pvc", namespace: p.namespace, name: p.name })}
                  />
                ))}
                {tab === "jobs" && jobs.map((j) => (
                  <ResourceRow
                    key={`${j.namespace}/${j.name}`}
                    label={j.name}
                    sub={`Job · ${j.completions} · ${j.duration} · ${j.age}`}
                    status={j.status === "Complete" ? "ok" : "warn"}
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "job", namespace: j.namespace, name: j.name })}
                  />
                ))}
                {tab === "quotas" && quotas.map((q) => (
                  <ResourceRow
                    key={`${q.namespace}/${q.name}`}
                    label={q.name}
                    sub={`ResourceQuota · ${q.namespace} · ${q.limits}`}
                    status="ok"
                    onClick={() => onInspectResource?.({ context: ctx, config: config || undefined, kind: "quota", namespace: q.namespace, name: q.name })}
                  />
                ))}
                {resourceCount === 0 && Object.keys(partialErrors).length === 0 &&
                  <p className="py-2 text-[12px] text-muted-foreground">No resources in this scope.</p>}
              </div>
            ) : null}
            {listReady && refreshedAt &&
              <p className="text-[11px] text-muted-foreground">{Object.keys(partialErrors).length ? "Checked" : "Loaded"} {refreshedAt} · {Object.keys(partialErrors).length ? "Partial results" : "Read-only browsing"}</p>}
          </section>
        </div>
      )}
      </div>
    </Modal>
  );
}

function ResourceRow({
  label,
  sub,
  ownership,
  status,
  onClick,
}: {
  label: string;
  sub: string;
  ownership?: { label: string; title: string };
  status: "ok" | "warn" | "error";
  onClick: () => void;
}) {
  const color =
    status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : "bg-rose-500";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label}\n${sub}${ownership ? `\n${ownership.title}` : ""}`}
      className="k8s-browse-row flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/10"
    >
      <span className={`size-1.5 shrink-0 rounded-full ${color}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[12px] text-foreground">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground">{sub}</span>
        {ownership && <span className="truncate text-[11px] text-muted-foreground" title={ownership.title}>{ownership.label}</span>}
      </div>
    </button>
  );
}

export default KubernetesView;
