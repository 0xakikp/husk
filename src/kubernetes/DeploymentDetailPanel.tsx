import { useEffect, useState } from "react";
import {
  describeDeployment,
  type K8sDeployment,
  type K8sPod,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList, Badge } from "./K8sDetailCommon";

export function DeploymentDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ deployment: K8sDeployment & { strategy: string; selector: Record<string, string> }; pods: K8sPod[]; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeDeployment(namespace, name)
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
    <DetailPanelShell title={name} subtitle={`${namespace} · Deployment`} onClose={onClose}>
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
            <Section title="Replica Status">
              <div className="flex items-center gap-2">
                <Badge variant={data.deployment.current === data.deployment.desired ? "success" : "warning"}>
                  {data.deployment.current}/{data.deployment.desired} current
                </Badge>
                <Badge variant={data.deployment.available === String(data.deployment.desired) ? "success" : "warning"}>
                  {data.deployment.available} available
                </Badge>
                <Badge variant="default">{data.deployment.strategy}</Badge>
              </div>
            </Section>
            <Section title="Deployment Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.deployment.namespace },
                  { label: "Ready", value: data.deployment.ready },
                  { label: "Up-to-date", value: data.deployment.upToDate },
                  { label: "Available", value: data.deployment.available },
                  { label: "Age", value: data.deployment.age },
                  { label: "Strategy", value: data.deployment.strategy },
                ]}
              />
            </Section>
            <Section title="Selector">
              <Labels labels={data.deployment.selector} />
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default DeploymentDetailPanel;
