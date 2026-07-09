import { useEffect, useState } from "react";
import {
  describeService,
  type K8sService,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList } from "./K8sDetailCommon";

export function ServiceDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ service: K8sService; endpoints: string[]; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeService(namespace, name)
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
    <DetailPanelShell title={name} subtitle={`${namespace} · Service`} onClose={onClose}>
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
          <div className="flex flex-col gap-4">
            <Section title="Service Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.service.namespace },
                  { label: "Type", value: data.service.type },
                  { label: "Cluster IP", value: data.service.clusterIp },
                  { label: "External IP", value: data.service.externalIp },
                  { label: "Ports", value: data.service.ports },
                ]}
              />
            </Section>
            <Section title="Selector">
              <Labels labels={data.service.selector} />
            </Section>
            <Section title="Endpoints">
              <ResourceList items={data.endpoints.map((e) => ({ label: e }))} empty="No endpoints" />
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default ServiceDetailPanel;
