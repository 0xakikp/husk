import { useCallback, useEffect, useState } from "react";
import {
  checkDocker,
  listContainers,
  listImages,
  startContainer,
  stopContainer,
  removeContainer,
  describeContainer,
  describeImage,
  getContainerStats,
  type DockerContainer,
  type DockerImage,
  type DockerContainerDetail,
  type DockerImageDetail,
  type DockerContainerStats,
} from "./client";
import { runInActiveTerminal } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";
import { toast } from "../toast";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ContainerIcon,
  Refresh01Icon,
  PauseIcon,
  PlayIcon,
  Delete02Icon,
  ArrowLeft01Icon,
  File01Icon,
  ArrowRight01Icon,
  AiNetworkIcon,
  Database01Icon,
  Mining01Icon,
  BotIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export function DockerView({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [images, setImages] = useState<DockerImage[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"containers" | "images">("containers");
  const [selectedContainer, setSelectedContainer] = useState<DockerContainer | null>(null);
  const [selectedImage, setSelectedImage] = useState<DockerImage | null>(null);

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
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
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
      ) : selectedContainer ? (
        <ContainerDetailPanel
          container={selectedContainer}
          onBack={() => setSelectedContainer(null)}
          onAction={action}
        />
      ) : selectedImage ? (
        <ImageDetailPanel image={selectedImage} onBack={() => setSelectedImage(null)} />
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
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedContainer(c)}
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
              {images.length === 0 ? (
                <p className="py-4 text-center text-[11px] text-muted-foreground">No images.</p>
              ) : (
                images.map((im) => (
                  <button
                    key={`${im.id}-${im.tag}`}
                    type="button"
                    onClick={() => setSelectedImage(im)}
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

function ContainerDetailPanel({
  container,
  onBack,
  onAction,
}: {
  container: DockerContainer;
  onBack: () => void;
  onAction: (fn: () => Promise<unknown>, label: string) => Promise<void>;
}) {
  const [detail, setDetail] = useState<DockerContainerDetail | null>(null);
  const [stats, setStats] = useState<DockerContainerStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "logs" | "network" | "volumes" | "inspect" | "stats">("overview");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [d, s] = await Promise.all([
        describeContainer(container.id),
        getContainerStats(container.id).catch(() => null),
      ]);
      setDetail(d);
      setStats(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [container.id]);

  const sendToTerminal = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Sent to terminal: ${cmd}`, variant: "info" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const name = container.name;

  return (
    <div className="flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">{name}</div>
          <div className="truncate text-[10px] text-muted-foreground">
            {container.image} · {container.status}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-1">
        {container.state === "running" ? (
          <ActionButton
            icon={PauseIcon}
            label="Stop"
            onClick={() => onAction(() => stopContainer(container.id), `Stopped ${name}`)}
          />
        ) : (
          <ActionButton
            icon={PlayIcon}
            label="Start"
            onClick={() => onAction(() => startContainer(container.id), `Started ${name}`)}
          />
        )}
        <ActionButton
          icon={Delete02Icon}
          label="Remove"
          onClick={() => onAction(() => removeContainer(container.id), `Removed ${name}`)}
        />
        <ActionButton
          icon={ArrowRight01Icon}
          label="Logs"
          onClick={() => sendToTerminal(`docker logs --tail 500 -f ${shq(name)}`)}
        />
        <ActionButton
          icon={File01Icon}
          label="Inspect"
          onClick={() => sendToTerminal(`docker inspect ${shq(name)}`)}
        />
        <ActionButton
          icon={BotIcon}
          label="Shell"
          onClick={() => sendToTerminal(`docker exec -it ${shq(name)} sh`)}
        />
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-0.5 border-b border-border/40 pb-2">
        {(
          [
            { id: "overview", label: "Overview", icon: File01Icon },
            { id: "logs", label: "Logs", icon: ArrowRight01Icon },
            { id: "network", label: "Network", icon: AiNetworkIcon },
            { id: "volumes", label: "Volumes", icon: Database01Icon },
            { id: "stats", label: "Stats", icon: Mining01Icon },
            { id: "inspect", label: "Inspect", icon: BotIcon },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              tab === t.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={t.icon} size={11} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !detail ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[11px] text-muted-foreground">No data.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {tab === "overview" && (
              <>
                <Section title="Container Info">
                  <KVGrid
                    rows={[
                      { label: "ID", value: detail.id.slice(0, 12) },
                      { label: "Name", value: detail.name },
                      { label: "Image", value: detail.image },
                      { label: "State", value: detail.state },
                      { label: "IP", value: detail.ip },
                      { label: "Restart", value: detail.restartPolicy },
                      { label: "Command", value: detail.command },
                      { label: "Entrypoint", value: detail.entrypoint },
                    ]}
                  />
                </Section>
                <Section title="Health">
                  <div
                    className={cn(
                      "rounded-md px-2.5 py-1.5 text-[11px] font-medium",
                      detail.health === "healthy"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : detail.health === "unhealthy"
                          ? "bg-rose-500/15 text-rose-400"
                          : "bg-muted/20 text-muted-foreground",
                    )}
                  >
                    {detail.health || "No healthcheck configured"}
                  </div>
                </Section>
                <Section title="Labels">
                  <Labels labels={detail.labels} />
                </Section>
              </>
            )}

            {tab === "logs" && (
              <pre className="max-h-80 overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
                {detail.logs || "(no logs)"}
              </pre>
            )}

            {tab === "network" && (
              <Section title="Network">
                <KVGrid
                  rows={[
                    { label: "IP Address", value: detail.ip },
                    { label: "Networks", value: detail.networks.join(", ") || "-" },
                  ]}
                />
                <ResourceList items={detail.ports.map((p) => ({ label: p }))} empty="No ports" />
              </Section>
            )}

            {tab === "volumes" && (
              <Section title="Mounts">
                <ResourceList items={detail.mounts.map((m) => ({ label: m }))} empty="No mounts" />
              </Section>
            )}

            {tab === "stats" && (
              <Section title="Live Stats">
                {stats ? (
                  <KVGrid
                    rows={[
                      { label: "CPU", value: stats.cpuPercent },
                      { label: "Memory", value: stats.memUsage },
                      { label: "Memory %", value: stats.memPercent },
                      { label: "Network I/O", value: stats.netIo },
                      { label: "Block I/O", value: stats.blockIo },
                      { label: "PIDs", value: stats.pids },
                    ]}
                  />
                ) : (
                  <p className="text-[11px] text-muted-foreground">No stats available.</p>
                )}
              </Section>
            )}

            {tab === "inspect" && (
              <pre className="max-h-80 overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
                {detail.inspect}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageDetailPanel({ image, onBack }: { image: DockerImage; onBack: () => void }) {
  const [detail, setDetail] = useState<DockerImageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "history" | "layers" | "inspect">("overview");

  useEffect(() => {
    setLoading(true);
    describeImage(image.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [image.id]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Back"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={14} strokeWidth={1.75} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {image.repo}:{image.tag}
          </div>
          <div className="truncate text-[10px] text-muted-foreground">
            {image.size} · {image.created}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-0.5 border-b border-border/40 pb-2">
        {(
          [
            { id: "overview", label: "Overview", icon: File01Icon },
            { id: "history", label: "History", icon: ArrowRight01Icon },
            { id: "layers", label: "Layers", icon: Database01Icon },
            { id: "inspect", label: "Inspect", icon: BotIcon },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors",
              tab === t.id
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={t.icon} size={11} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !detail ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[11px] text-muted-foreground">No data.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {tab === "overview" && (
              <>
                <Section title="Image Info">
                  <KVGrid
                    rows={[
                      { label: "ID", value: detail.id.slice(0, 12) },
                      { label: "Repository", value: detail.repo },
                      { label: "Tag", value: detail.tag },
                      { label: "Size", value: detail.size },
                      { label: "Digest", value: detail.digest },
                      { label: "Architecture", value: detail.architecture },
                      { label: "OS", value: detail.os },
                      { label: "Command", value: detail.command },
                      { label: "Entrypoint", value: detail.entrypoint },
                    ]}
                  />
                </Section>
                <Section title="Labels">
                  <Labels labels={detail.labels} />
                </Section>
              </>
            )}

            {tab === "history" && (
              <Section title="Build History">
                <div className="flex flex-col gap-1">
                  {detail.history.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">No history.</p>
                  ) : (
                    detail.history.map((h, i) => (
                      <div
                        key={i}
                        className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5"
                      >
                        <div className="text-[11px] text-foreground">{h.command}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {h.size} · {h.created}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </Section>
            )}

            {tab === "layers" && (
              <Section title="Layers">
                <ResourceList items={detail.layers.map((l) => ({ label: l }))} empty="No layers" />
              </Section>
            )}

            {tab === "inspect" && (
              <pre className="max-h-80 overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
                {detail.inspect}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
}: {
  icon: typeof PlayIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-md border border-border/20 bg-card/20 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
    >
      <HugeiconsIcon icon={icon} size={11} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}

function KVGrid({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {rows.map((r) => (
        <div key={r.label} className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5">
          <div className="text-[10px] text-muted-foreground">{r.label}</div>
          <div className="truncate text-[11.5px] font-medium text-foreground">{r.value || "-"}</div>
        </div>
      ))}
    </div>
  );
}

function Labels({ labels }: { labels: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(labels).length === 0 ? (
        <span className="text-[11px] text-muted-foreground">No labels</span>
      ) : (
        Object.entries(labels).map(([k, v]) => (
          <span
            key={k}
            className="rounded-md border border-border/40 bg-muted/20 px-1.5 py-0.5 text-[10px] text-foreground"
          >
            {k}: {v}
          </span>
        ))
      )}
    </div>
  );
}

function ResourceList({ items, empty }: { items: { label: string }[]; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 ? (
        <span className="text-[11px] text-muted-foreground">{empty}</span>
      ) : (
        items.map((item, i) => (
          <div
            key={i}
            className="rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 text-[11.5px] text-foreground"
          >
            {item.label}
          </div>
        ))
      )}
    </div>
  );
}
