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
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";

const okStatus = (s: string) => s === "Running" || s === "Completed" || s === "Succeeded";

export function KubernetesView({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
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

  const headerActions = (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      onClick={() => void refresh()}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
    </button>
  );

  return (
    <Modal title="Kubernetes" onClose={onClose} inline={inline} headerActions={headerActions}>
      {available === false ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={Database01Icon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">kubectl not found</p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Install kubectl to use the Kubernetes integration.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {/* Context selector */}
          {contexts.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Context
              </span>
              <div className="flex flex-col gap-0.5">
                {contexts.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => switchCtx(c)}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 text-left text-[11.5px] transition-colors ${
                      c === ctx
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-accent/10"
                    }`}
                  >
                    <span
                      className={`size-1.5 rounded-full ${
                        c === ctx ? "bg-primary" : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="truncate">{c}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Pods */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Pods
            </span>
            {loading && pods.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">Loading…</p>
            ) : pods.length === 0 ? (
              <p className="py-4 text-center text-[11px] text-muted-foreground">No pods found.</p>
            ) : (
              <div className="flex flex-col gap-0.5">
                {pods.map((p) => (
                  <div
                    key={`${p.namespace}/${p.name}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors hover:bg-accent/10"
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${
                        okStatus(p.status) ? "bg-emerald-500" : "bg-muted-foreground/40"
                      }`}
                    />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[11.5px] text-foreground">{p.name}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {p.namespace} · {p.status} · {p.ready} · {p.age}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
