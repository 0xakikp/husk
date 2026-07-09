import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  Refresh01Icon,
  Cancel01Icon,
  File01Icon,
  BotIcon,
  Mining01Icon,
  AiNetworkIcon,
  LinkIcon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import {
  describePod,
  getPodLogs,
  getServicesForPod,
  type K8sPodDetail,
  type K8sContainer,
  type K8sService,
} from "./client";

export function PodDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<K8sPodDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "containers" | "events" | "logs" | "network">("overview");
  const [logContainer, setLogContainer] = useState<string | "">("");
  const [logs, setLogs] = useState<string>("");
  const [logLoading, setLogLoading] = useState(false);
  const [services, setServices] = useState<K8sService[]>([]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const d = await describePod(namespace, name);
      setDetail(d);
      const svc = await getServicesForPod(namespace, d.labels);
      setServices(svc);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [namespace, name]);

  useEffect(() => {
    if (tab !== "logs" || !detail) return;
    const container = logContainer || detail.containers[0]?.name;
    if (!container) return;
    setLogLoading(true);
    getPodLogs(namespace, name, container)
      .then((text) => setLogs(text))
      .catch((e) => setLogs(`Error fetching logs: ${e instanceof Error ? e.message : String(e)}`))
      .finally(() => setLogLoading(false));
  }, [tab, logContainer, namespace, name, detail]);

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
    <div className="flex h-full flex-col bg-background text-foreground">
      {/* Header */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={Database01Icon} size={14} strokeWidth={1.75} className="text-primary" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {namespace} · {detail?.phase || "…"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading}
            onClick={() => void load()}
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
      </div>

      {/* Tabs */}
      <div className="flex shrink-0 gap-1 border-b border-border/50 px-2">
        {[
          { id: "overview", label: "Overview", icon: File01Icon },
          { id: "containers", label: "Containers", icon: BotIcon },
          { id: "events", label: "Events", icon: Mining01Icon },
          { id: "logs", label: "Logs", icon: ArrowRight01Icon },
          { id: "network", label: "Network", icon: AiNetworkIcon },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id as typeof tab)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={t.icon} size={12} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !detail ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[12px] text-muted-foreground">No data</p>
        ) : (
          <div className="flex flex-col gap-4">
            {tab === "overview" && <OverviewTab detail={detail} age={podAge} services={services} />}
            {tab === "containers" && <ContainersTab containers={detail.containers} />}
            {tab === "events" && <EventsTab events={detail.events} />}
            {tab === "logs" && (
              <LogsTab
                detail={detail}
                logContainer={logContainer}
                setLogContainer={setLogContainer}
                logs={logs}
                logLoading={logLoading}
              />
            )}
            {tab === "network" && <NetworkTab detail={detail} services={services} />}
          </div>
        )}
      </div>
    </div>
  );
}

function OverviewTab({
  detail,
  age,
  services,
}: {
  detail: K8sPodDetail;
  age: (iso: string) => string;
  services: K8sService[];
}) {
  const rows = [
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

  return (
    <>
      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pod Info
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {rows.map((r) => (
            <div key={r.label} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
              <div className="text-[10px] text-muted-foreground">{r.label}</div>
              <div className="truncate text-[11.5px] font-medium text-foreground">{r.value}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Conditions
        </h3>
        <div className="flex flex-col gap-1">
          {detail.conditions.map((c) => (
            <div
              key={c.type}
              className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5"
            >
              <span className="text-[11.5px] text-foreground">{c.type}</span>
              <span
                className={cn(
                  "rounded px-1.5 py-0 text-[10px] font-semibold",
                  c.status === "True" ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400",
                )}
              >
                {c.status}
              </span>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Labels
        </h3>
        <div className="flex flex-wrap gap-1">
          {Object.entries(detail.labels).length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No labels</span>
          ) : (
            Object.entries(detail.labels).map(([k, v]) => (
              <span
                key={k}
                className="rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] text-foreground"
              >
                {k}: {v}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Owner References
        </h3>
        <div className="flex flex-col gap-1">
          {detail.ownerReferences.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No owner references</span>
          ) : (
            detail.ownerReferences.map((r) => (
              <div key={`${r.kind}-${r.name}`} className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                <span className="rounded bg-primary/10 px-1.5 py-0 text-[9px] font-semibold text-primary">{r.kind}</span>
                <span className="text-[11.5px] text-foreground">{r.name}</span>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Services
        </h3>
        <div className="flex flex-col gap-1">
          {services.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No services route to this pod</span>
          ) : (
            services.map((s) => (
              <div key={s.name} className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={LinkIcon} size={11} className="text-primary" />
                  <span className="text-[11.5px] font-medium text-foreground">{s.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ClusterIP: {s.clusterIp || "-"} · Ports: {s.ports || "-"}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}

function ContainersTab({ containers }: { containers: K8sContainer[] }) {
  return (
    <div className="flex flex-col gap-2">
      {containers.map((c) => (
        <div key={c.name} className="flex flex-col gap-2 rounded-md border border-border/40 bg-muted/20 p-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-semibold text-foreground">{c.name}</span>
            <span
              className={cn(
                "rounded px-1.5 py-0 text-[10px] font-semibold",
                c.ready ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400",
              )}
            >
              {c.ready ? "Ready" : "Not Ready"}
            </span>
          </div>
          <div className="text-[10px] text-muted-foreground">Image: {c.image}</div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded bg-background/60 px-2 py-1">
              <div className="text-[9px] text-muted-foreground">State</div>
              <div className="text-[11px] font-medium text-foreground">{c.state}</div>
            </div>
            <div className="rounded bg-background/60 px-2 py-1">
              <div className="text-[9px] text-muted-foreground">Restarts</div>
              <div className="text-[11px] font-medium text-foreground">{c.restartCount}</div>
            </div>
          </div>
          {c.reason && (
            <div className="rounded bg-rose-500/10 px-2 py-1 text-[11px] text-rose-400">
              {c.reason}: {c.message}
            </div>
          )}
          {c.startedAt && (
            <div className="text-[10px] text-muted-foreground">Started: {c.startedAt}</div>
          )}
        </div>
      ))}
    </div>
  );
}

function EventsTab({ events }: { events: K8sPodDetail["events"] }) {
  return (
    <div className="flex flex-col gap-1">
      {events.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">No events for this pod.</p>
      ) : (
        events.map((e, i) => (
          <div
            key={i}
            className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5"
          >
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "rounded px-1.5 py-0 text-[9px] font-semibold uppercase",
                  e.type === "Warning" ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400",
                )}
              >
                {e.type}
              </span>
              <span className="text-[11px] font-medium text-foreground">{e.reason}</span>
              <span className="ml-auto text-[10px] text-muted-foreground">{e.lastSeen}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">{e.message}</div>
          </div>
        ))
      )}
    </div>
  );
}

function LogsTab({
  detail,
  logContainer,
  setLogContainer,
  logs,
  logLoading,
}: {
  detail: K8sPodDetail;
  logContainer: string;
  setLogContainer: (c: string) => void;
  logs: string;
  logLoading: boolean;
}) {
  const containers = detail.containers.map((c) => c.name);
  const selected = logContainer || containers[0] || "";
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center gap-2">
        <select
          value={selected}
          onChange={(e) => setLogContainer(e.target.value)}
          className="h-7 rounded-md border border-border/40 bg-muted/40 px-2 text-[11px] text-foreground outline-none"
        >
          {containers.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-muted-foreground">Last 200 lines</span>
      </div>
      {logLoading ? (
        <div className="flex flex-col gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-3 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {logs || "(no logs)"}
        </pre>
      )}
    </div>
  );
}

function NetworkTab({
  detail,
  services,
}: {
  detail: K8sPodDetail;
  services: K8sService[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pod Network
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Pod IP", value: detail.ip },
            { label: "Host IP", value: detail.hostIp },
            { label: "Node", value: detail.node },
            { label: "QoS Class", value: detail.qosClass },
          ].map((r) => (
            <div key={r.label} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
              <div className="text-[10px] text-muted-foreground">{r.label}</div>
              <div className="truncate text-[11.5px] font-medium text-foreground">{r.value || "-"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Services
        </h3>
        <div className="flex flex-col gap-1">
          {services.length === 0 ? (
            <span className="text-[11px] text-muted-foreground">No services route to this pod</span>
          ) : (
            services.map((s) => (
              <div key={s.name} className="flex flex-col gap-0.5 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon icon={LinkIcon} size={11} className="text-primary" />
                  <span className="text-[11.5px] font-medium text-foreground">{s.name}</span>
                </div>
                <div className="text-[10px] text-muted-foreground">
                  ClusterIP: {s.clusterIp || "-"} · Ports: {s.ports || "-"}
                </div>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(s.selector).map(([k, v]) => (
                    <span key={k} className="rounded bg-background/60 px-1.5 py-0 text-[9px] text-foreground">
                      {k}: {v}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

export default PodDetailPanel;
