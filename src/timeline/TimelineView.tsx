import { useCallback, useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Clock01Icon, InformationCircleIcon } from "@hugeicons/core-free-icons";

import { cn } from "../lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PanelHeader } from "../shell/PanelHeader";
import { useWorkspaceRoot } from "../workspace/store";
import {
  clearWorkspaceTimeline,
  isTimelineRecordingEnabled,
  listTimelineWorkspaces,
  queryTimeline,
  setTimelineRecordingEnabled,
  subscribeTimeline,
  type TimelineEvent,
  type TimelineEventType,
  type TimelineWorkspace,
} from "./store";
import { toast } from "../toast";

/**
 * Workspace Timeline — what happened in this project, newest first, grouped
 * by day. Summaries only: commands and their outcomes, file saves, AI request
 * metadata, git events. Full output and file contents are never recorded.
 */

type FilterId = "all" | "commands" | "files" | "ai" | "git" | "errors";

/* Glyphs match the event markers in the list — the filter row teaches the
   icon language, so scanning events gets faster every time it's used. */
const FILTERS: { id: FilterId; label: string; glyph: string; types: TimelineEventType[] }[] = [
  { id: "all", label: "All", glyph: "≡", types: [] },
  { id: "commands", label: "Commands", glyph: "✓", types: ["command", "command_failed"] },
  { id: "files", label: "Files", glyph: "✎", types: ["file"] },
  { id: "ai", label: "AI", glyph: "✦", types: ["ai"] },
  { id: "git", label: "Git", glyph: "⌥", types: ["git"] },
  { id: "errors", label: "Errors", glyph: "✕", types: ["command_failed"] },
];

const baseName = (p: string) => p.split("/").filter(Boolean).pop() || p;

/** Bucket switcher — peek at another project's timeline without cd-ing there.
    Lives in the header actions; the folder name yields to an icon under 340px. */
function FolderSwitch({
  root,
  viewRoot,
  onSelect,
}: {
  root: string;
  viewRoot: string | null;
  onSelect: (bucket: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [buckets, setBuckets] = useState<TimelineWorkspace[]>([]);
  const effective = viewRoot ?? root;

  useEffect(() => {
    if (open) void listTimelineWorkspaces().then(setBuckets).catch(() => setBuckets([]));
  }, [open]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={effective ? `Timeline of ${effective} — switch bucket` : "No workspace"}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <span className="shrink-0">📂</span>
        <span className="hidden max-w-24 truncate @[340px]:inline">{effective ? baseName(effective) : "—"}</span>
        <span className="shrink-0 text-[8px] opacity-60">▾</span>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-6 z-40 min-w-44 rounded-md border border-border/60 bg-zinc-950 p-1 shadow-lg shadow-black/40"
          onMouseLeave={() => setOpen(false)}
        >
          {viewRoot ? (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10.5px] text-primary transition-colors hover:bg-muted/40"
            >
              ← back to current ({baseName(root)})
            </button>
          ) : null}
          {buckets.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-muted-foreground">No recorded workspaces yet</div>
          ) : (
            buckets.map((b) => (
              <button
                key={b.workspace_id}
                type="button"
                title={b.workspace_id}
                onClick={() => {
                  onSelect(b.workspace_id === root ? null : b.workspace_id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[10.5px] text-foreground/90 transition-colors hover:bg-muted/40"
              >
                <span className="min-w-0 flex-1 truncate">{baseName(b.workspace_id)}</span>
                {b.workspace_id === root ? <span className="shrink-0 text-[8.5px] text-primary">current</span> : null}
                <span className="shrink-0 text-[9px] tabular-nums text-muted-foreground/60">{b.event_count}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}

function dayLabel(ts: number): string {
  const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStart(new Date());
  const eventDay = dayStart(new Date(ts * 1000));
  if (eventDay === today) return "Today";
  if (eventDay === today - 86_400_000) return "Yesterday";
  return new Date(ts * 1000).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function timeLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString(undefined, { hour12: false, hour: "2-digit", minute: "2-digit" });
}

function eventGlyph(type: string): { glyph: string; className: string } {
  switch (type) {
    case "command":
      return { glyph: "✓", className: "text-emerald-400" };
    case "command_failed":
      return { glyph: "✕", className: "text-red-400" };
    case "ai":
      return { glyph: "✦", className: "text-primary" };
    case "git":
      return { glyph: "⌥", className: "text-violet-400" };
    case "file":
      return { glyph: "✎", className: "text-muted-foreground" };
    default:
      return { glyph: "·", className: "text-muted-foreground" };
  }
}

export function TimelineView({ inline }: { inline?: boolean }) {
  const root = useWorkspaceRoot();
  const [filter, setFilter] = useState<FilterId>("all");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(() => isTimelineRecordingEnabled());
  /* Folder switcher: peek at another bucket without cd-ing there. null means
     "follow the current workspace root". */
  const [viewRoot, setViewRoot] = useState<string | null>(null);
  const effectiveRoot = viewRoot ?? root;
  const viewingCurrent = viewRoot === null || viewRoot === root;

  const load = useCallback(async () => {
    const types = FILTERS.find((f) => f.id === filter)?.types ?? [];
    try {
      setEvents(await queryTimeline(types, 30, 200, effectiveRoot));
    } catch (e) {
      console.warn("[timeline] query failed:", e);
    } finally {
      setLoading(false);
    }
  }, [filter, effectiveRoot]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load, root]);

  /* New records and clears refresh the open view; the toggle does too. */
  useEffect(() => subscribeTimeline(() => void load()), [load]);

  useEffect(() => {
    setRecording(isTimelineRecordingEnabled());
  }, [root]);

  const toggleRecording = () => {
    const next = !recording;
    setTimelineRecordingEnabled(next);
    setRecording(next);
    toast({
      title: next ? "Timeline recording on" : "Timeline recording off for this workspace",
      message: next ? "Commands, saves, AI and git events are summarized locally." : "Nothing new will be recorded here. Existing entries stay until cleared.",
      variant: "info",
    });
  };

  const clearAll = () => {
    void clearWorkspaceTimeline(effectiveRoot)
      .then(() => {
        if (viewRoot && viewRoot !== root) setViewRoot(null);
        toast({ title: "Timeline cleared", message: "Only this workspace was affected.", variant: "success" });
      })
      .catch((e) => toast({ title: "Could not clear timeline", message: String(e), variant: "error" }));
  };

  /* Group newest-first events under day headings. */
  const groups: { label: string; events: TimelineEvent[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.ts);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }

  return (
    <div className={cn("@container flex h-full flex-col font-mono", inline && "text-[11px]")}>
      <PanelHeader
        icon={Clock01Icon}
        title="Timeline"
        status={
          viewingCurrent ? (
            <button
              type="button"
              onClick={toggleRecording}
              title={recording ? "Stop recording this workspace" : "Resume recording this workspace"}
              className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted/40"
            >
              {recording ? (
                <>
                  {/* Camera-style REC: pulsing red halo + solid core. */}
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-red-500" />
                  </span>
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-red-400">rec</span>
                </>
              ) : (
                <>
                  <span className="inline-flex size-1.5 rounded-full border border-muted-foreground/60" />
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">off</span>
                </>
              )}
            </button>
          ) : (
            <span className="px-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60">viewing</span>
          )
        }
        actions={
          <>
            <FolderSwitch root={root} viewRoot={viewRoot} onSelect={setViewRoot} />
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="How the timeline groups your work"
                    className="inline-flex size-6 cursor-help items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-muted-foreground"
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} size={14} strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6} className="max-w-56 border border-border/60 bg-zinc-950 text-[10.5px] leading-relaxed text-zinc-100 shadow-lg">
                  The timeline groups your work by project: a ⚑ pinned root (header ★ menu)
                  first, then the git repository root, then the current folder. Commands,
                  saves, AI and git events land in whichever bucket you're inside.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <button
              type="button"
              onClick={clearAll}
              title="Delete this workspace's timeline (cannot be undone)"
              className="rounded-md border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400"
            >
              clear
            </button>
          </>
        }
      />

      <div className="shrink-0 border-b border-border/30 px-2 py-1.5">
        {/* Segmented grid: 3×2 labeled rows by default; one row of six only
            from 480px panel width — six labeled segments need ~76px each, so
            a lower threshold just truncates every label. Below 300px the
            labels drop out entirely (clean glyphs, tooltips carry names). */}
        <div className="grid grid-cols-3 gap-0.5 rounded-md border border-border/40 bg-muted/15 p-0.5 @[480px]:grid-cols-6">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              title={f.label}
              className={cn(
                "flex min-w-0 items-center justify-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] transition-colors",
                filter === f.id
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
              )}
            >
              <span className="shrink-0 text-[10px]">{f.glyph}</span>
              <span className="hidden truncate @[320px]:inline">{f.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {!root ? (
          <EmptyState text="Open a folder to see its timeline." />
        ) : loading ? (
          <EmptyState text="loading…" />
        ) : events.length === 0 ? (
          <EmptyState
            text={
              recording
                ? "Nothing recorded yet. Commands, file saves, AI requests and git events will appear here as summaries."
                : "Recording is off for this workspace. Turn it on to start the timeline."
            }
          />
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-2">
              <div className="sticky top-0 z-10 bg-background/95 py-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/60 backdrop-blur-sm">
                {group.label}
              </div>
              {group.events.map((event) => {
                const { glyph, className } = eventGlyph(event.event_type);
                return (
                  <div
                    key={event.id}
                    className="flex items-baseline gap-2 rounded-md px-1.5 py-1 hover:bg-muted/30"
                    title={event.summary}
                  >
                    <span className="shrink-0 text-[9.5px] tabular-nums text-muted-foreground/60">
                      {timeLabel(event.ts)}
                    </span>
                    <span className={cn("shrink-0 text-[10px]", className)}>{glyph}</span>
                    <span className="min-w-0 truncate text-[10.5px] text-foreground/90">{event.summary}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      <div className="shrink-0 border-t border-border/30 px-3 py-1.5 text-[8.5px] text-muted-foreground/50">
        summaries only · stored locally (~/.husk/state.sqlite) · kept 90 days
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-8 text-center text-[10px] leading-relaxed text-muted-foreground/60">{text}</div>;
}
