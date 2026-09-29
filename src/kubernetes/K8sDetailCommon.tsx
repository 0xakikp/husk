import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, Copy01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { inspectableKinds, useK8sInspector } from "./K8sInspectorContext";
import { shq } from "../lib/shellQuote";
import { configEnvironment, configSourceName, type K8sConfigSource } from "./configSource";
import "./kubernetes.css";

export function DetailPanelShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { context, config, refresh } = useK8sInspector();
  return (
    <div className="k8s-surface flex h-full flex-col bg-background text-foreground">
      <div className="k8s-header flex shrink-0 items-center justify-between border-b border-border">
        <div className="flex min-w-0 flex-col">
          <span title={title} className="k8s-title truncate font-semibold text-foreground">{title}</span>
          <span title={`${context} · ${subtitle}`} className="k8s-wrap text-[11px] text-muted-foreground">{context ? `${context} · ` : ""}{subtitle}</span>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={title} />
          <button type="button" aria-label="Refresh details" title="Refresh details" onClick={refresh} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground">
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
      <div className="k8s-body min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}

export function DetailTabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="k8s-tabs flex shrink-0 border-b border-border/50">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={active === t.id}
          onClick={() => onChange(t.id)}
          className="flex items-center gap-1.5 text-[11px] font-medium transition-colors"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const copy = () => {
    void navigator.clipboard.writeText(text);
  };
  return (
    <button
      type="button"
      aria-label="Copy name"
      title="Copy name"
      onClick={copy}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
    </button>
  );
}

export function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("k8s-section", className)}>
      <h3>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ConfigSourceCaption({ source }: { source?: K8sConfigSource }) {
  if (!source) return null;
  return <span className="k8s-source-caption" title={source.paths.join("\n")}>
    {configSourceName(source)} · {source.paths.join(" · ")}
  </span>;
}

/** Optional checks must remain distinguishable from a failure to inspect the resource. */
export function CheckWarnings({ errors, leading }: { errors: Record<string, string>; leading?: React.ReactNode }) {
  const entries = Object.entries(errors);
  if (entries.length === 0) return leading ? <>{leading}</> : null;
  return <details className="k8s-check-warnings">
    <summary>
      {leading && <span className="k8s-check-leading">{leading}</span>}
      <span className="k8s-check-label" role="status">{entries.map(([part]) => part).join(", ")} unavailable</span>
    </summary>
    <div className="k8s-check-content">
      <p>Some checks could not be completed. Missing data is not a health result.</p>
      <dl>{entries.map(([part, failure]) => <div key={part}><dt>{part}</dt><dd>{failure}</dd></div>)}</dl>
    </div>
  </details>;
}

export function KVGrid({ rows }: { rows: { label: string; value: string; wide?: boolean }[] }) {
  return (
    <dl className="k8s-facts">
      {rows.map((r) => (
        <div key={r.label} className="k8s-fact" data-wide={r.wide || r.value.length > 36 || undefined}>
          <dt>{r.label}</dt>
          <dd title={r.value || "-"}>{r.value || "-"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function YamlView({ yaml }: { yaml: string }) {
  return (
    <pre className="k8s-code rounded-md border border-border/40 bg-muted/20 text-foreground">
      {yaml}
    </pre>
  );
}

export function Badge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "success" | "warning" | "error" }) {
  const classes = {
    default: "bg-muted/40 text-foreground",
    success: "bg-emerald-500/15 text-emerald-400",
    warning: "bg-amber-500/15 text-amber-400",
    error: "bg-rose-500/15 text-rose-400",
  };
  return (
    <span className={cn("rounded px-1.5 py-0 text-[11px] font-semibold", classes[variant])}>
      {children}
    </span>
  );
}

export function Labels({ labels }: { labels: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(labels).length === 0 ? (
        <span className="text-[12px] text-muted-foreground">No labels</span>
      ) : (
        Object.entries(labels).map(([k, v]) => (
          <span
            key={k}
            className="k8s-label rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[11px] text-foreground"
          >
            {k}: {v}
          </span>
        ))
      )}
    </div>
  );
}

export function ResourceList({ items, empty }: { items: { label: string; sub?: string; onClick?: () => void }[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 ? (
        <span className="text-[12px] text-muted-foreground">{empty}</span>
      ) : (
        items.map((item, i) => (
          <div key={i} className="k8s-resource-row rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
            {item.onClick ? <button type="button" onClick={item.onClick} className="w-full text-left text-[12px] text-foreground underline decoration-border underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-ring">{item.label}</button> :
            <div className="text-[12px] text-foreground">{item.label}</div>
            }
            {item.sub && <div className="text-[11px] text-muted-foreground">{item.sub}</div>}
          </div>
        ))
      )}
    </div>
  );
}

const CONCEPTS: Record<string, { label: string; explanation: string }> = {
  readiness: { label: "Readiness", explanation: "Ready means the container can serve traffic. A failed readiness probe marks the Pod not ready; it does not itself restart the container. Running is not the same as ready." },
  liveness: { label: "Liveness", explanation: "A liveness probe checks whether a container needs restarting. Repeated failures can trigger a restart. Check the application and probe before increasing thresholds." },
  startup: { label: "Startup probe", explanation: "A startup probe gives a slow-starting application time to initialise. When configured, readiness and liveness probes wait until it succeeds." },
  requests: { label: "Resource requests", explanation: "Requests are the CPU and memory Kubernetes uses to place a Pod on a node. A Pending Pod may be waiting for a node that can satisfy these requests." },
  limits: { label: "Resource limits", explanation: "Limits bound a container’s resource use. CPU can be throttled; exceeding available memory under a memory limit can lead to termination. An OOM diagnosis needs termination and usage evidence, not just a high number." },
  selectors: { label: "Selectors", explanation: "Selectors match labels, not resource names. A Service uses them to find Pods; a workload uses them to identify its replicas. No matches may indicate a label mismatch, but can also mean nothing has been created yet." },
  replicas: { label: "Replicas", explanation: "Desired is the target count. Current counts existing replicas; ready counts those ready to serve. Available also accounts for availability requirements. Matching current and desired alone does not prove health." },
  pending: { label: "Pending", explanation: "Pending means the Pod has been accepted but is not fully started. Scheduling, storage, image pulls or container setup may be involved. Conditions and events identify which stage needs attention." },
  pvc: { label: "PersistentVolumeClaim", explanation: "A PVC requests storage independently of a Pod’s lifetime. Pending can mean no suitable volume or provisioner is available, or that storage is deliberately waiting for a consumer to be scheduled." },
  qos: { label: "Quality of Service", explanation: "QoS groups Pods according to container requests and limits. It influences how Kubernetes handles resource pressure; it is not a guarantee that a Pod will stay running." },
};

export function ConceptHelp({ concept, value, command }: { concept: string; value?: string; command?: string }) {
  const scope = useK8sInspector();
  const entry = CONCEPTS[concept];
  if (!entry) return null;
  const equivalent = command || (scope.context && scope.kind && scope.name
    ? `${configEnvironment(scope.config, shq)}kubectl --context ${shq(scope.context)} -n ${shq(scope.namespace)} get ${shq(scope.kind)} ${shq(scope.name)} -o yaml`
    : "");
  return <details className="k8s-concept text-muted-foreground">
    <summary className="w-fit cursor-pointer rounded hover:text-foreground focus-visible:outline focus-visible:outline-ring">Explain {entry.label.toLowerCase()}</summary>
    <div className="k8s-concept-content border-l border-border">
      <p className="m-0">{entry.explanation}</p>
      {value && <p className="mt-1 text-foreground">Here: {value}</p>}
      {equivalent && <div className="mt-2">
        <p>Inspect the source (read-only):</p>
        <code className="block select-text break-all text-foreground">{equivalent}</code>
      </div>}
    </div>
  </details>;
}

export function RelationshipLinks({ items }: { items: { kind: string; name: string; namespace?: string; label?: string }[] }) {
  const { context, navigate } = useK8sInspector();
  return <div aria-label="Related resources" className="k8s-relations flex flex-wrap gap-1.5">
    {items.map((item, index) => {
      const label = item.label || `${item.kind} · ${item.name}`;
      const classes = "rounded border border-border/60 px-2 py-1 text-[11px]";
      return context && inspectableKinds.has(item.kind.toLowerCase()) ?
        <button key={`${item.kind}/${item.name}/${index}`} type="button" title={label} onClick={() => navigate(item.kind, item.name, item.namespace)} className={`${classes} text-foreground hover:border-primary/50 focus-visible:outline focus-visible:outline-ring`}>{label} →</button> :
        <span key={`${item.kind}/${item.name}/${index}`} className={`${classes} text-muted-foreground`} title={label}>{label}</span>;
    })}
  </div>;
}

export function FindingCard({ title, evidence, meaning, next, onEvidence, onNext, concept }: {
  title: string; evidence: string; meaning: string; next: string;
  onEvidence?: () => void; onNext?: () => void; concept?: string;
}) {
  return <section aria-label={title} className="k8s-finding rounded-md border border-border bg-muted/10">
    <h3 className="m-0 text-[12px] font-semibold text-foreground">{title}</h3>
    <p className="k8s-finding-evidence text-muted-foreground"><span className="text-foreground">Evidence: </span>{evidence}</p>
    <p className="k8s-finding-meaning text-muted-foreground">{meaning}</p>
    <p className="k8s-finding-next text-muted-foreground"><span className="text-foreground">Next: </span>{next}</p>
    {(onEvidence || onNext) && <div className="k8s-finding-actions">
      {onEvidence && <button type="button" onClick={onEvidence} className="rounded p-0 text-[11px] underline underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-ring">View evidence</button>}
      {onNext && <button type="button" onClick={onNext} className="rounded p-0 text-[11px] underline underline-offset-2 hover:text-primary focus-visible:outline focus-visible:outline-ring">Next check</button>}
    </div>}
    {concept && <div className="mt-2"><ConceptHelp concept={concept} /></div>}
  </section>;
}
