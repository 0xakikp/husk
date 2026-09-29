import { useCallback, useState } from "react";
import { describeWorkload } from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList, Badge, ConceptHelp, FindingCard, RelationshipLinks } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";
import { useK8sInspector } from "./K8sInspectorContext";
import type { K8sReadScope } from "./configSource";

export function WorkloadDetailPanel({ kind, namespace, name, onClose }: {
  kind: "replicaset" | "statefulset" | "daemonset";
  namespace: string; name: string; onClose: () => void;
}) {
  const load = useCallback((ns: string, resourceName: string, context?: K8sReadScope) => describeWorkload(kind, ns, resourceName, context), [kind]);
  const { data, loading, error } = useK8sDetail(namespace, name, load);
  const { navigate } = useK8sInspector();
  const [tab, setTab] = useState("overview");
  const title = { replicaset: "ReplicaSet", statefulset: "StatefulSet", daemonset: "DaemonSet" }[kind];

  return <DetailPanelShell title={name} subtitle={`${namespace} · ${title}`} onClose={onClose}>
    <DetailTabs tabs={[{ id: "overview", label: "Overview" }, { id: "pods", label: "Pods" }, { id: "yaml", label: "YAML" }]} active={tab} onChange={setTab} />
    <div className="pt-3">
      {loading ? <p role="status" className="text-[12px] text-muted-foreground">Loading {title}…</p>
        : error ? <p role="alert" className="text-[12px] text-rose-400">{error}</p>
        : !data ? <p className="text-[12px] text-muted-foreground">No data</p>
        : tab === "yaml" ? <YamlView yaml={data.yaml} />
        : tab === "pods" ? <Section title="Matching Pods" className="k8s-card">
          {data.podsError && <p role="status" className="text-[12px] text-amber-400">Unable to check Pods: {data.podsError}</p>}
          <ResourceList items={data.pods.map((pod) => ({ label: pod.name, sub: `${pod.status} · ${pod.ready}`, onClick: () => navigate("pod", pod.name, pod.namespace) }))} empty={data.podsError ? "Pod relationship could not be checked" : "No matching Pods found"} />
        </Section>
        : <div className="k8s-stack">
          {data.workload.ready < data.workload.desired && <FindingCard
            title={`${title} is not fully ready`}
            evidence={`${data.workload.ready}/${data.workload.desired} Pods ready; ${data.workload.current} current.`}
            meaning={kind === "daemonset" ? "Some desired node placements do not have a ready Pod. Scheduling, startup or readiness may need investigation." : "Not all desired replicas have a ready Pod. The replica counts alone do not identify the cause."}
            next="Inspect matching Pods and their events to identify the first failing check."
            onEvidence={() => setTab("pods")} onNext={() => setTab("pods")} concept="replicas"
          />}
          <div className="k8s-overview">
            <div className="k8s-stack">
              <Section title="Readiness" className="k8s-card">
                <div><Badge variant={data.workload.ready >= data.workload.desired ? "success" : "warning"}>{data.workload.ready}/{data.workload.desired} ready</Badge></div>
                <ConceptHelp concept="replicas" value={`${data.workload.ready} ready of ${data.workload.desired} desired`} />
                <KVGrid rows={[
                  { label: "Desired", value: String(data.workload.desired) },
                  { label: "Current", value: String(data.workload.current) },
                  { label: "Ready", value: String(data.workload.ready) },
                  { label: "Updated", value: String(data.workload.updated) },
                  { label: "Strategy", value: data.workload.strategy || "—" },
                  { label: "Age", value: data.workload.age },
                ]} />
              </Section>
              {data.workload.conditions.length > 0 && <Section title="Conditions" className="k8s-card">
                <ResourceList items={data.workload.conditions.map((condition) => ({ label: `${condition.type}: ${condition.status}`, sub: [condition.reason, condition.message].filter(Boolean).join(" · ") }))} empty="No conditions reported" />
              </Section>}
            </div>
            <div className="k8s-stack">
              <Section title="Relationships" className="k8s-card">
                <RelationshipLinks items={[
                  ...data.workload.ownerReferences.map((owner) => ({ kind: owner.kind, name: owner.name, namespace })),
                  ...(data.workload.serviceName ? [{ kind: "service", name: data.workload.serviceName, namespace }] : []),
                ]} />
                <button type="button" className="self-start text-[12px] text-foreground hover:underline" onClick={() => setTab("pods")}>Inspect matching Pods</button>
              </Section>
              <Section title="Selector" className="k8s-card">
                <Labels labels={data.workload.selector} />
                {data.workload.selectorText && <code className="break-all text-[11px] text-muted-foreground">{data.workload.selectorText}</code>}
                <ConceptHelp concept="selectors" />
              </Section>
            </div>
          </div>
        </div>}
    </div>
  </DetailPanelShell>;
}

export default WorkloadDetailPanel;
