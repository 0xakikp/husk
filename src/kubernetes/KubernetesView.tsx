import { useCallback, useEffect, useState } from "react";
import {
  checkKubectl,
  currentContext,
  listContexts,
  useContext,
  listPods,
  type K8sPod,
} from "./client";
import { toast } from "../toast";

const okStatus = (s: string) => s === "Running" || s === "Completed" || s === "Succeeded";

export function KubernetesView({ onClose }: { onClose: () => void }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [ctx, setCtx] = useState("");
  const [contexts, setContexts] = useState<string[]>([]);
  const [pods, setPods] = useState<K8sPod[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await checkKubectl();
      setAvailable(ok);
      if (ok) {
        setCtx(await currentContext());
        setContexts(await listContexts());
        setPods(await listPods().catch(() => []));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const switchCtx = async (c: string) => {
    try {
      await useContext(c);
      toast({ title: `Switched to ${c}`, variant: "success" });
      await refresh();
    } catch (e) {
      toast({
        title: "kubectl error",
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal docker-modal" role="dialog" aria-label="Kubernetes" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Kubernetes</span>
          <span className="modal-head-actions">
            <button type="button" className="ai-icon" title="Refresh" onClick={() => void refresh()}>
              ⟳
            </button>
            <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
              ×
            </button>
          </span>
        </div>
        <div className="modal-body">
          {available === false ? (
            <p className="rb-empty">kubectl isn't on your PATH.</p>
          ) : (
            <>
              {contexts.length > 0 ? (
                <label className="rb-field">
                  <span>Context</span>
                  <select
                    className="setting-select"
                    value={ctx}
                    onChange={(e) => switchCtx(e.target.value)}
                  >
                    {contexts.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="dv-section">Pods (all namespaces)</div>
              {loading && pods.length === 0 ? (
                <p className="rb-empty">Loading…</p>
              ) : pods.length === 0 ? (
                <p className="rb-empty">No pods.</p>
              ) : (
                pods.map((p) => (
                  <div key={`${p.namespace}/${p.name}`} className="rb-item">
                    <span className={`dv-dot ${okStatus(p.status) ? "dv-on" : "dv-off"}`} />
                    <div className="rb-meta">
                      <span className="rb-name">{p.name}</span>
                      <span className="rb-steps">
                        {p.namespace} · {p.status} · {p.ready} · {p.age}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
