import { useEffect, useState } from "react";
import {
  describeJob,
  type K8sJob,
  type K8sPod,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, YamlView, ResourceList } from "./K8sDetailCommon";

export function JobDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ job: K8sJob & { selector: Record<string, string> }; pods: K8sPod[]; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeJob(namespace, name)
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [namespace, name]);

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · Job`} onClose={onClose}>
      <DetailTabs
        tabs={[
          { id: "overview", label: "Overview" },
          { id: "pods", label: "Pods" },
          { id: "yaml", label: "YAML" },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div className="pt-3">
        {loading && !data ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !data ? (
          <p className="text-[12px] text-muted-foreground">No data</p>
        ) : tab === "yaml" ? (
          <YamlView yaml={data.yaml} />
        ) : tab === "pods" ? (
          <Section title="Pods">
            <ResourceList
              items={data.pods.map((p) => ({ label: p.name, sub: `${p.status} · ${p.ready}` }))}
              empty="No pods found"
            />
          </Section>
        ) : (
          <div className="flex flex-col gap-4">
            <Section title="Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.job.namespace },
                  { label: "Completions", value: data.job.completions },
                  { label: "Status", value: data.job.status },
                  { label: "Age", value: data.job.age },
                ]}
              />
            </Section>
            <Section title="Selector">
              <div className="flex flex-wrap gap-1">
                {Object.entries(data.job.selector).length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">No selector</span>
                ) : (
                  Object.entries(data.job.selector).map(([k, v]) => (
                    <span key={k} className="rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] text-foreground">
                      {k}: {v}
                    </span>
                  ))
                )}
              </div>
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default JobDetailPanel;
