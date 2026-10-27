import { memo, useEffect, useMemo, useRef, useState } from "react";
import { getSessionHandle, subscribeTerminalOutput } from "./registry";
import { usePrefs } from "../settings/preferences";
import { captureLogHighlights, type LogHighlightSnapshot } from "../ai/logHighlights";
import { LogHighlightsPanel } from "./LogHighlightsPanel";
import { captureOutput, type OutputSnapshot } from "./outputExplore";
import { OutputExplorePanel } from "./OutputExplorePanel";
import { LOG_BATCH_MS, TerminalLogBuffer, type LogEntry, type LogLevel } from "./logBuffer";

type LogFilter = "all" | LogLevel;
const SNAPSHOT_LINES = 600;

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  output: "OUT",
};

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
const LogRow = memo(function LogRow({ entry }: { entry: LogEntry }) {
  return <div data-log-id={entry.id} className={`terminal-log-row ${entry.level}`}>
    <time>{timeFormatter.format(entry.at)}</time>
    <span className="terminal-log-level">{LEVEL_LABEL[entry.level]}</span>
    <span className="terminal-log-message">{entry.text}</span>
  </div>;
});

export function TerminalLogs({
  leafId,
  onClose,
}: {
  leafId: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [limited, setLimited] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const prefs = usePrefs();
  const [highlights, setHighlights] = useState<{ leafId: number; id: number; snapshot: LogHighlightSnapshot } | null>(null);
  const [explore, setExplore] = useState<{ leafId: number; id: number; snapshot: OutputSnapshot } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const bufferRef = useRef<TerminalLogBuffer | null>(null);
  const nextIdRef = useRef(1);
  const captureIdRef = useRef(0);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
    bufferRef.current?.discardPartial();
  }, [paused]);

  useEffect(() => {
    const buffer = new TerminalLogBuffer(nextIdRef.current);
    bufferRef.current = buffer;
    const snapshot = getSessionHandle(leafId)?.getBuffer(SNAPSHOT_LINES) ?? "";
    buffer.append(snapshot);
    buffer.finishSnapshot();
    nextIdRef.current = buffer.nextLineId;
    setEntries(buffer.snapshot());
    setLimited(buffer.isLimited);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const unsubscribe = subscribeTerminalOutput(leafId, (raw) => {
      if (disposed || pausedRef.current) return;
      const version = buffer.version;
      buffer.append(raw);
      nextIdRef.current = buffer.nextLineId;
      if (version === buffer.version || timer !== undefined) return;
      // One bounded snapshot per batch; no queued React updater per PTY chunk.
      timer = setTimeout(() => {
        timer = undefined;
        if (disposed) return;
        setEntries(buffer.snapshot());
        setLimited(buffer.isLimited);
      }, LOG_BATCH_MS);
    });
    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      unsubscribe();
      if (bufferRef.current === buffer) bufferRef.current = null;
    };
  }, [leafId]);

  const visibleEntries = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.level === filter)),
    [entries, filter],
  );

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [follow, visibleEntries]);

  const selectFilter = (next: LogFilter) => setFilter(next);

  function captureVisibleSource() {
    const selection = window.getSelection();
    let selectedIds = new Set<number>();
    if (selection && !selection.isCollapsed && selection.rangeCount && listRef.current?.contains(selection.anchorNode) && listRef.current.contains(selection.focusNode)) {
      const range = selection.getRangeAt(0);
      selectedIds = new Set(Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-log-id]")).filter((row) => range.intersectsNode(row)).map((row) => Number(row.dataset.logId)));
    }
    const source = selectedIds.size ? visibleEntries.filter((entry) => selectedIds.has(entry.id)) : visibleEntries;
    return { lines: source, label: selectedIds.size ? "Selected log lines" : `Visible ${filter} logs` };
  }

  function openHighlights() {
    const source = captureVisibleSource();
    setExplore(null);
    setHighlights({ leafId, id: ++captureIdRef.current, snapshot: captureLogHighlights(source.lines, source.label) });
  }

  function openExplore() {
    const source = captureVisibleSource();
    setHighlights(null);
    setExplore({ leafId, id: ++captureIdRef.current, snapshot: captureOutput(source.lines, source.label) });
  }

  return (
    <section className="terminal-logs" aria-label="Live terminal logs">
      <header className="terminal-logs-header">
        <div className="terminal-logs-identity">
          <span className="terminal-logs-dot" aria-hidden="true" />
          <span>LOGS</span>
          <span className="terminal-logs-session">· LIVE</span>
        </div>
        <div className="terminal-logs-actions">
          <button type="button" className="terminal-logs-action" disabled={!visibleEntries.length} onMouseDown={(event) => event.preventDefault()} onClick={openExplore} title="Explore selected or filtered output locally as text, a table, or a chart">Explore</button>
          {prefs.aiEnabled && <button type="button" className="terminal-logs-action" disabled={!visibleEntries.length} onMouseDown={(event) => event.preventDefault()} onClick={openHighlights} title="Review selected log lines, or the recent filtered output, before asking AI">Highlights</button>}
          <button
            type="button"
            className={`terminal-logs-action${follow ? " active" : ""}`}
            onClick={() => setFollow((current) => !current)}
            title={follow ? "Following new log output" : "Resume following new log output"}
          >
            follow
          </button>
          <button
            type="button"
            className={`terminal-logs-action${paused ? " active" : ""}`}
            onClick={() => setPaused((current) => !current)}
            title={paused ? "Resume live updates" : "Pause live updates"}
          >
            {paused ? "resume" : "pause"}
          </button>
          <button type="button" className="terminal-logs-close" onClick={onClose} aria-label="Close logs" title="Close logs">
            ×
          </button>
        </div>
      </header>
      <div className="terminal-logs-filters" role="group" aria-label="Filter logs by severity">
        {(["all", "info", "warn", "error"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={`terminal-logs-filter${filter === value ? " active" : ""}${value !== "all" ? ` ${value}` : ""}`}
            onClick={() => selectFilter(value)}
          >
            {value === "all" ? "all" : LEVEL_LABEL[value].toLowerCase()}
          </button>
        ))}
        <span className="terminal-logs-count" title={limited ? "Bounded preview: older output is removed and very long lines are shortened. Terminal scrollback is unchanged." : undefined}>
          {visibleEntries.length} lines{limited ? " · limited preview" : ""}
        </span>
      </div>
      {prefs.aiEnabled && highlights?.leafId === leafId && <LogHighlightsPanel key={highlights.id} snapshot={highlights.snapshot} onClose={() => setHighlights(null)} />}
      {explore?.leafId === leafId && <OutputExplorePanel key={explore.id} snapshot={explore.snapshot} onClose={() => setExplore(null)} />}
      <div
        ref={listRef}
        className="terminal-logs-list"
        onScroll={(event) => {
          const element = event.currentTarget;
          setFollow(element.scrollHeight - element.scrollTop - element.clientHeight < 20);
        }}
      >
        {visibleEntries.length === 0 ? (
          <div className="terminal-logs-empty">Waiting for terminal output…</div>
        ) : (
          visibleEntries.map((entry) => <LogRow key={entry.id} entry={entry} />)
        )}
      </div>
    </section>
  );
}
