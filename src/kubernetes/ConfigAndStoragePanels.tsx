import { useEffect, useRef, useState } from "react";
import {
  describeConfigMap,
  describeSecret,
  getSecretYaml,
  describePersistentVolumeClaim,
  describeResourceQuota,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, YamlView, ResourceList, ConceptHelp, FindingCard } from "./K8sDetailCommon";
import { useK8sDetail } from "./useK8sDetail";
import { useK8sInspector } from "./K8sInspectorContext";

export function ConfigMapDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeConfigMap);
  const [tab, setTab] = useState("overview");

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · ConfigMap`} onClose={onClose}>
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
            <Section title="Info" className="k8s-card">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.configMap.namespace },
                  { label: "Keys", value: data.configMap.dataKeys.join(", ") },
                  { label: "Age", value: data.configMap.age },
                ]}
              />
            </Section>
            <Section title="Data" className="k8s-card">
              <ResourceList
                items={Object.entries(data.data).map(([k, v]) => ({
                  label: k,
                  sub: v.length > 120 ? `${v.slice(0, 120)}…` : v,
                }))}
                empty="No data"
              />
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export function SecretDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeSecret);
  const [tab, setTab] = useState("overview");
  const { readScope } = useK8sInspector();

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · Secret`} onClose={onClose}>
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
          <SecretYaml key={JSON.stringify([readScope, namespace, name])} namespace={namespace} name={name} redacted={data.yaml} />
        ) : (
          <div className="k8s-overview">
            <Section title="Info" className="k8s-card">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.secret.namespace },
                  { label: "Type", value: data.secret.type },
                  { label: "Keys", value: data.secret.dataKeys.join(", ") },
                  { label: "Age", value: data.secret.age },
                ]}
              />
            </Section>
            <Section title="Keys (names only, values hidden)" className="k8s-card">
              <ResourceList items={data.keys.map((k) => ({ label: k }))} empty="No keys" />
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export function PvcDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describePersistentVolumeClaim);
  const [tab, setTab] = useState("overview");

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · PVC`} onClose={onClose}>
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
            {data.pvc.status !== "Bound" && <FindingCard title="Volume claim is not bound" evidence={`Claim phase: ${data.pvc.status}. Storage class: ${data.pvc.storageClass || "not specified"}.`} meaning="The claim does not currently have a bound volume. Some storage classes wait for a Pod to be scheduled before binding." next="Review the claim configuration, storage class and consuming Pod events." onEvidence={() => setTab("yaml")} concept="pvc" />}
            <Section title="Info" className="k8s-card">
              <ConceptHelp concept="pvc" value={data.pvc.status} />
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.pvc.namespace },
                  { label: "Status", value: data.pvc.status },
                  { label: "Volume", value: data.pvc.volume },
                  { label: "Capacity", value: data.pvc.capacity },
                  { label: "Access Modes", value: data.pvc.accessModes },
                  { label: "Storage Class", value: data.pvc.storageClass },
                  { label: "Age", value: data.pvc.age },
                ]}
              />
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export function QuotaDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const { data, loading, error } = useK8sDetail(namespace, name, describeResourceQuota);
  const [tab, setTab] = useState("overview");

  return (
    <DetailPanelShell title={name} subtitle={`${namespace} · ResourceQuota`} onClose={onClose}>
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
            <Section title="Info" className="k8s-card">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.quota.namespace },
                  { label: "Scopes", value: data.quota.scopes },
                  { label: "Age", value: data.quota.age },
                ]}
              />
            </Section>
            <Section title="Hard vs Used" className="k8s-card">
              <div className="flex flex-col gap-1">
                {Object.keys(data.hard).length === 0 ? (
                  <span className="text-[12px] text-muted-foreground">No limits configured</span>
                ) : (
                  Object.entries(data.hard).map(([k, v]) => (
                    <div key={k} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                      <span className="k8s-wrap text-[12px] text-foreground">{k}</span>
                      <span className="k8s-wrap text-[12px] text-muted-foreground">
                        {data.used[k] || "0"} / {v}
                      </span>
                    </div>
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

export default { ConfigMapDetailPanel, SecretDetailPanel, PvcDetailPanel, QuotaDetailPanel };


/** Raw Secret values are fetched only after an explicit reveal and never retained across tabs. */
function SecretYaml({ namespace, name, redacted }: { namespace: string; name: string; redacted: string }) {
  const { readScope } = useK8sInspector();
  const [raw, setRaw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  useEffect(() => () => { request.current += 1; }, []);

  const hide = () => {
    request.current += 1;
    setRaw(null);
    setLoading(false);
    setFailed(false);
  };
  const reveal = async () => {
    const current = ++request.current;
    setLoading(true);
    setFailed(false);
    try {
      const yaml = await getSecretYaml(namespace, name, readScope);
      if (current === request.current) setRaw(yaml);
    } catch {
      if (current === request.current) setFailed(true);
    } finally {
      if (current === request.current) setLoading(false);
    }
  };

  return <div className="flex flex-col gap-2">
    <p className="text-[12px] text-muted-foreground">Values and annotations are redacted by default. Raw YAML can contain credentials; base64 is not encryption. Nothing is sent to AI.</p>
    <button type="button" className="self-start rounded border border-border px-2 py-1 text-[12px] hover:bg-muted" onClick={raw !== null || loading ? hide : () => { void reveal(); }}>
      {loading ? "Cancel reveal" : raw !== null ? "Hide sensitive YAML" : "Reveal sensitive YAML"}
    </button>
    {raw !== null && <p className="text-[12px] text-amber-400" role="status">Sensitive YAML visible. It is hidden when you leave this tab or inspector.</p>}
    {loading && <p className="text-[12px] text-muted-foreground" role="status">Loading sensitive YAML…</p>}
    {failed && <p className="text-[12px] text-rose-400" role="alert">Unable to reveal Secret YAML. Check cluster access and permissions, then retry.</p>}
    <YamlView yaml={raw ?? redacted} />
  </div>;
}
