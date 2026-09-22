import { useCallback, useEffect, useRef, useState } from "react";
import {
  checkDocker,
  listContainers,
  listImages,
  type DockerContainer,
  type DockerImage,
} from "./client";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import { LoadingRow } from "@/components/Spinner";
import { ArrowLeft01Icon, ContainerIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { DockerDetailPanel, type DockerResourceSelection } from "./DockerDetailPanel";

export type { DockerResourceSelection };

export function DockerView({
  onClose,
  onBack,
  inline,
  onInspectResource,
  /* Defaults true so the dialog/standalone use keeps polling as before; only the
     sidebar passes it. */
  active = true,
}: {
  onClose?: () => void;
  /** Present when this built-in panel was opened from Tools. */
  onBack?: () => void;
  inline?: boolean;
  onInspectResource?: (sel: DockerResourceSelection) => void;
  /** False while another sidebar view is showing. The panel stays mounted so its
   *  state survives, but polling `docker ps` in the background would not. */
  active?: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"containers" | "images">("containers");
  const [selectedResource, setSelectedResource] = useState<DockerResourceSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(true);
  const [visible, setVisible] = useState(() => document.visibilityState !== "hidden");
  const inFlight = useRef(false);
  const generation = useRef(0);
  const canRefresh = useRef(active && visible); canRefresh.current = active && visible;
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const refresh = useCallback(async () => {
    if (inFlight.current || !canRefresh.current) return;
    inFlight.current = true;
    const request = generation.current;
    setLoading(true);
    setError(null);
    try {
      const ok = await checkDocker();
      if (request !== generation.current || !canRefresh.current) return;
      if (ok) {
        // Hold the single-flight gate until both requests settle, even if one
        // fails early while the other native command is still running.
        const [nextContainers, nextImages] = await Promise.allSettled([listContainers(), listImages()]);
        if (request !== generation.current || !canRefresh.current) return;
        if (nextContainers.status === "rejected") throw nextContainers.reason;
        if (nextImages.status === "rejected") throw nextImages.reason;
        setContainers(nextContainers.value);
        setImages(nextImages.value);
      } else {
        setContainers([]); setImages([]);
      }
      setAvailable(ok);
      setStale(false);
    } catch (reason) {
      if (request === generation.current && canRefresh.current) { setError(String(reason)); setStale(true); }
    } finally {
      inFlight.current = false;
      if (request === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    /* Gated on visibility. This view is now kept mounted when you switch sidebar
       views, so an ungated interval would run `docker ps` every 5s forever while
       you were reading Notes. Becoming visible refreshes once, so what you see on
       return is current rather than however stale it was when you left. */
    generation.current += 1;
    setLoading(false);
    setStale(true);
    if (!active || !visible) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { clearInterval(timer); generation.current += 1; };
  }, [refresh, active, visible]);

  const runningCount = containers.filter((c) => c.state === "running").length;

  const headerActions = (
    <button
      type="button"
      aria-label="Refresh"
      title="Refresh"
      disabled={loading}
      onClick={() => void refresh()}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Refresh01Icon} size={16} strokeWidth={1.5} />
    </button>
  );

  const leadingAction = onBack ? (
    <button
      type="button"
      aria-label="Back to tools"
      title="Back to tools"
      onClick={onBack}
      className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
    </button>
  ) : undefined;

  const handleSelect = (sel: DockerResourceSelection) => {
    if (loading || stale || error || !active || !visible) return;
    if (onInspectResource) {
      onInspectResource(sel);
      return;
    }
    // Fallback for dialog mode: show inline detail panel.
    setSelectedResource(sel);
  };

  const handleBack = () => setSelectedResource(null);

  const handleAction = async (fn: () => Promise<unknown>, label: string) => {
    try {
      await fn();
      toast({ title: label, variant: "success" });
      await refresh();
    } catch (e) {
      toast({
        title: "Docker error",
        message: e instanceof Error ? e.message : String(e),
        variant: "error",
      });
    }
  };

  return (
    <Modal title="Docker" icon={ContainerIcon} context="Local CLI" onClose={onClose} inline={inline} headerActions={<>{leadingAction}{headerActions}</>}>
      <details className="mb-2 text-[10px] leading-relaxed text-muted-foreground">
        <summary className="cursor-pointer rounded outline-none focus-visible:ring-1 focus-visible:ring-ring">Local Docker configuration</summary>
        <p className="mt-1">Uses this computer’s Docker CLI and configured connection, not the active SSH terminal. The configured Docker daemon may be remote.</p>
      </details>
      {error && <p role="alert" className="rounded border border-destructive/30 p-2 text-[10px] text-muted-foreground">Could not refresh Docker: {error}. Previously loaded data is stale; refresh before opening a resource.</p>}
      {stale && !error && !loading && (containers.length > 0 || images.length > 0) && <p role="status" className="text-[10px] text-muted-foreground">Waiting for a fresh Docker snapshot. Resource actions are paused.</p>}
      {available === false ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={ContainerIcon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">Docker not found</p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Start Docker Desktop and refresh, or install Docker.
          </p>
        </div>
      ) : selectedResource ? (
        <DockerDetailPanel
          selection={selectedResource}
          onClose={handleBack}
          onAction={handleAction}
        />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-0.5">
            {(["containers", "images"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-md px-2 py-0.5 text-[10px] capitalize transition-colors ${
                  tab === t
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                }`}
              >
                {t}
                {t === "containers" && (
                  <span className="ml-1 text-[9px] text-muted-foreground">
                    {runningCount}/{containers.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {tab === "containers" ? (
            <div className="flex flex-col gap-1">
              {loading && containers.length === 0 ? (
                <LoadingRow label="Loading containers" />
              ) : containers.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No containers.</p>
              ) : (
                containers.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    disabled={loading || stale || Boolean(error)}
                    onClick={() =>
                      handleSelect({ kind: "container", id: c.id, name: c.name })
                    }
                    className="flex flex-col gap-1 rounded-md border border-border/20 bg-card/20 px-2 py-1.5 text-left transition-colors hover:border-border/40 hover:bg-card/40"
                  >
                    <div className="flex items-start gap-2">
                      <span
                        className={`mt-1 size-1.5 shrink-0 rounded-full ${
                          c.state === "running" ? "bg-emerald-500" : "bg-muted-foreground/40"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="break-all text-[11px] font-medium leading-tight text-foreground">
                          {c.name}
                        </div>
                        <div className="mt-0.5 text-[9.5px] text-muted-foreground">{c.image}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[9.5px] text-muted-foreground">
                          <span>{c.status}</span>
                          {c.ports && <span>· {c.ports}</span>}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {loading && images.length === 0 ? (
                <LoadingRow label="Loading images" />
              ) : images.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No images.</p>
              ) : (
                images.map((im) => (
                  <button
                    key={`${im.id}-${im.tag}`}
                    type="button"
                    disabled={loading || stale || Boolean(error)}
                    onClick={() =>
                      handleSelect({
                        kind: "image",
                        id: im.id,
                        repo: im.repo,
                        tag: im.tag,
                      })
                    }
                    className="flex flex-col rounded-md border border-border/20 bg-card/20 px-2 py-1.5 text-left transition-colors hover:border-border/40 hover:bg-card/40"
                  >
                    <span className="break-all text-[11px] font-medium text-foreground">
                      {im.repo}:{im.tag}
                    </span>
                    <span className="text-[9.5px] text-muted-foreground">
                      {im.size} · {im.created}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
