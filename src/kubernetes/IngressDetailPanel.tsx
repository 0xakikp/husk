import { useState } from "react";
import { describeIngress } from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, YamlView, RelationshipLinks } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";

export function IngressDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeIngress);
  const [tab, setTab] = useState("overview");

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · Ingress`} onClose={onClose}>
      <DetailTabs
        tabs={[
          { id: "overview", label: "Overview" },
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
        ) : (
          <div className="k8s-stack">
            <Section title="Ingress Info" className="k8s-card">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.ingress.namespace },
                  { label: "Class", value: data.ingress.class || "-" },
                  { label: "Age", value: data.ingress.age },
                  { label: "Hosts", value: data.ingress.hosts.join(", ") },
                ]}
              />
            </Section>
            <Section title="Rules">
              <div className="k8s-overview">
                {data.ingress.rules.map((r, i) => (
                  <div key={i} className="k8s-card k8s-stack">
                    <div className="k8s-wrap text-[12px] font-semibold text-foreground">{r.host || "*"}</div>
                    <div className="k8s-stack">
                      {r.paths.map((p, j) => (
                        <div key={j} className="k8s-wrap flex flex-col gap-1 text-[12px] text-foreground">
                          <span>{p.path || "/"} → port {p.port}</span>
                          <RelationshipLinks items={[{ kind: "service", name: p.service, namespace }]} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {data.ingress.rules.length === 0 && <p className="text-[12px] text-muted-foreground">No rules configured</p>}
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default IngressDetailPanel;
