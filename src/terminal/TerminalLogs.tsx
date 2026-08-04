import { useEffect, useMemo, useRef, useState } from "react";
import { getSessionHandle, subscribeTerminalOutput } from "./registry";

type LogLevel = "info" | "warn" | "error" | "output";
type LogFilter = "all" | LogLevel;

type LogEntry = {
  id: number;
  at: number;
  level: LogLevel;
  text: string;
};

const MAX_LOG_LINES = 2000;
const SNAPSHOT_LINES = 600;

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
  output: "OUT",
};

function levelFor(text: string): LogLevel {
  if (/\b(?:fatal|error|exception|panic|failed|failure)\b/i.test(text)) return "error";
  if (/\b(?:warn|warning|deprecated)\b/i.test(text)) return "warn";
  if (/\b(?:info|ready|started|listening|compiled|success|connected)\b/i.test(text)) return "info";
  return "output";
}

/* xterm receives the real byte stream. The log drawer gets a readable version:
   strip styling/control sequences while retaining every printable line. */
function cleanTerminalText(raw: string): string {
  return raw
    .replace(/\x1b\][\s\S]*?(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()][0-9A-Za-z]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function entriesFromLines(lines: string[], startId: number): LogEntry[] {
  const at = Date.now();
  return lines
    .map((line, index) => ({ text: line.trimEnd(), id: startId + index }))
    .filter((line) => line.text.trim().length > 0)
    .map((line) => ({ ...line, at, level: levelFor(line.text) }));
}

function timestamp(at: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(at);
}

export function TerminalLogs({
  leafId,
  onClose,
}: {
  leafId: number;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [paused, setPaused] = useState(false);
  const [follow, setFollow] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef("");
  const nextIdRef = useRef(1);
  const pausedRef = useRef(paused);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    pendingRef.current = "";
    const snapshot = getSessionHandle(leafId)?.getBuffer(SNAPSHOT_LINES) ?? "";
    const initial = entriesFromLines(snapshot.split(/\r?\n/), nextIdRef.current);
    nextIdRef.current += initial.length;
    setEntries(initial.slice(-MAX_LOG_LINES));

    return subscribeTerminalOutput(leafId, (raw) => {
      if (pausedRef.current) return;
      const merged = `${pendingRef.current}${cleanTerminalText(raw)}`
        .replace(/\r\n/g, "\n")
        /* Progress bars rewrite their current line with CR. A finished progress
           update is still useful in the drawer, so render it as the next line. */
        .replace(/\r/g, "\n");
      const lines = merged.split("\n");
      pendingRef.current = lines.pop() ?? "";
      if (lines.length === 0) return;
      const fresh = entriesFromLines(lines, nextIdRef.current);
      nextIdRef.current += fresh.length;
      if (fresh.length === 0) return;
      setEntries((previous) => [...previous, ...fresh].slice(-MAX_LOG_LINES));
    });
  }, [leafId]);

  const visibleEntries = useMemo(
    () => (filter === "all" ? entries : entries.filter((entry) => entry.level === filter)),
    [entries, filter],
  );

  useEffect(() => {
    if (!follow) return;
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [follow, visibleEntries.length]);

  const selectFilter = (next: LogFilter) => setFilter(next);

  return (
    <section className="terminal-logs" aria-label="Live terminal logs">
      <header className="terminal-logs-header">
        <div className="terminal-logs-identity">
          <span className="terminal-logs-dot" aria-hidden="true" />
          <span>LOGS</span>
          <span className="terminal-logs-session">· LIVE</span>
        </div>
        <div className="terminal-logs-actions">
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
        <span className="terminal-logs-count">{visibleEntries.length} lines</span>
      </div>
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
          visibleEntries.map((entry) => (
            <div key={entry.id} className={`terminal-log-row ${entry.level}`}>
              <time>{timestamp(entry.at)}</time>
              <span className="terminal-log-level">{LEVEL_LABEL[entry.level]}</span>
              <span className="terminal-log-message">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
