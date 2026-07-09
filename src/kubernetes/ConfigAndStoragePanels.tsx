import { useEffect, useState } from "react";
import {
  describeConfigMap,
  describeSecret,
  describePersistentVolumeClaim,
  describeResourceQuota,
  type K8sConfigMap,
  type K8sSecret,
  type K8sPersistentVolumeClaim,
  type K8sResourceQuota,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, YamlView, ResourceList } from "./K8sDetailCommon";

export function ConfigMapDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ configMap: K8sConfigMap; data: Record<string, string>; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeConfigMap(namespace, name)
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
          <div className="flex flex-col gap-4">
            <Section title="Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.configMap.namespace },
                  { label: "Keys", value: data.configMap.dataKeys.join(", ") },
                  { label: "Age", value: data.configMap.age },
                ]}
              />
            </Section>
            <Section title="Data">
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
  const [data, setData] = useState<{ secret: K8sSecret; keys: string[]; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeSecret(namespace, name)
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
          <YamlView yaml={data.yaml} />
        ) : (
          <div className="flex flex-col gap-4">
            <Section title="Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.secret.namespace },
                  { label: "Type", value: data.secret.type },
                  { label: "Keys", value: data.secret.dataKeys.join(", ") },
                  { label: "Age", value: data.secret.age },
                ]}
              />
            </Section>
            <Section title="Keys (names only, values hidden)">
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
  const [data, setData] = useState<{ pvc: K8sPersistentVolumeClaim; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describePersistentVolumeClaim(namespace, name)
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
          <div className="flex flex-col gap-4">
            <Section title="Info">
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
  const [data, setData] = useState<{ quota: K8sResourceQuota; hard: Record<string, string>; used: Record<string, string>; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeResourceQuota(namespace, name)
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
          <div className="flex flex-col gap-4">
            <Section title="Info">
              <KVGrid
                rows={[
                  { label: "Namespace", value: data.quota.namespace },
                  { label: "Scopes", value: data.quota.scopes },
                  { label: "Age", value: data.quota.age },
                ]}
              />
            </Section>
            <Section title="Hard vs Used">
              <div className="flex flex-col gap-1">
                {Object.keys(data.hard).length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">No limits configured</span>
                ) : (
                  Object.entries(data.hard).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
                      <span className="text-[11px] text-foreground">{k}</span>
                      <span className="text-[11px] text-muted-foreground">
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
