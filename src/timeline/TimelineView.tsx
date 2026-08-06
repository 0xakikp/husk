import { useCallback, useEffect, useState } from "react";

import { cn } from "../lib/utils";
import { useWorkspaceRoot } from "../workspace/store";
import {
  clearWorkspaceTimeline,
  isTimelineRecordingEnabled,
  queryTimeline,
  setTimelineRecordingEnabled,
  subscribeTimeline,
  type TimelineEvent,
  type TimelineEventType,
} from "./store";
import { toast } from "../toast";

/**
 * Workspace Timeline — what happened in this project, newest first, grouped
 * by day. Summaries only: commands and their outcomes, file saves, AI request
 * metadata, git events. Full output and file contents are never recorded.
 */

type FilterId = "all" | "commands" | "files" | "ai" | "git" | "errors";

const FILTERS: { id: FilterId; label: string; types: TimelineEventType[] }[] = [
  { id: "all", label: "All", types: [] },
  { id: "commands", label: "Commands", types: ["command", "command_failed"] },
  { id: "files", label: "Files", types: ["file"] },
  { id: "ai", label: "AI", types: ["ai"] },
  { id: "git", label: "Git", types: ["git"] },
  { id: "errors", label: "Errors", types: ["command_failed"] },
];

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

  const load = useCallback(async () => {
    const types = FILTERS.find((f) => f.id === filter)?.types ?? [];
    try {
      setEvents(await queryTimeline(types));
    } catch (e) {
      console.warn("[timeline] query failed:", e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

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
    void clearWorkspaceTimeline()
      .then(() => toast({ title: "Timeline cleared", message: "Only this workspace was affected.", variant: "success" }))
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
    <div className={cn("flex h-full flex-col font-mono", inline && "text-[11px]")}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-semibold text-foreground">Timeline</span>
        <span className="min-w-0 flex-1 truncate text-[9.5px] text-muted-foreground/70" title={root ? `Timeline of ${root}` : ""}>
          {root ? `📂 ${root.split("/").pop() || root}` : "no workspace"}
        </span>
        <span
          className="shrink-0 cursor-help text-[9.5px] text-muted-foreground/50 hover:text-muted-foreground"
          title={"How the timeline groups your work:\n⚑ pinned project root (header ★ menu)\n→ git repository root (automatic)\n→ the current folder"}
        >
          ⓘ
        </span>
        <button
          type="button"
          onClick={toggleRecording}
          title={recording ? "Stop recording this workspace" : "Resume recording this workspace"}
          className={cn(
            "shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] transition-colors",
            recording
              ? "border-emerald-400/30 text-emerald-400/90 hover:bg-emerald-400/10"
              : "border-border/50 text-muted-foreground hover:bg-muted/40",
          )}
        >
          {recording ? "● rec" : "○ off"}
        </button>
        <button
          type="button"
          onClick={clearAll}
          title="Delete this workspace's timeline (cannot be undone)"
          className="shrink-0 rounded-md border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400"
        >
          clear
        </button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border/30 px-2 py-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              /* shrink-1 + wrap: at narrow sidebar widths the row folds to two
                 lines instead of clipping "Errors" off the right edge. */
              "min-w-0 shrink rounded-md px-2 py-0.5 text-[9.5px] transition-colors",
              filter === f.id
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
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
