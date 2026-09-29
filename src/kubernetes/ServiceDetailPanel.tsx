import { useState } from "react";
import { describeService } from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, Labels, YamlView, ResourceList, ConceptHelp, FindingCard, RelationshipLinks, Badge } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";
import { useK8sInspector } from "./K8sInspectorContext";

export function ServiceDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeService);
  const { navigate } = useK8sInspector();
  const [tab, setTab] = useState("overview");
  const [showEndpoints, setShowEndpoints] = useState(false);
  const hasSelector = Object.keys(data?.service.selector ?? {}).length > 0;
  const endpoints = data?.endpointSlices.flatMap((slice) => slice.endpoints) ?? [];
  const noPods = hasSelector && data && !data.podsError && data.pods.length === 0;
  const noEndpoints = hasSelector && data && !data.endpointSlicesError && endpoints.length === 0;
  const noneReady = endpoints.length > 0 && endpoints.every((endpoint) => endpoint.ready === false);

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
          <div className="k8s-stack">
            {(noPods || noEndpoints || noneReady) && <FindingCard
              title={noPods ? "Selector matches no Pods" : noEndpoints ? "No Service endpoints found" : "No endpoints report ready"}
              evidence={noPods ? `No Pods match ${data.selectorText || "this Service's selector"} in ${namespace}.` : noEndpoints ? "The EndpointSlice query succeeded but returned no endpoint addresses." : `${endpoints.length} endpoints explicitly report ready: false.`}
              meaning={noPods ? "The Service has no matching Pods in this namespace. Labels may not match, or the workload may not exist yet." : "The Service currently has no observed ready backend. The cause still needs investigation."}
              next="Inspect the selector, endpoint details and linked Pods; compare target ports and readiness checks."
              onEvidence={() => setShowEndpoints(true)} onNext={() => setShowEndpoints(true)} concept="selectors"
            />}
            <div className="k8s-overview">
              <div className="k8s-stack">
                <Section title="Service Info" className="k8s-card">
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
                <Section title="Selector" className="k8s-card">
                  <Labels labels={data.service.selector} />
                  {!hasSelector && <p className="text-[12px] text-muted-foreground">No Pod selector. ExternalName and manually managed endpoints do not require one.</p>}
                  <ConceptHelp concept="selectors" value={data.selectorText || "No selector"} />
                </Section>
              </div>
              <div className="k8s-stack">
                <Section title="Traffic relationships" className="k8s-card">
                  <p className="text-[11px] text-muted-foreground">Service → EndpointSlices → Pod backends. This shows configuration and readiness, not a live connectivity test.</p>
                  {data.endpointSlicesError && <p role="status" className="text-[12px] text-amber-400">Unable to check EndpointSlices: {data.endpointSlicesError}</p>}
                  <details open={showEndpoints} onToggle={(event) => setShowEndpoints(event.currentTarget.open)} className="k8s-secondary k8s-wrap rounded-md border border-border/40 p-2.5">
                    <summary className="cursor-pointer text-[12px]">EndpointSlices · {data.endpointSlicesError ? "unknown" : data.endpointSlices.length}</summary>
                    <div className="mt-2 flex flex-col gap-3">
                      {data.endpointSlices.length === 0 && <p className="text-[12px] text-muted-foreground">{data.endpointSlicesError ? "Endpoint information is unavailable." : "No EndpointSlices found."}</p>}
                      {data.endpointSlices.map((slice) => <div key={slice.name} className="k8s-wrap flex flex-col gap-1.5">
                        <p className="break-all text-[12px] font-medium">{slice.name}</p>
                        <p className="text-[11px] text-muted-foreground">{slice.addressType} · ports {slice.ports.map((port) => `${port.port ?? "unknown"}/${port.protocol ?? "TCP"}`).join(", ") || "not specified"}</p>
                        {slice.endpoints.map((endpoint, index) => <div key={index} className="flex flex-col gap-1 rounded border border-border/40 p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="k8s-wrap text-[12px]">{endpoint.addresses.join(", ")}</span>
                            <Badge variant={endpoint.ready === true ? "success" : endpoint.ready === false ? "warning" : "default"}>{endpoint.ready === true ? "Ready" : endpoint.ready === false ? "Not ready" : "Readiness unspecified"}</Badge>
                          </div>
                          {endpoint.targetRef && <RelationshipLinks items={[{ kind: endpoint.targetRef.kind, name: endpoint.targetRef.name, namespace: endpoint.targetRef.namespace || namespace }]} />}
                        </div>)}
                      </div>)}
                    </div>
                  </details>
                  <ConceptHelp concept="readiness" />
                </Section>
                {hasSelector && <Section title="Matching Pods" className="k8s-card">
                  {data.podsError && <p role="status" className="text-[12px] text-amber-400">Unable to check Pods: {data.podsError}</p>}
                  <ResourceList items={data.pods.map((pod) => ({ label: pod.name, sub: `${pod.status} · ${pod.ready}`, onClick: () => navigate("pod", pod.name, pod.namespace) }))} empty={data.podsError ? "Pod relationship could not be checked" : "No matching Pods found"} />
                </Section>}
              </div>
            </div>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default ServiceDetailPanel;
