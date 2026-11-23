import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { captureSavedCommand } from "./workflows/savedCommandCapture";
import { usePrefs } from "./settings/preferences";
import { fontStack } from "./styles/fonts";
import { requestScreenAssist } from "./ai/screenAssist";
import { searchHistory, type HistorySort } from "./terminal/historySearch";
import {
  HISTORY_RECALL_SYSTEM, historyRecallMetadata, historyRecallPrompt, parseHistoryRecall, prepareHistoryRecall,
  type HistoryRecallCandidate, type HistoryRecallRow,
} from "./ai/historyRecall";
import "./TerminalHistory.css";

const HISTORY_PAGE_SIZE = 50;

/**
 * Highlight a matched substring within `text` using <mark> spans.
 * Uses greedy longest-highlight — merges overlapping/adjacent runs.
 */
function highlightText(text: string, matches: number[]): React.ReactNode[] {
  if (matches.length === 0) return [text];

  // Build run-lengths: contiguous or overlapping matches become single runs
  const runs: [number, number][] = [];
  for (const idx of matches) {
    if (runs.length > 0 && idx <= runs[runs.length - 1][1]) {
      // Extend last run
      runs[runs.length - 1][1] = idx + 1;
    } else {
      runs.push([idx, idx + 1]);
    }
  }

  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of runs) {
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return parts;
}

type CommandType =
  | "comment"
  | "git"
  | "ssh"
  | "fs"
  | "pkg"
  | "docker"
  | "cargo"
  | "python"
  | "node"
  | "default";

function getCommandType(cmd: string): CommandType {
  const trimmed = cmd.trimStart();
  if (trimmed.startsWith("#")) return "comment";
  const first = trimmed.split(/\s+/)[0].toLowerCase();
  if (["git", "gh"].includes(first)) return "git";
  if (["ssh", "scp", "sftp"].includes(first)) return "ssh";
  if (["cd", "ls", "pwd", "mkdir", "rm", "cp", "mv", "find", "cat", "less", "touch"].includes(first)) return "fs";
  if (["pnpm", "npm", "yarn", "bun"].includes(first)) return "pkg";
  if (first === "docker") return "docker";
  if (first === "cargo") return "cargo";
  if (["python", "python3", "py"].includes(first)) return "python";
  if (first === "node") return "node";
  return "default";
}

const ICONS: Record<CommandType, React.ReactNode> = {
  comment: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 17h10M7 12h10M7 7h10" />
    </svg>
  ),
  git: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M6 9v6" />
      <path d="M9 6a3 3 0 0 1 3-3h0a3 3 0 0 1 3 3v12a3 3 0 0 0 3 3h0a3 3 0 0 0 3-3" />
    </svg>
  ),
  ssh: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  fs: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ),
  pkg: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7.5 4.27 9 5.15M21 8.24v7.52M3 8.24v7.52m9 5.27-9-5.15M12 21.11V12" />
      <path d="M12 12 3 6.89 7.5 4.27 16.5 9.42 12 12z" />
    </svg>
  ),
  docker: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10h12M4 14h12M4 18h8M8 6h4" />
      <rect x="2" y="10" width="20" height="8" rx="2" />
    </svg>
  ),
  cargo: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  python: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a5 5 0 0 1 5 5v2a5 5 0 0 1-5 5H9a5 5 0 0 0-5 5v2" />
      <path d="M12 22a5 5 0 0 1-5-5v-2a5 5 0 0 1 5-5h3a5 5 0 0 0 5-5V3" />
    </svg>
  ),
  node: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2 2 7v10l10 5 10-5V7l-10-5z" />
      <path d="M12 22V12" />
      <path d="m12 12-7-3.5" />
      <path d="m12 12 7-3.5" />
    </svg>
  ),
  default: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  ),
};

/**
 * Reverse-history picker (Ctrl+R): a filterable list of the shell's past
 * commands. Up/Down to move, Enter to drop the command at the prompt, Esc to
 * close. Replaces the shell's built-in reverse-i-search with a GUI list.
 *
 * Newest-first by default, including filtered results. Explicit relevance sort
 * is available; literal terms take priority over approximate fallback matches.
 */
export function TerminalHistoryPanel({
  entries,
  rows,
  terminalId,
  loading,
  loadError,
  onRetry,
  onSelect,
  onClose,
}: {
  entries: string[];
  rows?: HistoryRecallRow[];
  terminalId?: string | number;
  loading: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onSelect: (command: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [sort, setSort] = useState<HistorySort>("newest");
  const listId = useId();
  const [aiMode, setAiMode] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [aiMatches, setAiMatches] = useState<HistoryRecallCandidate[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [staging, setStaging] = useState(false);
  const [stageError, setStageError] = useState<{ command: string; message: string } | null>(null);
  const stageErrorRef = useRef(stageError);
  stageErrorRef.current = stageError;
  const [copyState, setCopyState] = useState<"idle" | "copying" | "copied">("idle");
  const [copyError, setCopyError] = useState("");
  const stagingRef = useRef(false);
  const copyingRef = useRef(false);
  const mountedRef = useRef(true);
  const requestRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /* autoFocus is not reliable against xterm's hidden textarea: Ctrl+R starts
     inside a native xterm key handler, which can retain focus until the next
     frame. Claim it synchronously and once more after that handler finishes. */
  useLayoutEffect(() => {
    const focusInput = () => inputRef.current?.focus({ preventScroll: true });
    focusInput();
    const frame = window.requestAnimationFrame(focusInput);
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Use the user's chosen terminal font so the panel feels native; sizing
  // follows the spotlight palette (13px rows / 15px input), not the terminal.
  const prefs = usePrefs();
  const fontFamily = fontStack(prefs.fontFamily);
  const historyRows = useMemo(() => rows ?? entries.map((command) => ({ command, timestamp: null, source: "Local shell history" })), [rows, entries]);
  const snapshot = useMemo(() => aiMode ? prepareHistoryRecall(historyRows, query)
    : { candidates: [], sensitiveExcluded: 0, omitted: historyRows.length, total: historyRows.length }, [historyRows, query, aiMode]);
  const liveContextRef = useRef({ snapshot, terminalId, aiMode });
  liveContextRef.current = { snapshot, terminalId, aiMode };
  const reviewedCandidates = snapshot.candidates.filter((candidate) => !excluded.has(candidate.id));

  function cancelRecall(): void {
    requestRef.current?.abort();
    requestRef.current = null;
    setAiBusy(false);
  }
  function close(): void { cancelRecall(); onClose(); }

  useEffect(() => {
    cancelRecall(); setAiMatches(null); setAiError(""); setExcluded(new Set()); setIndex(0);
  }, [query, entries, rows, terminalId]);
  useEffect(() => {
    if (!prefs.aiEnabled) { cancelRecall(); setAiMode(false); }
  }, [prefs.aiEnabled]);
  useEffect(() => () => { requestRef.current?.abort(); }, []);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => { stageErrorRef.current = null; setStageError(null); setCopyState("idle"); setCopyError(""); }, [terminalId]);

  async function findHistoryMatches(): Promise<void> {
    if (!prefs.aiEnabled || !aiMode || aiBusy || loading) return;
    const capturedSnapshot = snapshot;
    const capturedTerminal = terminalId;
    const candidates = reviewedCandidates.map((candidate) => ({ ...candidate }));
    const controller = new AbortController();
    requestRef.current = controller;
    setAiBusy(true); setAiError(""); setAiMatches(null);
    try {
      const result = await requestScreenAssist({
        system: HISTORY_RECALL_SYSTEM, prompt: historyRecallPrompt(query, candidates), signal: controller.signal,
      });
      if (controller.signal.aborted || requestRef.current !== controller || liveContextRef.current.snapshot !== capturedSnapshot
        || liveContextRef.current.terminalId !== capturedTerminal || !liveContextRef.current.aiMode) return;
      setAiMatches(parseHistoryRecall(result, candidates)); setIndex(0);
    } catch (error) {
      if (!controller.signal.aborted && requestRef.current === controller) setAiError(error instanceof Error ? error.message : "Could not search history with AI.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setAiBusy(false); }
    }
  }

  const search = useMemo(() => searchHistory(entries, query, sort), [entries, query, sort]);
  const scored = search.matches;
  const pageStart = Math.floor(index / HISTORY_PAGE_SIZE) * HISTORY_PAGE_SIZE;
  const page = scored.slice(pageStart, pageStart + HISTORY_PAGE_SIZE);
  const activeCommand = aiMode ? aiMatches?.[index]?.command : scored[index]?.command;
  const copyTargetRef = useRef<string | undefined>(activeCommand);
  copyTargetRef.current = activeCommand;

  useEffect(() => { setCopyState("idle"); setCopyError(""); }, [query, index, aiMode]);

  useEffect(() => {
    setIndex(0);
  }, [query, entries, sort]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-history-index="${index}"]`) as HTMLElement | undefined;
    el?.scrollIntoView?.({ block: "nearest" });
  }, [index, query, sort, aiMode]);

  /* xterm can retain its hidden textarea as the event target for the first
     keystroke after Ctrl+R, even though this input has already requested focus.
     Capture that event at window level before xterm sees it, then apply the
     edit here. This makes fast typing deterministic instead of depending on a
     browser focus race. Once the input is the target, its normal key handler
     below owns everything. */
  useLayoutEffect(() => {
    const captureEarlyHistoryInput = (event: KeyboardEvent) => {
      const input = inputRef.current;
      if (!input || event.target === input) return;
      if (panelRef.current?.contains(event.target as Node)) return;

      const isPlainCharacter =
        event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey;
      const isBackspace = event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey;
      if (!isPlainCharacter && !isBackspace) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      input.focus({ preventScroll: true });
      if (stagingRef.current) return;
      setQuery((current) => isBackspace ? current.slice(0, -1) : `${current}${event.key}`.slice(0, 2000));
    };

    window.addEventListener("keydown", captureEarlyHistoryInput, true);
    return () => window.removeEventListener("keydown", captureEarlyHistoryInput, true);
  }, []);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        close();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClick);
      document.addEventListener("keydown", handleKey);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  const choose = async (i: number): Promise<void> => {
    if (stagingRef.current) return;
    const cmd = aiMode ? aiMatches?.[i]?.command : scored[i]?.command;
    if (!cmd) return;
    const selectedTerminal = terminalId;
    stagingRef.current = true;
    stageErrorRef.current = null;
    setStaging(true); setIndex(i); setStageError(null); setCopyState("idle"); setCopyError("");
    try {
      // The terminal owns closing the picker after a confirmed staging write.
      // A refusal must leave both the selected command and search intact.
      await onSelect(cmd);
    } catch (error) {
      if (mountedRef.current && liveContextRef.current.terminalId === selectedTerminal) {
        const failure = { command: cmd, message: error instanceof Error ? error.message
          : typeof error === "string" && error ? error : "Husk could not stage this command. Return to a fresh shell prompt or copy the command instead." };
        stageErrorRef.current = failure;
        setStageError(failure);
      }
    } finally {
      stagingRef.current = false;
      if (mountedRef.current) setStaging(false);
    }
  };

  const copyCommand = async (command: string | undefined, fromError = false): Promise<void> => {
    if (!command || copyingRef.current) return;
    const selectedError = fromError ? stageError : null;
    const selectedTerminal = terminalId;
    if (!fromError) { stageErrorRef.current = null; setStageError(null); }
    const current = () => mountedRef.current && liveContextRef.current.terminalId === selectedTerminal
      && (selectedError ? stageErrorRef.current === selectedError : copyTargetRef.current === command);
    copyingRef.current = true;
    setCopyState("copying"); setCopyError("");
    try {
      await writeText(command);
      if (current()) setCopyState("copied");
    } catch (error) {
      if (current()) {
        setCopyState("idle");
        setCopyError(error instanceof Error ? `Could not copy command: ${error.message}` : "Could not copy command. Please try again.");
      }
    } finally {
      copyingRef.current = false;
    }
  };

  return (
    <>
      <div
        className="term-hist-backdrop"
        onClick={close}
        onMouseDown={(e) => {
          e.preventDefault();
          close();
        }}
      />
      <div
        className="term-hist"
        ref={panelRef}
        style={{ fontFamily }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="term-hist-input-wrap">
          <span className="term-hist-input-chip">
            <svg className="term-hist-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </span>
          <input
            ref={inputRef}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            maxLength={2000}
            readOnly={staging}
            className="term-hist-input"
            value={query}
            placeholder={loading ? "Loading history…" : aiMode ? "e.g. The command I used to forward Postgres" : "Search history…"}
            aria-label={aiMode ? "Describe a saved command" : "Search history"}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={true}
            aria-controls={listId}
            aria-activedescendant={activeCommand ? `${listId}-${index}` : undefined}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (stagingRef.current && e.key !== "Escape") { e.preventDefault(); return; }
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
                e.preventDefault();
                setIndex((i) => Math.min(Math.max((aiMode ? aiMatches?.length ?? 0 : scored.length) - 1, 0), i + 1));
              } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (!aiMode && (e.key === "PageDown" || e.key === "PageUp")) {
                e.preventDefault();
                setIndex((i) => Math.max(0, Math.min(scored.length - 1, i + (e.key === "PageDown" ? HISTORY_PAGE_SIZE : -HISTORY_PAGE_SIZE))));
              } else if (e.key === "Enter") {
                e.preventDefault();
                void choose(index);
              } else if (e.key === "Escape") {
                e.preventDefault();
                close();
              }
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="term-hist-input-clear"
              disabled={staging}
              onClick={() => {
                setQuery("");
                inputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
          <kbd className="term-hist-esc">esc</kbd>
        </div>

        <div className="term-hist-modes" aria-label="History search mode">
          {prefs.aiEnabled && <>
          <button type="button" disabled={staging} aria-pressed={!aiMode} onClick={() => { cancelRecall(); setAiMode(false); setIndex(0); setAiError(""); inputRef.current?.focus(); }}>Local search</button>
          <button type="button" disabled={staging} aria-pressed={aiMode} onClick={() => { setAiMode(true); setIndex(0); inputRef.current?.focus(); }}>Ask AI</button>
          </>}
          {!aiMode ? <label className="term-hist-sort">Order
            <select aria-label="History order" title="Uses saved file order when timestamps were not recorded" value={sort} disabled={staging} onChange={(event) => { setSort(event.target.value as HistorySort); setIndex(0); }}>
              <option value="newest">Newest first</option>
              <option value="relevance">Best match</option>
            </select>
          </label> : <span>Review before sending</span>}
        </div>
        {!aiMode && <p className="term-hist-search-hint">{search.approximate ? "No literal matches. Showing approximate matches." : "Search words in any order · up to 10,000 recent local commands"}</p>}
        {loadError && <div className="term-hist-load-error" role="alert">
          <span>{loadError}</span>
          {onRetry && <button type="button" disabled={loading || staging} onClick={onRetry}>{loading ? "Loading…" : "Retry"}</button>}
        </div>}

        {aiMode && <div className="term-hist-recall">
          <p>Review the commands below, then send your question and the checked entries to your selected AI provider. Local shell history is not your remote host’s history.</p>
          <details open={aiMatches === null} className="term-hist-recall-review">
            <summary>Review {reviewedCandidates.length} of {snapshot.total} recorded commands</summary>
            {(snapshot.sensitiveExcluded > 0 || snapshot.omitted > 0) && <p className="term-hist-recall-note">{snapshot.sensitiveExcluded} possible sensitive entries excluded · {snapshot.omitted} other entries outside this bounded sample</p>}
            <div className="term-hist-recall-candidates">
              {snapshot.candidates.map((candidate) => <label key={candidate.id}>
                <input type="checkbox" checked={!excluded.has(candidate.id)} disabled={aiBusy} aria-label={`Include ${candidate.command}`} onChange={() => {
                  setExcluded((current) => { const next = new Set(current); if (next.has(candidate.id)) next.delete(candidate.id); else next.add(candidate.id); return next; });
                  setAiMatches(null); setAiError("");
                }} />
                <span><code>{candidate.command}</code><small>{historyRecallMetadata(candidate)}</small></span>
              </label>)}
              {!snapshot.candidates.length && <p className="term-hist-recall-note">No eligible history entries in this sample.</p>}
            </div>
          </details>
          <div className="term-hist-recall-actions">
            <button type="button" disabled={aiBusy || loading || !query.trim() || !reviewedCandidates.length} onClick={() => { void findHistoryMatches(); }}>{aiBusy ? "Finding matches…" : "Find matches"}</button>
            {aiBusy && <button type="button" onClick={cancelRecall}>Stop</button>}
            <span>No commands are generated or executed.</span>
          </div>
          {aiError && <p role="alert" className="term-hist-recall-note">{aiError}</p>}
        </div>}

        <div className="term-hist-list" id={listId} role="listbox" aria-label="History results" ref={listRef} aria-busy={staging || loading}>
          {aiMode ? aiMatches && (aiMatches.length ? aiMatches.map((candidate, resultIndex) => <button
            type="button" key={candidate.id} className={`term-hist-item term-hist-recall-result ${resultIndex === index ? "active" : ""}`}
            id={`${listId}-${resultIndex}`} data-history-index={resultIndex} role="option" aria-selected={resultIndex === index}
            disabled={staging} title={`Stage this history command: ${candidate.command}`} onMouseEnter={() => { if (!stagingRef.current) setIndex(resultIndex); }} onClick={() => { void choose(resultIndex); }}
          ><span><code>{candidate.command}</code><small>{historyRecallMetadata(candidate)}</small></span><span className="term-hist-recall-stage">stage</span></button>)
            : <div className="term-hist-empty">No strong match in this reviewed sample. Try another description or local search.</div>) : <>
          {scored.length === 0 ? (
            <div className="term-hist-empty">
              {loading ? "Loading history…" : query.trim() ? "No matching history" : "No history entries"}
            </div>
          ) : (
            page.map(({ command, matchIndices, kind, recencyIndex }, pageIndex) => {
              const i = pageStart + pageIndex;
              const matchType = kind === "terms" ? "word" : kind;
              const hasQuery = query.trim().length > 0;
              const type = getCommandType(command);
              const isComment = type === "comment";
              const row = rows?.[recencyIndex]?.command === command ? rows[recencyIndex] : undefined;
              const date = row?.timestamp != null && Number.isFinite(new Date(row.timestamp * 1000).getTime())
                ? new Date(row.timestamp * 1000) : null;
              return (
                <button
                  key={`${i}-${command}`}
                  type="button"
                  id={`${listId}-${i}`} data-history-index={i} role="option" aria-selected={i === index}
                  className={[
                    "term-hist-item",
                    i === index ? "active" : "",
                    !hasQuery && i % 2 === 1 ? "alt" : "",
                    matchType === "prefix" ? "prefix-match" : matchType === "word" ? "word-match" : "",
                    isComment ? "comment" : "",
                    `type-${type}`,
                  ].join(" ")}
                  disabled={staging}
                  onMouseEnter={() => { if (!stagingRef.current) setIndex(i); }}
                  onClick={() => { void choose(i); }}
                  title={[command, date?.toLocaleString(), row?.source].filter(Boolean).join("\n")}
                >
                  <span className="term-hist-item-icon" aria-hidden="true">
                    {ICONS[type]}
                  </span>
                  <span className="term-hist-command">
                    {matchIndices.length > 0
                      ? highlightText(command, matchIndices)
                      : command}
                  </span>
                  {date && <time className="term-hist-date" dateTime={date.toISOString()}>{date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>}
                </button>
              );
            })
          )}
          </>}
        </div>
        {!aiMode && scored.length > HISTORY_PAGE_SIZE && <div className="term-hist-pagination" aria-label="History result pages">
          <span>{pageStart + 1}–{Math.min(pageStart + HISTORY_PAGE_SIZE, scored.length)} of {scored.length}</span>
          <button type="button" disabled={staging || pageStart === 0} onClick={() => { setIndex(Math.max(0, pageStart - HISTORY_PAGE_SIZE)); inputRef.current?.focus(); }}>Previous</button>
          <button type="button" disabled={staging || pageStart + HISTORY_PAGE_SIZE >= scored.length} onClick={() => { setIndex(pageStart + HISTORY_PAGE_SIZE); inputRef.current?.focus(); }}>Next</button>
        </div>}
        {stageError && <div className="term-hist-stage-error" role="alert">
          <strong>Could not stage history command</strong>
          <p>{stageError.message}</p>
          <code>{stageError.command}</code>
          <div className="term-hist-stage-actions">
            <button type="button" disabled={copyState === "copying"} onClick={() => { void copyCommand(stageError.command, true); }}>{copyState === "copying" ? "Copying…" : "Copy command"}</button>
            {copyState === "copied" && <span role="status">Copied. Nothing was run.</span>}
          </div>
          {copyError && <p>{copyError}</p>}
        </div>}
        {!stageError && copyState === "copied" && <p className="term-hist-search-hint" role="status">Copied. Nothing was run.</p>}
        {!stageError && copyError && <p className="term-hist-load-error" role="alert">{copyError}</p>}
        <div className="term-hist-footer">
          <span className="term-hist-footer-count">
            {aiMode ? aiMatches ? `${aiMatches.length} history match${aiMatches.length === 1 ? "" : "es"}` : "Review before sending" : scored.length > 0
              ? `${scored.length} result${scored.length === 1 ? "" : "s"}`
              : query.trim()
                ? "0 results"
                : ""}
          </span>
          <span className="term-hist-footer-hints">
            <button type="button" className="term-hist-save-command" disabled={staging || copyState === "copying" || !activeCommand}
              title="Copy the highlighted command without staging or running it" onClick={() => { void copyCommand(activeCommand); }}>Copy</button>
            <button type="button" className="term-hist-save-command" disabled={staging || loading || !(aiMode ? aiMatches?.[index]?.command : scored[index]?.command)}
              title="Save the highlighted command to Workflows; nothing is staged or run"
              onClick={() => {
                if (stagingRef.current) return;
                const command = aiMode ? aiMatches?.[index]?.command : scored[index]?.command;
                if (command && captureSavedCommand(command, "terminal-history")) close();
              }}>Save command…</button>
            <kbd>↑↓</kbd> navigate
            <span className="term-hist-footer-divider" />
            <kbd>↵</kbd> {staging ? "staging…" : "stage"}
            <span className="term-hist-footer-divider" />
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </>
  );
}
