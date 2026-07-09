import { useEffect, useState } from "react";
import {
  describeIngress,
  type K8sIngress,
} from "./client";
import { DetailPanelShell, DetailTabs, Section, KVGrid, YamlView } from "./K8sDetailCommon";

export function IngressDetailPanel({
  namespace,
  name,
  onClose,
}: {
  namespace: string;
  name: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<{ ingress: K8sIngress; yaml: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    describeIngress(namespace, name)
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
          <div className="flex flex-col gap-4">
            <Section title="Ingress Info">
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
              <div className="flex flex-col gap-2">
                {data.ingress.rules.map((r, i) => (
                  <div key={i} className="rounded-md border border-border/40 bg-muted/20 p-2.5">
                    <div className="text-[11.5px] font-semibold text-foreground">{r.host || "*"}</div>
                    <div className="flex flex-col gap-0.5">
                      {r.paths.map((p, j) => (
                        <div key={j} className="text-[11px] text-foreground">
                          {p.path || "/"} → {p.service}:{p.port}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </DetailPanelShell>
  );
}

export default IngressDetailPanel;
