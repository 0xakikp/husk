import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, RefreshIcon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { getWorkspaceRoot } from "../workspace/store";
import { runView, type PluginRows } from "./loader";
import { fillTemplate, type Plugin } from "./types";

/**
 * Renders a plugin's view using Husk's own components.
 *
 * The plugin supplies data; every pixel here is the app's. That is what makes a
 * plugin feel built in — and it means a restyle of this file restyles every
 * plugin at once, which is exactly what code plugins could never give.
 */
export function PluginPanel({
  plugin,
  onBack,
  onTypeCommand,
  onRunCommand,
}: {
  plugin: Plugin;
  onBack: () => void;
  onTypeCommand: (cmd: string) => void;
  onRunCommand: (cmd: string) => void;
}) {
  const [viewIndex, setViewIndex] = useState(0);
  const [data, setData] = useState<PluginRows | null>(null);
  const [busy, setBusy] = useState(false);
  const [openRow, setOpenRow] = useState<number | null>(null);

  const view = plugin.views[Math.min(viewIndex, plugin.views.length - 1)];

  const refresh = useCallback(() => {
    setBusy(true);
    void runView(view, getWorkspaceRoot() || null).then((r) => {
      setData(r);
      setBusy(false);
    });
  }, [view]);

  useEffect(() => {
    refresh();
    if (!view.refresh) return;
    const id = window.setInterval(refresh, view.refresh * 1000);
    return () => window.clearInterval(id);
  }, [refresh, view.refresh]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <button
          type="button"
          onClick={onBack}
          title="Back to plugins"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={13} strokeWidth={2} />
        </button>
        <span className="truncate text-xs font-semibold text-primary">{plugin.name}</span>
        <button
          type="button"
          onClick={refresh}
          title="Refresh"
          className={cn(
            "ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground",
            busy && "animate-spin",
          )}
        >
          <HugeiconsIcon icon={RefreshIcon} size={12} strokeWidth={2} />
        </button>
      </div>

      {/* Tabs only when there is a choice to make. */}
      {plugin.views.length > 1 ? (
        <div className="flex shrink-0 gap-0.5 border-b border-border/30 px-1.5 py-1">
          {plugin.views.map((v, i) => (
            <button
              key={v.title + i}
              type="button"
              onClick={() => {
                setViewIndex(i);
                setOpenRow(null);
              }}
              className={cn(
                "rounded px-1.5 py-0.5 text-[10.5px] transition-colors",
                i === viewIndex ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {data?.error ? (
          /* The tool's own stderr, verbatim and wrapped. Whoever is writing the
             plugin needs the real message to fix the command. */
          <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5">
            <span className="flex items-center gap-1.5 text-[10.5px] font-medium text-destructive">
              <HugeiconsIcon icon={AlertCircleIcon} size={11} strokeWidth={2} />
              {view.command}
            </span>
            <pre className="overflow-x-auto font-mono text-[10px] whitespace-pre-wrap text-muted-foreground">
              {data.error}
            </pre>
          </div>
        ) : data === null ? (
          <p className="px-1 py-3 text-center text-[10.5px] text-muted-foreground">Running…</p>
        ) : data.rows.length === 0 ? (
          <p className="px-1 py-3 text-center text-[10.5px] text-muted-foreground">
            {view.empty ?? "Nothing to show."}
          </p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {data.rows.map((row, i) => {
              const primary = row[data.columns[0]] ?? "";
              const rest = data.columns.slice(1).map((c) => row[c]).filter(Boolean);
              const expanded = openRow === i;
              return (
                <div key={i} className="flex flex-col">
                  <button
                    type="button"
                    onClick={() => setOpenRow(expanded ? null : i)}
                    className={cn(
                      "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-white/[0.04]",
                      expanded && "bg-white/[0.06]",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                      {primary}
                    </span>
                    {rest.length ? (
                      <span className="shrink-0 truncate text-[9.5px] text-muted-foreground">
                        {rest.join(" · ")}
                      </span>
                    ) : null}
                  </button>

                  {expanded && view.actions?.length ? (
                    <div className="flex flex-col gap-0.5 pt-0.5 pb-1 pl-3">
                      {view.actions.map((a) => (
                        <button
                          key={a.label}
                          type="button"
                          onClick={() => {
                            const cmd = fillTemplate(a.command, row);
                            if (a.run) onRunCommand(cmd);
                            else onTypeCommand(cmd);
                            setOpenRow(null);
                          }}
                          title={fillTemplate(a.command, row)}
                          className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-left text-[10.5px] text-muted-foreground transition-colors hover:bg-white/[0.04] hover:text-foreground"
                        >
                          <span className="text-primary">›</span>
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
