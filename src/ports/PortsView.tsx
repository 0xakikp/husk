import { useCallback, useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  ComputerTerminal02Icon,
  Copy01Icon,
  LinkSquare01Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { toast } from "../toast";
import { listPorts, stopPortProcess, type PortListener } from "./api";

function listenerUrl(listener: PortListener): string {
  // The utility is for development listeners. `localhost` is the least
  // surprising browser target for wildcard, IPv4, and IPv6 binds alike.
  return `http://localhost:${listener.port}`;
}

export function PortsView({
  onBack,
  onTypeCommand,
  onOpenBrowser,
}: {
  onBack: () => void;
  onTypeCommand: (command: string) => void;
  onOpenBrowser: (url: string) => void;
}) {
  const [listeners, setListeners] = useState<PortListener[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmStop, setConfirmStop] = useState<PortListener | null>(null);
  const [stopping, setStopping] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setListeners(await listPorts());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return listeners;
    return listeners.filter((listener) =>
      `${listener.port} ${listener.pid} ${listener.command} ${listener.address}`.toLowerCase().includes(term),
    );
  }, [listeners, query]);

  const copyUrl = async (listener: PortListener) => {
    const url = listenerUrl(listener);
    try {
      await writeText(url);
      toast({ title: "Local URL copied", message: url, variant: "success" });
    } catch (reason) {
      toast({ title: "Could not copy local URL", message: String(reason), variant: "error" });
    }
  };

  const stop = async () => {
    if (!confirmStop) return;
    const listener = confirmStop;
    setStopping(listener.pid);
    try {
      await stopPortProcess(listener.pid, listener.port);
      toast({ title: `Stopped ${listener.command}`, message: `Port ${listener.port} is closing.`, variant: "success" });
      setConfirmStop(null);
      setExpanded(null);
      window.setTimeout(() => void refresh(), 350);
    } catch (reason) {
      toast({ title: "Could not stop process", message: String(reason), variant: "error" });
    } finally {
      setStopping(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <button type="button" onClick={onBack} title="Back to plugins" className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground">
          <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
        </button>
        <span className="truncate text-xs font-semibold text-primary">Ports</span>
        <span className="ml-1 text-[9px] text-muted-foreground">{listeners.length} listening</span>
        <button type="button" onClick={() => void refresh()} title="Refresh ports" className={cn("ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground", loading && "animate-spin")}>
          <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
        </button>
      </header>

      <div className="shrink-0 border-b border-border/30 p-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="filter port, process, or PID"
          aria-label="Filter local ports"
          className="box-border h-7 w-full rounded-md border border-border/60 bg-background/70 px-2 font-mono text-[10px] text-foreground outline-none placeholder:text-muted-foreground/65 focus:border-primary/65"
        />
        <p className="mb-0 mt-1.5 text-[9px] leading-snug text-muted-foreground">Local TCP listeners only. Stop sends a graceful SIGTERM to the selected process.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 p-2">
            <p className="m-0 text-[10px] font-medium text-red-300">Could not inspect local ports</p>
            <p className="mb-0 mt-1 text-[9px] leading-relaxed text-muted-foreground">{error}</p>
            <button type="button" onClick={() => void refresh()} className="mt-2 text-[9.5px] text-primary hover:underline">try again</button>
          </div>
        ) : loading && listeners.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10.5px] text-muted-foreground">Inspecting local listeners…</p>
        ) : visible.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10.5px] text-muted-foreground">{listeners.length ? "No ports match this filter." : "No local TCP listeners found."}</p>
        ) : (
          <div className="flex flex-col gap-1">
            {visible.map((listener) => {
              const id = `${listener.pid}:${listener.port}:${listener.address}`;
              const isExpanded = expanded === id;
              return (
                <div key={id} className={cn("overflow-hidden rounded-md border transition-colors", isExpanded ? "border-primary/40 bg-primary/[0.045]" : "border-border/45 bg-card/25 hover:border-border/70")}>
                  <button type="button" onClick={() => setExpanded(isExpanded ? null : id)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/10 font-mono text-[9px] font-semibold text-primary">:{listener.port}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[10.5px] font-medium text-foreground">{listener.command}</span>
                      <span className="block truncate text-[9px] text-muted-foreground">{listener.address || "local"} · PID {listener.pid}</span>
                    </span>
                    <span className="size-1.5 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(74,222,128,.65)]" aria-label="Listening" />
                  </button>
                  {isExpanded ? (
                    <div className="flex flex-wrap items-center gap-1 border-t border-border/35 px-2 py-1.5">
                      <button type="button" onClick={() => onOpenBrowser(listenerUrl(listener))} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-primary transition-colors hover:bg-primary/10"><HugeiconsIcon icon={LinkSquare01Icon} size={11} />open</button>
                      <button type="button" onClick={() => void copyUrl(listener)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><HugeiconsIcon icon={Copy01Icon} size={11} />copy URL</button>
                      <button type="button" onClick={() => onTypeCommand(`curl -I ${listenerUrl(listener)}`)} className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><HugeiconsIcon icon={ComputerTerminal02Icon} size={11} />curl</button>
                      <button type="button" onClick={() => setConfirmStop(listener)} className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-1 text-[9px] text-red-300 transition-colors hover:bg-red-500/10 hover:text-red-200"><HugeiconsIcon icon={Cancel01Icon} size={11} />stop</button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {confirmStop ? (
        <div className="shrink-0 border-t border-red-500/25 bg-red-500/[0.045] p-2">
          <p className="m-0 text-[10px] font-medium text-foreground">Stop {confirmStop.command} on port {confirmStop.port}?</p>
          <p className="mb-2 mt-1 text-[9px] leading-snug text-muted-foreground">This asks the local process to exit gracefully. Any active work in it may stop.</p>
          <div className="flex justify-end gap-1.5">
            <button type="button" disabled={stopping !== null} onClick={() => setConfirmStop(null)} className="rounded px-2 py-1 text-[9.5px] text-muted-foreground hover:bg-muted">Cancel</button>
            <button type="button" disabled={stopping !== null} onClick={() => void stop()} className="rounded bg-red-500/90 px-2 py-1 text-[9.5px] text-white hover:bg-red-500 disabled:opacity-60">{stopping ? "Stopping…" : "Stop process"}</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
