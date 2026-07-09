import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PauseIcon,
  PlayIcon,
  Delete02Icon,
  ArrowRight01Icon,
  File01Icon,
  AiNetworkIcon,
  Database01Icon,
  Mining01Icon,
  BotIcon,
  Cancel01Icon,
  Refresh01Icon,
  Copy01Icon,
} from "@hugeicons/core-free-icons";
import {
  startContainer,
  stopContainer,
  removeContainer,
  describeContainer,
  describeImage,
  getContainerStats,
  type DockerContainerDetail,
  type DockerImageDetail,
  type DockerContainerStats,
} from "./client";
import { runInActiveTerminal } from "../ai/terminalContext";
import { shq } from "../lib/shellQuote";
import { toast } from "../toast";
import { cn } from "@/lib/utils";

export type DockerResourceSelection =
  | { kind: "container"; id: string; name?: string }
  | { kind: "image"; id: string; repo?: string; tag?: string };

export function DockerDetailPanel({
  selection,
  onClose,
  onAction,
}: {
  selection: DockerResourceSelection;
  onClose: () => void;
  onAction?: (fn: () => Promise<unknown>, label: string) => Promise<void>;
}) {
  if (selection.kind === "container") {
    return <ContainerDetailPanel selection={selection} onClose={onClose} onAction={onAction} />;
  }
  return <ImageDetailPanel selection={selection} onClose={onClose} />;
}

function ContainerDetailPanel({
  selection,
  onClose,
  onAction,
}: {
  selection: DockerResourceSelection & { kind: "container" };
  onClose: () => void;
  onAction?: (fn: () => Promise<unknown>, label: string) => Promise<void>;
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
        describeContainer(selection.id),
        getContainerStats(selection.id).catch(() => null),
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
  }, [selection.id]);

  const sendToTerminal = (cmd: string) => {
    if (runInActiveTerminal(cmd)) {
      toast({ title: `Sent to terminal: ${cmd}`, variant: "info" });
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  const name = detail?.name || selection.name || selection.id;
  const state = detail?.state || "";

  const runAction = (fn: () => Promise<unknown>, label: string) => {
    if (onAction) {
      void onAction(fn, label);
    } else {
      void fn();
    }
  };

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={Database01Icon} size={14} strokeWidth={1.75} className="text-primary" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] font-semibold text-foreground">{name}</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {detail?.image || "…"} · {state || "…"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Copy name"
            title="Copy name"
            onClick={() => void navigator.clipboard.writeText(name)}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Copy01Icon} size={13} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Refresh"
            title="Refresh"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/50 px-3 py-2">
        <ActionButton
          icon={state === "running" ? PauseIcon : PlayIcon}
          label={state === "running" ? "Stop" : "Start"}
          onClick={() =>
            runAction(
              () => (state === "running" ? stopContainer(selection.id) : startContainer(selection.id)),
              `${state === "running" ? "Stopped" : "Started"} ${name}`,
            )
          }
        />
        <ActionButton
          icon={Delete02Icon}
          label="Remove"
          onClick={() => runAction(() => removeContainer(selection.id), `Removed ${name}`)}
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

      <div className="flex shrink-0 gap-1 border-b border-border/50 px-2">
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
              "flex items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={t.icon} size={12} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !detail ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[12px] text-muted-foreground">No data</p>
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
              <pre className="max-h-[calc(100vh-220px)] overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
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
              <pre className="max-h-[calc(100vh-220px)] overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
                {detail.inspect}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ImageDetailPanel({
  selection,
  onClose,
}: {
  selection: DockerResourceSelection & { kind: "image" };
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<DockerImageDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "history" | "layers" | "inspect">("overview");

  useEffect(() => {
    setLoading(true);
    describeImage(selection.id)
      .then(setDetail)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [selection.id]);

  const title = detail ? `${detail.repo}:${detail.tag}` : `${selection.repo || "image"}:${selection.tag || ""}`;

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={Database01Icon} size={14} strokeWidth={1.75} className="text-primary" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[12px] font-semibold text-foreground">{title}</span>
            <span className="truncate text-[10px] text-muted-foreground">
              {detail?.size || "…"} · {detail?.architecture || "…"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
          </button>
        </div>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border/50 px-2">
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
              "flex items-center gap-1.5 px-2.5 py-1.5 text-[10.5px] font-medium transition-colors",
              tab === t.id
                ? "border-b-2 border-primary text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <HugeiconsIcon icon={t.icon} size={12} strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading && !detail ? (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-4 animate-pulse rounded bg-muted" />
            ))}
          </div>
        ) : error ? (
          <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
            <p className="text-[12px] text-rose-400">{error}</p>
          </div>
        ) : !detail ? (
          <p className="text-center text-[12px] text-muted-foreground">No data</p>
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
              <pre className="max-h-[calc(100vh-220px)] overflow-auto rounded-md border border-border/40 bg-black/40 p-3 font-mono text-[10px] leading-relaxed text-foreground [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
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
