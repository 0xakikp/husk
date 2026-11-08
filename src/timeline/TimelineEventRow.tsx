import { useEffect, useId, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { cn } from "../lib/utils";
import { timelinePresentation } from "./presentation";
import type { TimelineEvent } from "./store";

const glyphs: Record<string, { glyph: string; color: string }> = {
  command: { glyph: "✓", color: "text-emerald-400" },
  command_failed: { glyph: "✕", color: "text-red-400" },
  ai: { glyph: "✦", color: "text-primary" },
  git: { glyph: "⌥", color: "text-violet-400" },
  file: { glyph: "✎", color: "text-muted-foreground" },
};

export function TimelineEventRow({ event, expanded, onExpand, selecting, selectable, selected, onSelect }: {
  event: TimelineEvent;
  expanded: boolean;
  onExpand: () => void;
  selecting: boolean;
  selectable: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const detailsId = useId();
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const detail = useMemo(() => timelinePresentation(event), [event]);
  const { glyph, color } = glyphs[event.event_type] ?? { glyph: "·", color: "text-muted-foreground" };
  const date = new Date(event.ts * 1_000);
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = setTimeout(() => setCopyState("idle"), 2_000);
    return () => clearTimeout(timer);
  }, [copyState]);

  return (
    <div className={cn("min-w-0 rounded-md border border-transparent", expanded && "my-1 border-primary/25 bg-primary/[0.035]", selected && "bg-primary/10")}>
      <div className="flex min-w-0 items-center">
        {selecting ? (
          <input type="checkbox" aria-label={`Select ${detail.summary}`} checked={selected} disabled={!selectable} onChange={onSelect}
            title={selectable ? "Include in workflow draft" : "Only safe, successful, complete commands can be selected"}
            className="ml-1.5 size-3 shrink-0 accent-primary disabled:opacity-30" />
        ) : null}
        <button type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={onExpand}
          className="timeline-event-toggle group flex min-w-0 flex-1 items-baseline gap-1.5 rounded-md px-1.5 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60">
          <time dateTime={date.toISOString()} className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground/65">
            {date.toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit" })}
          </time>
          <span aria-hidden="true" className={cn("shrink-0 text-[10px]", color)}>{glyph}</span>
          <span className="min-w-0 flex-1 truncate text-[10.5px] text-foreground/90">{detail.summary}</span>
          <span aria-hidden="true" className={cn("shrink-0 text-[10px] text-muted-foreground/50 group-hover:text-primary", expanded && "text-primary")}>{expanded ? "⌄" : "›"}</span>
        </button>
      </div>
      {expanded ? (
        <div id={detailsId} className="space-y-2 px-2.5 pb-3 pt-1 text-[10px]">
          <div className="text-[9px] leading-relaxed text-muted-foreground">{date.toLocaleString()}</div>
          <pre className="m-0 select-text whitespace-pre-wrap break-words rounded border border-border/50 bg-background/35 p-2 font-mono text-[10.5px] leading-relaxed text-foreground [overflow-wrap:anywhere]">{detail.command?.command ?? detail.summary}</pre>
          {detail.fields.length > 0 ? <dl className="space-y-1">
            {detail.fields.map(({ label, value }) => <div key={label} className="flex min-w-0 gap-2">
              <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
              <dd className="m-0 min-w-0 select-text text-foreground/80 [overflow-wrap:anywhere]">{value}</dd>
            </div>)}
          </dl> : null}
          {detail.copy ? <button type="button" disabled={copyState === "copying"} onClick={async () => {
            if (!detail.copy) return;
            setCopyState("copying");
            try { await writeText(detail.copy.value); setCopyState("copied"); }
            catch { setCopyState("error"); }
          }} className="timeline-action">
            {copyState === "copied" ? "Copied" : copyState === "copying" ? "Copying…" : detail.copy.label}
          </button> : null}
          <div aria-live="polite" className="sr-only">{copyState === "copied" ? "Copied to clipboard" : ""}</div>
          {copyState === "error" ? <p role="alert" className="m-0 text-red-400">Could not copy. Try again.</p> : null}
          <p className="m-0 text-[9px] leading-relaxed text-muted-foreground/75">{detail.note}</p>
        </div>
      ) : null}
    </div>
  );
}
