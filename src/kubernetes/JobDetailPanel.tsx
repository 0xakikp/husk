import { useState } from "react";
import { describeJob } from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList, ConceptHelp } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";
import { useK8sInspector } from "./K8sInspectorContext";

export function JobDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeJob);
  const { navigate } = useK8sInspector();
  const [tab, setTab] = useState("overview");

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
          <Section title="Pods" className="k8s-card">
            <ResourceList
              items={data.pods.map((p) => ({ label: p.name, sub: `${p.status} · ${p.ready}`, onClick: () => navigate("pod", p.name, p.namespace) }))}
              empty="No pods found"
            />
          </Section>
        ) : (
          <div className="k8s-overview">
            <Section title="Info" className="k8s-card">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.job.namespace },
                  { label: "Completions", value: data.job.completions },
                  { label: "Status", value: data.job.status },
                  { label: "Age", value: data.job.age },
                ]}
              />
            </Section>
            <Section title="Selector" className="k8s-card">
              <ConceptHelp concept="selectors" />
              {Object.keys(data.job.selector).length > 0 ? <Labels labels={data.job.selector} /> : <span className="text-[12px] text-muted-foreground">No selector</span>}
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default JobDetailPanel;
