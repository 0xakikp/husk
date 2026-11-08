import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, InformationCircleIcon, TimelineListIcon, WorkflowCircle01Icon } from "@hugeicons/core-free-icons";

import { cn } from "../lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { TimelineEventRow } from "./TimelineEventRow";
import { timelineDayLabel, timelinePresentation } from "./presentation";
import "./TimelineView.css";
import { stageWorkflowDraft } from "../workflows/draftStore";
import {
  clearWorkflowSuggestionsForWorkspace,
  isSafeWorkflowSuggestionCommand,
  timelineCommand,
} from "../workflows/suggestions";

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
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const effective = viewRoot ?? root;

  const keepOpen = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
    setOpen(true);
  };

  const closeAfterPointerLeaves = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    // The menu is portalled outside its trigger. A tiny grace period lets the
    // pointer cross that seam without the hover menu blinking closed.
    closeTimer.current = setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, 110);
  };

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  useEffect(() => {
    if (open) void listTimelineWorkspaces().then(setBuckets).catch(() => setBuckets([]));
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={effective ? `Timeline of ${effective} — switch workspace` : "No workspace"}
          onPointerEnter={keepOpen}
          onPointerLeave={closeAfterPointerLeaves}
          className="flex items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-[9.5px] text-muted-foreground transition-colors hover:border-border/60 hover:bg-muted/40 hover:text-foreground data-[state=open]:border-primary/45 data-[state=open]:bg-primary/10 data-[state=open]:text-primary"
        >
          <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.75} className="shrink-0" />
          {/* Clear is an always-visible action in this small header; the folder
              name is useful context but yields sooner when horizontal space is tight. */}
          <span className="hidden max-w-24 truncate @[480px]:inline">{effective ? baseName(effective) : "—"}</span>
          <span className="shrink-0 text-[8px] opacity-60">▾</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={6}
        onPointerEnter={keepOpen}
        onPointerLeave={closeAfterPointerLeaves}
        className="w-44 gap-0 overflow-hidden rounded-md border border-border/70 bg-background/95 p-0 font-mono text-[10px] shadow-lg shadow-black/50 backdrop-blur-xl"
      >
        <div className="flex items-center justify-between border-b border-border/50 px-2.5 py-1.5">
          <span className="uppercase tracking-[0.14em] text-muted-foreground">timeline folders</span>
          <span className="tabular-nums text-[9px] text-muted-foreground/60">{buckets.length}</span>
        </div>
        <div className="max-h-60 overflow-y-auto p-1 [scrollbar-width:thin]">
          {viewRoot ? (
            <button
              type="button"
              onClick={() => {
                onSelect(null);
                setOpen(false);
              }}
              className="mb-1 flex w-full items-center gap-1.5 rounded-sm border border-primary/25 bg-primary/8 px-2 py-1.5 text-left text-[10px] text-primary transition-colors hover:bg-primary/15"
            >
              ← current workspace · {baseName(root)}
            </button>
          ) : null}
          {buckets.length === 0 ? (
            <div className="px-2 py-3 text-center leading-relaxed text-muted-foreground/70">No workspace timelines recorded yet.</div>
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
                className={cn(
                  "group flex w-full items-center gap-1.5 rounded-sm border border-transparent px-2 py-1.5 text-left text-[10px] transition-colors",
                  b.workspace_id === effective
                    ? "border-primary/35 bg-primary/10 text-primary"
                    : "text-foreground/85 hover:border-border/60 hover:bg-muted/45 hover:text-foreground",
                )}
              >
                <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.65} className="shrink-0 opacity-70" />
                <span className="min-w-0 flex-1 truncate">{baseName(b.workspace_id)}</span>
                {b.workspace_id === root ? <span className="shrink-0 text-[8px] uppercase tracking-wide text-primary/80">current</span> : null}
                <span className="shrink-0 tabular-nums text-[9px] text-muted-foreground/60">{b.event_count}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function TimelineView({ inline }: { inline?: boolean }) {
  const root = useWorkspaceRoot();
  const [filter, setFilter] = useState<FilterId>("all");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(200);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const clearingRef = useRef(false);
  const queryVersion = useRef(0);
  const [selectingCommands, setSelectingCommands] = useState(false);
  const [selectedCommandIds, setSelectedCommandIds] = useState<Set<number>>(() => new Set());
  /* Folder switcher: peek at another bucket without cd-ing there. null means
     "follow the current workspace root". */
  const [viewRoot, setViewRoot] = useState<string | null>(null);
  const effectiveRoot = viewRoot ?? root;
  const viewingCurrent = viewRoot === null || viewRoot === root;
  const recording = useSyncExternalStore(subscribeTimeline, () => isTimelineRecordingEnabled(effectiveRoot));
  const currentRoot = useRef(effectiveRoot);
  currentRoot.current = effectiveRoot;

  const load = useCallback(async () => {
    const version = ++queryVersion.current;
    const types = FILTERS.find((f) => f.id === filter)?.types ?? [];
    try {
      const rows = await queryTimeline(types, 90, limit, effectiveRoot);
      if (version !== queryVersion.current) return;
      setEvents([...rows].sort((a, b) => b.ts - a.ts || b.id - a.id));
      setError(false);
    } catch {
      if (version !== queryVersion.current) return;
      setEvents([]);
      setError(true);
    } finally {
      if (version === queryVersion.current) setLoading(false);
    }
  }, [filter, effectiveRoot, limit]);
  const currentLoad = useRef(load);
  currentLoad.current = load;

  useEffect(() => {
    setLoading(true);
    void load();
    return () => { queryVersion.current += 1; };
  }, [load]);

  /* New records and clears refresh the open view; the toggle does too. */
  useEffect(() => subscribeTimeline(() => void load()), [load]);

  useEffect(() => {
    setSelectingCommands(false);
    setSelectedCommandIds(new Set());
    setExpandedId(null);
    setConfirmClear(false);
    setSearch("");
    setLimit(200);
  }, [effectiveRoot]);

  useEffect(() => {
    // Keep the selection count honest after filtering, refreshing or clearing.
    const visible = new Set(events.map((event) => event.id));
    setSelectedCommandIds((ids) => new Set([...ids].filter((id) => visible.has(id))));
  }, [events]);

  const toggleRecording = () => {
    const next = !recording;
    const persisted = setTimelineRecordingEnabled(next, effectiveRoot);
    if (!next && effectiveRoot) clearWorkflowSuggestionsForWorkspace(effectiveRoot);
    toast({
      title: next ? "Timeline recording on" : "Timeline recording off for this workspace",
      message: !persisted ? "Changed for this session only. The preference could not be saved; check it again before working after a restart."
        : next ? "Commands, saves, AI and git events are summarized locally." : "Nothing new will be recorded here. Existing entries stay until cleared.",
      variant: persisted ? "info" : "warning",
    });
  };

  const clearAll = async () => {
    if (!effectiveRoot || clearingRef.current) return;
    const target = effectiveRoot;
    clearingRef.current = true;
    setClearing(true);
    try {
      await clearWorkspaceTimeline(target);
      clearWorkflowSuggestionsForWorkspace(target);
      if (currentRoot.current === target) {
        setSelectedCommandIds(new Set());
        setExpandedId(null);
        setConfirmClear(false);
        await currentLoad.current();
      }
      toast({ title: "Timeline cleared", message: `Only ${baseName(target)} was affected. Terminal output and shell history were not cleared.`, variant: "success" });
    } catch {
      toast({ title: "Could not clear timeline", message: "Nothing has been confirmed deleted. Please try again.", variant: "error" });
    } finally {
      clearingRef.current = false;
      setClearing(false);
    }
  };

  const createWorkflowFromSelection = () => {
    const chosen = events
      .filter((event) => selectedCommandIds.has(event.id))
      .map(timelineCommand)
      .filter((row): row is NonNullable<ReturnType<typeof timelineCommand>> => row !== null)
      .filter((row) => !row.failed && isSafeWorkflowSuggestionCommand(row.command))
      .sort((a, b) => a.ts - b.ts || a.id - b.id);
    if (chosen.length < 2) {
      toast({ title: "Select at least two safe commands", message: "Failed, sensitive, and destructive commands cannot be converted automatically.", variant: "warning" });
      return;
    }
    if (chosen.length > 100) {
      toast({ title: "Select up to 100 commands", message: "A workflow can contain at most 100 steps.", variant: "warning" });
      return;
    }
    const first = chosen[0].command.split(/\s+/).slice(0, 2).join(" ");
    stageWorkflowDraft({
      name: `${first || "Recent"} workflow`,
      description: `Created from ${chosen.length} commands selected in the local workspace Timeline.`,
      steps: chosen.map((row) => row.command),
      stopOnError: true,
      source: "timeline",
    });
  };

  /* Group newest-first events under day headings. */
  const needle = search.trim().toLocaleLowerCase();
  const visibleEvents = needle ? events.filter((event) => {
    const detail = timelinePresentation(event);
    return [detail.summary, detail.command?.command ?? "", ...detail.fields.map((field) => field.value)].join(" ").toLocaleLowerCase().includes(needle);
  }) : events;
  const groups: { label: string; events: TimelineEvent[] }[] = [];
  for (const event of visibleEvents) {
    const label = timelineDayLabel(event.ts);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.events.push(event);
    else groups.push({ label, events: [event] });
  }

  return (
    <div className={cn("@container flex h-full min-h-0 min-w-0 flex-col font-mono", inline && "text-[11px]")}>
      <PanelHeader
        icon={TimelineListIcon}
        title="Timeline"
        status={
          viewingCurrent ? (
            <button
              type="button"
              onClick={toggleRecording}
              disabled={!effectiveRoot}
              aria-label={recording ? "Stop recording this workspace" : "Resume recording this workspace"}
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
                  <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-red-400 @[480px]:inline">rec</span>
                </>
              ) : (
                <>
                  <span className="inline-flex size-1.5 rounded-full border border-muted-foreground/60" />
                  <span className="hidden text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground @[480px]:inline">off</span>
                </>
              )}
            </button>
          ) : (
            <span className="hidden px-1.5 text-[9px] uppercase tracking-[0.14em] text-muted-foreground/60 @[480px]:inline">viewing</span>
          )
        }
        actions={
          <>
            <FolderSwitch root={root} viewRoot={viewRoot} onSelect={setViewRoot} />
            <button
              type="button"
              onClick={() => {
                setSelectingCommands((value) => !value);
                setSelectedCommandIds(new Set());
              }}
              title="Select successful commands and turn them into a reviewed workflow"
              className={cn(
                "inline-flex size-6 shrink-0 items-center justify-center rounded-md border transition-colors",
                selectingCommands
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border/50 text-muted-foreground hover:border-primary/30 hover:text-foreground",
              )}
              aria-label="Create workflow from Timeline commands"
            >
              <HugeiconsIcon icon={WorkflowCircle01Icon} size={13} strokeWidth={1.7} />
            </button>
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="How the timeline groups your work"
                    className="inline-flex size-6 shrink-0 cursor-help items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-muted-foreground"
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
              onClick={() => setConfirmClear((value) => !value)}
              disabled={!effectiveRoot || clearing}
              title="Delete this workspace's timeline (cannot be undone)"
              className="shrink-0 rounded-md border border-border/50 px-1.5 py-0.5 text-[9px] text-muted-foreground transition-colors hover:border-red-400/40 hover:text-red-400"
            >
              clear
            </button>
          </>
        }
      />

      <div className="shrink-0 px-2 py-1">
        {/* Standalone controls, not a segmented group. Their compact intrinsic
            widths fit the rail in one or two rows without tile-sized gaps. */}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => { setFilter(f.id); setLimit(200); setSelectedCommandIds(new Set()); setExpandedId(null); }}
              title={f.label}
              aria-pressed={filter === f.id}
              style={filter === f.id ? {
                borderColor: "color-mix(in srgb, var(--primary) 82%, var(--border))",
                backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
                color: "var(--primary)",
                boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--primary) 20%, transparent), 0 0 10px color-mix(in srgb, var(--primary) 10%, transparent)",
              } : undefined}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.75 text-[9.5px] shadow-sm transition-[transform,background-color,border-color,color,box-shadow] duration-150 ease-out hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.96] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70 motion-reduce:transform-none",
                filter === f.id
                  ? "animate-in fade-in-0 zoom-in-95"
                  : "border-border/70 bg-card/70 text-muted-foreground hover:border-primary/35 hover:bg-muted/70 hover:text-foreground",
              )}
            >
              <span className={cn("shrink-0 text-[10px] transition-transform duration-150", filter === f.id && "scale-110")}>{f.glyph}</span>
              <span className="truncate">{f.label}</span>
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search loaded timeline events" placeholder="Search loaded events…" value={search}
          onChange={(event) => { setSearch(event.target.value); setSelectedCommandIds(new Set()); }}
          className="mt-2 w-full min-w-0 rounded-md border border-border/55 bg-background/30 px-2 py-1.5 text-[10px] text-foreground placeholder:text-muted-foreground/60 focus:border-primary/45 focus:outline-none" />
        {confirmClear ? <div role="group" aria-label="Confirm timeline deletion" className="mt-2 space-y-2 rounded-md border border-red-400/30 bg-red-400/[0.04] p-2 text-[10px]">
          <p className="m-0 break-words leading-relaxed">Delete all Timeline entries for <strong>{baseName(effectiveRoot)}</strong>? This cannot be undone. Terminal output and shell history stay intact.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={clearing} onClick={() => setConfirmClear(false)} className="timeline-action timeline-action-neutral">Cancel</button>
            <button type="button" disabled={clearing} onClick={() => void clearAll()} className="timeline-action timeline-action-danger">{clearing ? "Deleting…" : "Delete timeline"}</button>
          </div>
        </div> : null}
        {selectingCommands ? (
          <div className="mt-1.5 flex items-center gap-1.5 rounded-md border border-primary/20 bg-primary/[0.05] px-2 py-1 text-[9.5px]">
            <span className="min-w-0 flex-1 text-muted-foreground">
              Select safe commands · oldest first in draft · {selectedCommandIds.size}/100 selected
            </span>
            <button type="button" className="shrink-0 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted/40 hover:text-foreground" onClick={() => setSelectedCommandIds(new Set())}>clear</button>
            <button type="button" className="shrink-0 rounded bg-primary/12 px-1.5 py-0.5 text-primary hover:bg-primary/20 disabled:opacity-40" disabled={selectedCommandIds.size < 2 || selectedCommandIds.size > 100 || loading || error} onClick={createWorkflowFromSelection}>review workflow</button>
          </div>
        ) : null}
      </div>

      <div aria-busy={loading} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1 [scrollbar-width:thin]">
        {!effectiveRoot ? (
          <EmptyState text="Open a folder to see its timeline." />
        ) : loading ? (
          <EmptyState text="loading…" />
        ) : error ? (
          <div role="alert" className="px-3 py-8 text-center text-[10px] text-muted-foreground">
            Could not load this timeline.
            <div className="mt-2"><button type="button" className="timeline-action" onClick={() => { setLoading(true); void load(); }}>Retry</button></div>
          </div>
        ) : visibleEvents.length === 0 ? (
          <EmptyState
            text={
              needle ? "No matches in the loaded events. Try another search or load more below." : recording
                ? "No entries in the last 90 days for this filter. Commands, file saves, AI requests and git events appear here as summaries."
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
                const command = timelineCommand(event);
                const selectable = Boolean(command && !command.failed && isSafeWorkflowSuggestionCommand(command.command));
                const selected = selectedCommandIds.has(event.id);
                return (
                  <TimelineEventRow
                    key={event.id}
                    event={event}
                    expanded={event.id === expandedId}
                    onExpand={() => setExpandedId(event.id === expandedId ? null : event.id)}
                    selecting={selectingCommands}
                    selectable={selectable && (selected || selectedCommandIds.size < 100)}
                    selected={selected}
                    onSelect={() => {
                      setSelectedCommandIds((current) => {
                        const next = new Set(current);
                        if (next.has(event.id)) next.delete(event.id);
                        else if (next.size < 100) next.add(event.id);
                        return next;
                      });
                    }}
                  />
                );
              })}
            </div>
          ))
        )}
        {!loading && !error && events.length >= limit && limit < 1_000 ? <button type="button" onClick={() => setLimit((value) => Math.min(1_000, value + 200))} className="timeline-action my-2 w-full">Load 200 more</button> : null}
      </div>

      <div className="shrink-0 space-y-1 border-t border-border/30 px-3 py-2 text-[9px] leading-relaxed text-muted-foreground/65">
        <div>{needle ? `${visibleEvents.length} matches · ${events.length} loaded` : `${events.length} loaded · last 90 days`}{events.length >= 1_000 ? " · latest 1,000 per filter" : ""}</div>
        <div title="Stored locally in ~/.husk/state.sqlite. Expired entries are pruned on the next write.">Local summaries · click an entry for details</div>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="px-3 py-8 text-center text-[10px] leading-relaxed text-muted-foreground/60">{text}</div>;
}
