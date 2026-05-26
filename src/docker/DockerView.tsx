import { useCallback, useEffect, useState } from "react";
import {
  checkDocker,
  listContainers,
  listImages,
  startContainer,
  stopContainer,
  removeContainer,
  type DockerContainer,
  type DockerImage,
} from "./client";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ContainerIcon,
  Refresh01Icon,
  PauseIcon,
  PlayIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";

export function DockerView({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"containers" | "images">("containers");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const ok = await checkDocker();
      setAvailable(ok);
      if (ok) {
        setContainers(await listContainers().catch(() => []));
        setImages(await listImages().catch(() => []));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const action = async (fn: () => Promise<unknown>, label: string) => {
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

  const runningCount = containers.filter((c) => c.state === "running").length;

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
    <Modal title="Docker" onClose={onClose} inline={inline} headerActions={headerActions}>
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
      ) : (
        <div className="flex flex-col gap-3">
          {/* Tabs */}
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
              {containers.length === 0 && !loading ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No containers.</p>
              ) : (
                containers.map((c) => (
                  <div
                    key={c.id}
                    className="flex flex-col gap-1 rounded-md border border-border/20 bg-card/20 px-2 py-1.5"
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
                    <div className="flex gap-0.5">
                      {c.state === "running" ? (
                        <button
                          type="button"
                          onClick={() => action(() => stopContainer(c.id), `Stopped ${c.name}`)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                        >
                          <HugeiconsIcon icon={PauseIcon} size={9} strokeWidth={2} />
                          Stop
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => action(() => startContainer(c.id), `Started ${c.name}`)}
                          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                        >
                          <HugeiconsIcon icon={PlayIcon} size={9} strokeWidth={2} />
                          Start
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          action(() => removeContainer(c.id), `Removed ${c.name}`)
                        }
                        className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
                      >
                        <HugeiconsIcon icon={Delete02Icon} size={9} strokeWidth={2} />
                        Remove
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              {images.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No images.</p>
              ) : (
                images.map((im) => (
                  <div
                    key={`${im.id}-${im.tag}`}
                    className="flex flex-col rounded-md border border-border/20 bg-card/20 px-2 py-1.5"
                  >
                    <span className="break-all text-[11px] font-medium text-foreground">
                      {im.repo}:{im.tag}
                    </span>
                    <span className="text-[9.5px] text-muted-foreground">
                      {im.size} · {im.created}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
