import { useState } from "react";
import { describeDeployment } from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList, Badge, ConceptHelp, FindingCard, RelationshipLinks } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";
import { useK8sInspector } from "./K8sInspectorContext";

export function DeploymentDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeDeployment);
  const { navigate } = useK8sInspector();
  const [tab, setTab] = useState("overview");
  const ready = Number(data?.deployment.ready.split("/")[0] ?? 0);
  const desired = data?.deployment.desired ?? 0;

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
          <Section title="Pods" className="k8s-card">
            {data.podsError && <p role="status" className="text-[12px] text-amber-400">Unable to check Pods: {data.podsError}</p>}
            <ResourceList
              items={data.pods.map((p) => ({ label: p.name, sub: `${p.status} · ${p.ready}`, onClick: () => navigate("pod", p.name, p.namespace) }))}
              empty={data.podsError ? "Pod relationship could not be checked" : "No matching Pods found"}
            />
          </Section>
        ) : (
          <div className="k8s-stack">
            {ready < desired && <FindingCard
              title="Deployment is not fully ready"
              evidence={`${ready}/${desired} replicas ready; ${data.deployment.available} available.`}
              meaning="The desired replica count has not reached readiness. This is a symptom, not yet a confirmed cause."
              next="Inspect the affected Pods, their readiness checks and events."
              onEvidence={() => setTab("pods")}
              onNext={() => setTab("pods")}
              concept="replicas"
            />}
            <div className="k8s-overview">
              <div className="k8s-stack">
                <Section title="Replica Status" className="k8s-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={ready >= desired ? "success" : "warning"}>
                      {data.deployment.ready} ready
                    </Badge>
                    <Badge variant={data.deployment.available === String(data.deployment.desired) ? "success" : "warning"}>
                      {data.deployment.available} available
                    </Badge>
                    <Badge variant="default">{data.deployment.strategy}</Badge>
                  </div>
                  <ConceptHelp concept="replicas" value={`${data.deployment.ready} ready; ${data.deployment.available} available`} />
                </Section>
                <Section title="Deployment Info" className="k8s-card">
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
              </div>
              <div className="k8s-stack">
                <Section title="Selector" className="k8s-card">
                  <Labels labels={data.deployment.selector} />
                  {data.deployment.selectorText && <code className="break-all text-[11px] text-muted-foreground">{data.deployment.selectorText}</code>}
                  <ConceptHelp concept="selectors" />
                </Section>
                <Section title="Related ReplicaSets" className="k8s-card">
                  {data.replicaSetsError ? <p className="text-[12px] text-amber-400">Unable to check ReplicaSets: {data.replicaSetsError}</p> : <RelationshipLinks items={(data.replicaSets ?? []).map((rs) => ({ kind: "replicaset", name: rs.name, namespace: rs.namespace }))} />}
                </Section>
              </div>
            </div>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default DeploymentDetailPanel;
