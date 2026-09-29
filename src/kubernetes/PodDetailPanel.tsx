import { useEffect, useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  Refresh01Icon,
  Cancel01Icon,
  File01Icon,
  BotIcon,
  Mining01Icon,
  ArrowRight01Icon,
  AiNetworkIcon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import {
  describePod,
  getPodLogs,
  getServicesForPod,
  getNodeInfo,
  getPodUsage,
  type K8sPodDetail,
  type K8sContainer,
  type K8sService,
  type K8sNodeInfo,
  type K8sPodUsage,
} from "./client";
import { useK8sInspector } from "./K8sInspectorContext";
import { CheckWarnings, ConfigSourceCaption, ConceptHelp, FindingCard, RelationshipLinks, Section, KVGrid, Labels, ResourceList, YamlView } from "./K8sDetailCommon";
import { diagnosePod, podTimeline, type PodFinding } from "./podDiagnostics";

const TABS = [
  { id: "overview", label: "Overview", icon: File01Icon },
  { id: "containers", label: "Containers", icon: BotIcon },
  { id: "events", label: "Events", icon: Mining01Icon },
  { id: "logs", label: "Logs", icon: ArrowRight01Icon },
  { id: "network", label: "Network", icon: AiNetworkIcon },
  { id: "resources", label: "Resources", icon: Database01Icon },
  { id: "node", label: "Node", icon: AiNetworkIcon },
  { id: "yaml", label: "YAML", icon: File01Icon },
];

// Custom/negative-polarity conditions must not be assumed healthy just because they are True.
const READINESS_CONDITIONS = new Set(["PodReadyToStartContainers", "Initialized", "Ready", "ContainersReady", "PodScheduled"]);

export function PodDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { context, config, readScope } = useK8sInspector();
  const [detail, setDetail] = useState<K8sPodDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "containers" | "events" | "logs" | "network" | "resources" | "node" | "yaml">("overview");
  const [logContainer, setLogContainer] = useState<string | "">("");
  const [logs, setLogs] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);
  const [logResultIdentity, setLogResultIdentity] = useState("");
  const [previousLogs, setPreviousLogs] = useState(false);
  const [timestamps, setTimestamps] = useState(true);
  const [logSearch, setLogSearch] = useState("");
  const [logRefresh, setLogRefresh] = useState(0);
  const [tailLive, setTailLive] = useState(false);
  const [services, setServices] = useState<K8sService[]>([]);
  const [nodeInfo, setNodeInfo] = useState<K8sNodeInfo | null>(null);
  const [usage, setUsage] = useState<K8sPodUsage | null>(null);
  const [supplementalErrors, setSupplementalErrors] = useState<Record<string, string>>({});
  const [refreshedAt, setRefreshedAt] = useState("");
  const [refresh, setRefresh] = useState(0);
  const identity = JSON.stringify([readScope, namespace, name]);
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const message = (error: unknown) => error instanceof Error ? error.message : String(error);

  useEffect(() => {
    let active = true;
    const current = () => active && identityRef.current === identity;
    setLoading(true);
    setError(null);
    setDetail(null);
    setServices([]);
    setNodeInfo(null);
    setUsage(null);
    setSupplementalErrors({});
    setRefreshedAt("");
    const unable = (part: string, error: unknown) => {
      if (current()) setSupplementalErrors((errors) => ({ ...errors, [part]: message(error) }));
    };
    void (async () => {
      try {
        const d = await describePod(namespace, name, readScope);
        if (!current()) return;
        setDetail(d);
        setRefreshedAt(new Date().toLocaleTimeString());
        await Promise.all([
          getServicesForPod(namespace, d.labels, readScope).then((value) => { if (current()) setServices(value); }).catch((error) => unable("Services", error)),
          getPodUsage(namespace, name, readScope).then((value) => { if (current()) setUsage(value); }).catch((error) => unable("Metrics", error)),
          d.node ? getNodeInfo(d.node, readScope).then((value) => { if (current()) setNodeInfo(value); }).catch((error) => unable("Node", error)) : Promise.resolve(),
        ]);
      } catch (error) {
        if (current()) setError(message(error));
      } finally {
        if (current()) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [readScope, namespace, name, refresh, identity]);

  useEffect(() => {
    setLogContainer(""); setLogs(""); setLogError(null); setPreviousLogs(false); setTailLive(false); setLogSearch("");
  }, [identity]);

  const selectedContainer = logContainer || detail?.containers[0]?.name || detail?.initContainers?.[0]?.name || "";
  const logIdentity = JSON.stringify([identity, selectedContainer, previousLogs, timestamps]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    setLogs(""); setLogError(null);
    if (tab !== "logs" || !selectedContainer || !detail) { setLogLoading(false); return; }
    const fetchLogs = async () => {
      if (inFlight || !active || document.visibilityState === "hidden") return;
      inFlight = true;
      setLogLoading(true);
      try {
        const result = await getPodLogs(namespace, name, selectedContainer, 200, { context: readScope, previous: previousLogs, timestamps });
        if (active && identityRef.current === identity) { setLogs(result); setLogError(null); setLogResultIdentity(logIdentity); }
      } catch (error) {
        if (active && identityRef.current === identity) { setLogError(message(error)); setLogs(""); setLogResultIdentity(logIdentity); }
      } finally {
        inFlight = false;
        if (active && identityRef.current === identity) setLogLoading(false);
      }
    };
    void fetchLogs();
    const timer = tailLive && !previousLogs ? setInterval(() => void fetchLogs(), 3000) : null;
    const onVisible = () => { if (document.visibilityState !== "hidden") void fetchLogs(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [tab, selectedContainer, tailLive, namespace, name, readScope, previousLogs, timestamps, logRefresh, detail, identity, logIdentity]);

  const openFinding = (finding: PodFinding) => {
    if (finding.container) setLogContainer(finding.container);
    setPreviousLogs(!!finding.previous);
    setTab(finding.tab);
  };

  const podAge = (iso: string) => {
    if (!iso) return "-";
    const diff = Date.now() - new Date(iso).getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
  };

  return (
    <div className="k8s-surface flex h-full flex-col bg-background text-foreground">
      <div className="k8s-header flex shrink-0 items-center justify-between border-b border-border">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={Database01Icon} size={14} strokeWidth={1.75} className="text-primary" />
          <div className="flex min-w-0 flex-col">
            <span title={name} className="k8s-title truncate font-semibold text-foreground">{name}</span>
            <span title={`${context} · ${namespace} · ${detail?.phase || "…"}`} className="k8s-meta k8s-wrap">
              {context || "Context unavailable"} · {namespace} · {detail?.phase || "…"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Copy name"
            title="Copy name"
            onClick={() => void navigator.clipboard.writeText(name)}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
        <ConfigSourceCaption source={config} />
      </div>

      <div className="k8s-tabs flex shrink-0 border-b border-border/50">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id as typeof tab)}
            className="flex items-center gap-1.5 text-[11px] font-medium transition-colors"
          >
            <HugeiconsIcon icon={t.icon} size={12} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="k8s-body min-h-0 flex-1 overflow-y-auto">
        {loading && !detail ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[12px] text-muted-foreground">No data</p>
        ) : (
          <div className={cn("k8s-stack", tab === "logs" && "k8s-log-stack")}>
            <div className="k8s-snapshot">
              <CheckWarnings
                leading={<span className="k8s-meta">Snapshot {refreshedAt || "loading"} · Read-only{loading && " · Loading related resources…"}</span>}
                errors={{ ...supplementalErrors, ...(detail.eventsError ? { Events: detail.eventsError } : {}) }}
              />
            </div>
            {tab === "overview" && <OverviewTab detail={detail} age={podAge} services={services} usage={usage} servicesPending={loading} servicesError={supplementalErrors.Services} onFinding={openFinding} />}
            {tab === "containers" && <ContainersTab containers={detail.containers} initContainers={detail.initContainers || []} />}
            {tab === "events" && <><CrashTimeline detail={detail} /><EventsTab events={detail.events} error={detail.eventsError} /></>}
            {tab === "logs" && (
              <LogsTab
                detail={detail}
                setLogContainer={setLogContainer}
                logs={logResultIdentity === logIdentity ? logs : ""}
                logLoading={logLoading}
                tailLive={tailLive}
                setTailLive={setTailLive}
                selected={selectedContainer}
                previous={previousLogs}
                setPrevious={setPreviousLogs}
                timestamps={timestamps}
                setTimestamps={setTimestamps}
                search={logSearch}
                setSearch={setLogSearch}
                error={logResultIdentity === logIdentity ? logError : null}
                refresh={() => setLogRefresh((value) => value + 1)}
              />
            )}
            {tab === "network" && <NetworkTab detail={detail} services={services} servicesPending={loading} servicesError={supplementalErrors.Services} />}
            {tab === "resources" && <ResourcesTab resources={detail.resources} usage={usage} />}
            {tab === "node" && <NodeTab node={nodeInfo} pending={loading} assigned={!!detail.node} error={supplementalErrors.Node} />}
            {tab === "yaml" && <YamlView yaml={detail.yaml} />}
          </div>
        )}
      </div>
    </div>
  );
}

function PodHealth({ detail, onFinding }: { detail: K8sPodDetail; onFinding: (finding: PodFinding) => void }) {
  const findings = diagnosePod(detail);
  const readiness = detail.conditions.find((condition) => condition.type === "Ready")?.status;
  const completed = detail.phase === "Succeeded";
  const ready = readiness === "True" && detail.phase === "Running";
  const status = completed ? "Completed" : detail.phase === "Failed" ? "Failed" : ready ? "Ready" : readiness === "False" ? "Not ready" : "Readiness unknown";
  const restarts = [...detail.containers, ...(detail.initContainers || [])].reduce((total, container) => total + container.restartCount, 0);
  const renderFinding = (finding: PodFinding) => <FindingCard key={finding.id} title={finding.title} evidence={finding.evidence} meaning={finding.meaning} next={finding.next} onEvidence={() => onFinding({ ...finding, tab: finding.tab === "logs" ? "logs" : "events" })} onNext={() => onFinding(finding)} />;
  return <section className="k8s-health k8s-card" aria-label="Pod health">
    <div className="k8s-health-summary">
      <div className="k8s-health-state" data-state={completed || ready ? "ready" : readiness === "False" || detail.phase === "Failed" ? "warning" : "unknown"}>
        <span className="k8s-status-dot" aria-hidden="true" />
        <h3>{status}</h3>
      </div>
      <div className="k8s-health-stats">
        <span><strong>{detail.containers.filter((container) => container.ready).length}/{detail.containers.length}</strong> containers ready</span>
        <span><strong>{restarts}</strong> restarts</span>
      </div>
    </div>
    <div className="k8s-health-caption">
      <p>{completed ? "Pod completed successfully." : ready ? "Kubernetes reports this Pod ready. Application health and reachability are not verified." : "Based on reported Pod conditions, not an application health check."}</p>
      <ConceptHelp concept={detail.phase === "Pending" ? "pending" : "readiness"} value={detail.phase} />
    </div>
    {findings.length > 0 && <div className="k8s-health-findings">{renderFinding(findings[0])}{findings.length > 1 && <details className="k8s-secondary"><summary>{findings.length - 1} more observations</summary><div className="k8s-stack">{findings.slice(1).map(renderFinding)}</div></details>}</div>}
  </section>;
}

function CrashTimeline({ detail }: { detail: K8sPodDetail }) {
  const entries = podTimeline(detail);
  return <details className="k8s-timeline rounded-md border border-border/40 p-2.5">
    <summary className="cursor-pointer text-[12px] font-medium">Restart &amp; event timeline · {entries.length}</summary>
    <p className="my-2 text-[11px] text-muted-foreground">Latest available observations, not a complete history. Kubernetes may aggregate or expire events; only the latest previous termination is retained here.</p>
    {entries.length === 0 ? <p className="text-[12px] text-muted-foreground">No timeline evidence available{detail.eventsError ? "; events could not be read" : ""}.</p> : <ol className="flex flex-col gap-2">{entries.slice(0, 40).map((entry) => <li key={entry.id} className="border-l border-border pl-2"><div className={cn("text-[12px]", entry.warning ? "text-amber-400" : "text-foreground")}>{entry.title}</div><div className="text-[11px] text-muted-foreground">{entry.timestamp || "Time unavailable"}</div><p className="break-words text-[12px] text-muted-foreground">{entry.detail}</p></li>)}</ol>}
    {entries.length > 40 && <p className="mt-2 text-[11px] text-muted-foreground">Showing the latest 40 observations.</p>}
  </details>;
}

function OverviewTab({
  detail,
  age,
  services,
  usage,
  servicesPending,
  servicesError,
  onFinding,
}: {
  detail: K8sPodDetail;
  age: (iso: string) => string;
  services: K8sService[];
  usage: K8sPodUsage | null;
  servicesPending: boolean;
  servicesError?: string;
  onFinding: (finding: PodFinding) => void;
}) {
  const rows: { label: string; value: string }[] = [
    { label: "Namespace", value: detail.namespace },
    { label: "Node", value: detail.node || "-" },
    { label: "Pod IP", value: detail.ip || "-" },
    { label: "Host IP", value: detail.hostIp || "-" },
    { label: "QoS Class", value: detail.qosClass || "-" },
    { label: "Restart Policy", value: detail.restartPolicy || "-" },
    { label: "Service Account", value: detail.serviceAccount || "-" },
    { label: "Age", value: age(detail.createdAt) },
    { label: "Phase", value: detail.phase },
  ];
  if (usage) {
    rows.splice(2, 0, { label: "CPU Usage", value: usage.cpu }, { label: "Memory Usage", value: usage.memory });
  }

  return (
    <div className="k8s-pod-overview">
      <PodHealth detail={detail} onFinding={onFinding} />
      <div className="k8s-pod-column">
      <Section title="Pod details" className="k8s-card">
        <KVGrid rows={rows} />
        <ConceptHelp concept="qos" value={detail.qosClass} />
      </Section>
      <details className="k8s-secondary k8s-card">
        <summary>Labels &amp; volumes <span className="k8s-summary-count">{Object.keys(detail.labels).length} labels · {detail.volumes.length} volumes</span></summary>
        <div className="k8s-stack">
          <Section title="Labels"><Labels labels={detail.labels} /></Section>
          <Section title="Volumes"><ResourceList items={detail.volumes.map((v) => ({ label: v }))} empty="No volumes" /></Section>
        </div>
      </details>
      </div>
      <div className="k8s-pod-column">
      <details className="k8s-conditions k8s-card" open={detail.conditions.some((condition) => condition.status !== "True" || !READINESS_CONDITIONS.has(condition.type))}>
        <summary>Conditions <span className="k8s-summary-count">{detail.conditions.length ? `${detail.conditions.filter((condition) => condition.status === "True").length}/${detail.conditions.length} true` : "Not reported"}</span></summary>
        <div className="k8s-condition-list">
          {detail.conditions.length === 0 && <p className="k8s-meta">No conditions were reported for this Pod.</p>}
          {detail.conditions.map((c) => (
            <div key={c.type} className="k8s-condition-item">
              <div className="k8s-condition flex items-center justify-between">
                <span>{c.type}</span>
                <span className="k8s-condition-value" data-state={!READINESS_CONDITIONS.has(c.type) ? "unknown" : c.status === "True" ? "true" : c.status === "False" ? "false" : "unknown"}>{c.status}</span>
              </div>
              {(c.reason || c.message) && <p className="k8s-meta">{[c.reason, c.message].filter(Boolean).join(" · ")}</p>}
            </div>
          ))}
        </div>
      </details>
      <Section title="Connections" className="k8s-card">
        <div className="k8s-connection-group">
        <span className="k8s-meta">Owned by</span>
        {detail.ownerReferences.length === 0 ? <span className="text-[12px] text-muted-foreground">No owner references</span> : <RelationshipLinks items={detail.ownerReferences.map((owner) => ({ kind: owner.kind.toLowerCase(), name: owner.name, namespace: detail.namespace, label: `${owner.kind} · ${owner.name}` }))} />}
        </div>
        <div className="k8s-connection-group">
          <span className="k8s-meta">Selected by Services</span>
          {services.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">{servicesError ? "Service relationships unavailable" : servicesPending ? "Checking Service selectors…" : "No Services select this Pod by label"}</span>
          ) : (
            services.map((s) => (
              <div key={s.name} className="k8s-service-link">
                <RelationshipLinks items={[{ kind: "service", name: s.name, namespace: s.namespace, label: s.name }]} />
                <p className="k8s-meta">
                  ClusterIP: {s.clusterIp || "-"} · Ports: {s.ports || "-"}
                </p>
              </div>
            ))
          )}
        </div>
        <p className="k8s-meta">Label matches only. Open a Service to check its endpoints.</p>
        <ConceptHelp concept="selectors" />
      </Section>
      </div>
    </div>
  );
}

function ContainersTab({ containers, initContainers }: { containers: K8sContainer[]; initContainers: K8sContainer[] }) {
  const entries = [
    ...initContainers.map((container) => ({ container, init: true })),
    ...containers.map((container) => ({ container, init: false })),
  ];
  if (entries.length === 0) return <p className="k8s-meta">No containers were reported for this Pod.</p>;
  return (
    <div className="k8s-container-list">
      {entries.map(({ container: c, init }) => {
        const completed = init && c.state === "terminated" && c.exitCode === 0;
        const facts: { label: string; value: string; wide?: boolean }[] = [{ label: "State", value: c.state }, { label: "Restarts", value: String(c.restartCount) }];
        if (c.startedAt) facts.push({ label: "Started", value: c.startedAt, wide: true });
        if (c.exitCode != null) facts.push({ label: "Exit code", value: String(c.exitCode) });
        if (c.signal != null) facts.push({ label: "Signal", value: String(c.signal) });
        if (c.finishedAt) facts.push({ label: "Finished", value: c.finishedAt, wide: true });
        return <section key={`${init ? "init" : "app"}/${c.name}`} className="k8s-container-card k8s-card" aria-label={`${init ? "Init container" : "Container"} ${c.name}`}>
          <div className="k8s-container-header">
            <h3>{c.name}{init && <span className="k8s-summary-count">init container</span>}</h3>
            <span className="k8s-container-status" data-state={completed || c.ready ? "ready" : "waiting"}>{completed ? "Completed" : c.ready ? "Ready" : "Not ready"}</span>
          </div>
          <div className="k8s-container-layout">
            <div className="k8s-container-runtime">
              <div className="k8s-container-image"><span className="k8s-meta">Image</span><p>{c.image || "Not reported"}</p></div>
              <KVGrid rows={facts} />
              {(c.reason || c.message) && <p className="k8s-container-message">{[c.reason, c.message].filter(Boolean).join(": ")}</p>}
              {c.lastTermination && <div className="k8s-container-history">
                <span className="k8s-meta">Previous termination</span>
                <p>{c.lastTermination.reason || "Reason unavailable"} · exit {c.lastTermination.exitCode ?? "unknown"}{c.lastTermination.signal != null && ` · signal ${c.lastTermination.signal}`}</p>
                {c.lastTermination.startedAt && <p className="k8s-meta">Started: {c.lastTermination.startedAt}</p>}
                <p className="k8s-meta">Finished: {c.lastTermination.finishedAt || "Time unavailable"}</p>
                {c.lastTermination.message && <p>{c.lastTermination.message}</p>}
              </div>}
            </div>
            <div className="k8s-probes" aria-label="Container probes">
              {[
                { title: "Liveness", concept: "liveness", value: c.livenessProbe },
                { title: "Readiness", concept: "readiness", value: c.readinessProbe },
                { title: "Startup", concept: "startup", value: c.startupProbe },
              ].map((probe) => <div className="k8s-probe" key={probe.concept}>
                <h3>{probe.title}</h3>
                <p>{!probe.value || probe.value === "none" ? "Not configured" : probe.value}</p>
                <ConceptHelp concept={probe.concept} value={probe.value} />
              </div>)}
            </div>
          </div>
        </section>;
      })}
    </div>
  );
}

function EventsTab({ events, error }: { events: K8sPodDetail["events"]; error?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{error ? "Events unavailable; see the access error above." : "No retained events for this Pod. Older events may have expired."}</p>
      ) : (
        events.map((e, i) => (
          <div
            key={i}
            className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span
                className={cn(
                  "rounded px-1.5 py-0 text-[11px] font-semibold uppercase",
                  e.type === "Warning" ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400",
                )}
              >
                {e.type}
              </span>
              <span className="k8s-wrap text-[12px] font-medium text-foreground">{e.reason}</span>
              <span className="ml-auto text-[11px] text-muted-foreground">{e.lastSeen}</span>
            </div>
            <div className="k8s-wrap text-[12px] text-muted-foreground">{e.message}</div>
          </div>
        ))
      )}
    </div>
  );
}

function LogsTab({
  detail,
  setLogContainer,
  logs,
  logLoading,
  tailLive,
  setTailLive,
  selected,
  previous,
  setPrevious,
  timestamps,
  setTimestamps,
  search,
  setSearch,
  error,
  refresh,
}: {
  detail: K8sPodDetail;
  setLogContainer: (c: string) => void;
  logs: string;
  logLoading: boolean;
  tailLive: boolean;
  setTailLive: (v: boolean) => void;
  selected: string;
  previous: boolean;
  setPrevious: (value: boolean) => void;
  timestamps: boolean;
  setTimestamps: (value: boolean) => void;
  search: string;
  setSearch: (value: string) => void;
  error: string | null;
  refresh: () => void;
}) {
  const containers = [...detail.containers, ...(detail.initContainers || [])].map((c) => c.name);
  const lines = logs.split("\n");
  const matching = search ? lines.filter((line) => line.toLocaleLowerCase().includes(search.toLocaleLowerCase())) : lines;
  return (
    <div className="k8s-log-view">
      <div className="k8s-log-controls">
        <select
          aria-label="Log container"
          value={selected}
          onChange={(e) => setLogContainer(e.target.value)}
          className="h-7 rounded-md border border-border/40 bg-muted/40 px-2 text-[12px] text-foreground outline-none"
        >
          {containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select aria-label="Container log instance" value={previous ? "previous" : "current"} onChange={(event) => { setPrevious(event.target.value === "previous"); setTailLive(false); }} className="h-7 rounded-md border border-border/40 bg-muted/40 px-2 text-[12px] text-foreground outline-none"><option value="current">Current container</option><option value="previous">Previous container</option></select>
        <label className="flex items-center gap-1.5 text-[11px] text-foreground"><input type="checkbox" checked={timestamps} onChange={(event) => setTimestamps(event.target.checked)} />Timestamps</label>
        <label className="flex items-center gap-1.5 text-[11px] text-foreground">
          <input
            type="checkbox"
            checked={tailLive}
            disabled={previous}
            onChange={(e) => setTailLive(e.target.checked)}
            className="size-3 rounded border-border/40"
          />
          Refresh every 3s
        </label>
        <button type="button" disabled={logLoading || !selected} onClick={refresh} className="rounded border border-border/40 px-2 py-1 text-[11px] disabled:opacity-40">Refresh logs</button>
      </div>
      <div className="k8s-log-tools">
        <input aria-label="Search loaded logs" placeholder="Search loaded logs…" value={search} onChange={(event) => setSearch(event.target.value)} className="h-7 rounded border border-border/40 bg-muted/20 px-2 text-[12px]" />
        <CrashTimeline detail={detail} />
      </div>
      <p className="text-[11px] text-muted-foreground">Last 200 lines{search && ` · ${matching.length} matching lines`}. {previous ? "Only the previous container instance, if retained. Older logs may be unavailable." : "Bounded snapshots, not a continuous log stream."}</p>
      {error ? <p role="alert" className="text-[12px] text-amber-400">{previous ? "Previous-container logs unavailable" : "Could not read logs"}: {error}</p> : logLoading && !logs ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : (
        <pre className="k8s-code min-h-0 flex-1 rounded-md border border-border/40 bg-muted/20 text-foreground">
          {!selected ? "No container is available for logs." : !logs ? "No log output was returned for this container instance." : matching.length === 0 ? "No loaded lines match your search." : matching.join("\n")}
        </pre>
      )}
    </div>
  );
}

function NetworkTab({
  detail,
  services,
  servicesPending,
  servicesError,
}: {
  detail: K8sPodDetail;
  services: K8sService[];
  servicesPending: boolean;
  servicesError?: string;
}) {
  return (
    <div className="k8s-overview">
      <Section title="Pod Network">
        <KVGrid
          rows={[
            { label: "Pod IP", value: detail.ip },
            { label: "Host IP", value: detail.hostIp },
            { label: "Node", value: detail.node },
            { label: "QoS Class", value: detail.qosClass },
          ]}
        />
      </Section>

      <Section title="Services">
        <div className="flex flex-col gap-1">
          {services.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">{servicesError ? "Service relationships unavailable" : servicesPending ? "Checking Service selectors…" : "No Services select this Pod by label"}</span>
          ) : (
            services.map((s) => (
              <div key={s.name} className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={AiNetworkIcon} size={11} className="text-primary" />
                  <RelationshipLinks items={[{ kind: "service", name: s.name, namespace: s.namespace }]} />
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ClusterIP: {s.clusterIp || "-"} · Ports: {s.ports || "-"}
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(s.selector).map(([k, v]) => (
                    <span key={k} className="rounded bg-background/60 px-1.5 py-0 text-[11px] text-foreground">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">A selector match is not a reachability check. Inspect the Service's EndpointSlices and readiness next.</p>
        <ConceptHelp concept="selectors" />
      </Section>
    </div>
  );
}

function ResourcesTab({
  resources,
  usage,
}: {
  resources: K8sPodDetail["resources"];
  usage: K8sPodUsage | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3"><ConceptHelp concept="requests" /><ConceptHelp concept="limits" /></div>
      {usage && (
        <Section title="Live Usage">
          <KVGrid
            rows={[
              { label: "CPU", value: usage.cpu },
              { label: "Memory", value: usage.memory },
            ]}
          />
        </Section>
      )}

      <Section title="Requests / Limits">
        <div className="flex flex-col gap-2">
          {resources.length === 0 ? (
            <span className="text-[12px] text-muted-foreground">No resource configuration</span>
          ) : (
            resources.map((r) => (
              <div key={r.name} className="flex flex-col gap-1 rounded-md border border-border/40 bg-muted/20 p-3">
                <span className="text-[12px] font-semibold text-foreground">{r.name}</span>
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex flex-col gap-0.5 rounded bg-background/60 px-2 py-1">
                    <span className="text-[11px] text-muted-foreground">Requests</span>
                    <span className="text-[12px] text-foreground">CPU: {r.requests.cpu || "-"}</span>
                    <span className="text-[12px] text-foreground">Mem: {r.requests.memory || "-"}</span>
                    <span className="text-[12px] text-foreground">Ephemeral: {r.requests.ephemeralStorage || "-"}</span>
                  </div>
                  <div className="flex flex-col gap-0.5 rounded bg-background/60 px-2 py-1">
                    <span className="text-[11px] text-muted-foreground">Limits</span>
                    <span className="text-[12px] text-foreground">CPU: {r.limits.cpu || "-"}</span>
                    <span className="text-[12px] text-foreground">Mem: {r.limits.memory || "-"}</span>
                    <span className="text-[12px] text-foreground">Ephemeral: {r.limits.ephemeralStorage || "-"}</span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function NodeTab({ node, pending, assigned, error }: { node: K8sNodeInfo | null; pending: boolean; assigned: boolean; error?: string }) {
  if (!node) {
    return <p className="text-[12px] text-muted-foreground">{!assigned ? "No node is assigned to this Pod." : error ? "Node details unavailable; see the access error above." : pending ? "Loading node info…" : "Node details unavailable."}</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <Section title="Node Info">
        {node.metricsError && <p role="status" className="text-[12px] text-amber-400">Node metrics unavailable: {node.metricsError}</p>}
        <KVGrid
          rows={[
            { label: "Name", value: node.name },
            { label: "Status", value: node.status },
            { label: "Roles", value: node.roles },
            { label: "Age", value: node.age },
            { label: "Version", value: node.version },
            { label: "Internal IP", value: node.internalIp },
            { label: "External IP", value: node.externalIp || "-" },
            { label: "CPU Usage", value: node.topCpu },
            { label: "Memory Usage", value: node.topMem },
            { label: "OS", value: node.osImage },
            { label: "Kernel", value: node.kernelVersion },
            { label: "Runtime", value: node.containerRuntime },
            { label: "Architecture", value: node.architecture },
          ]}
        />
      </Section>

      <Section title="Capacity">
        <KVGrid
          rows={[
            { label: "CPU", value: node.capacity.cpu },
            { label: "Memory", value: node.capacity.memory },
            { label: "Pods", value: node.capacity.pods },
          ]}
        />
      </Section>

      <Section title="Allocatable">
        <KVGrid
          rows={[
            { label: "CPU", value: node.allocatable.cpu },
            { label: "Memory", value: node.allocatable.memory },
            { label: "Pods", value: node.allocatable.pods },
          ]}
        />
      </Section>
    </div>
  );
}


export default PodDetailPanel;
