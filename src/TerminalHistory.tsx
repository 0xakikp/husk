import { useEffect, useMemo, useRef, useState } from "react";
import { getPrefs } from "./settings/preferences";
import { fontStack } from "./styles/fonts";

/**
 * Ordered-character fuzzy match: every character of `query` must appear in
 * `text` in order (any number of chars in between). Returns matched indices
 * or null. Case-insensitive.
 */
function fuzzyMatch(query: string, text: string): number[] | null {
  const qi = query.toLowerCase();
  const ti = text.toLowerCase();
  const indices: number[] = [];
  let tiPos = 0;
  for (let qiPos = 0; qiPos < qi.length; qiPos++) {
    const ch = qi[qiPos];
    tiPos = ti.indexOf(ch, tiPos);
    if (tiPos === -1) return null;
    indices.push(tiPos);
    tiPos++;
  }
  return indices;
}

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

interface ScoredEntry {
  command: string;
  matchIndices: number[];
  score: number; // lower = better
  recencyIndex: number; // lower = more recent (original position in entries)
}

/**
 * Word-boundary match: each query char must match the start of a word
 * (after space, /, -, _, ., or at string start). Returns matched indices or null.
 */
function wordBoundaryMatch(query: string, text: string): number[] | null {
  const qi = query.toLowerCase();
  const ti = text.toLowerCase();
  const indices: number[] = [];
  let tiPos = 0;
  for (let qiPos = 0; qiPos < qi.length; qiPos++) {
    const ch = qi[qiPos];
    // Find ch at a word boundary
    let found = false;
    while (tiPos < ti.length) {
      if (ti[tiPos] === ch && (tiPos === 0 || /[\s/\-_.]/.test(ti[tiPos - 1]))) {
        indices.push(tiPos);
        tiPos++;
        found = true;
        break;
      }
      tiPos++;
    }
    if (!found) return null;
  }
  return indices;
}

/**
 * Compute a match score. Lower = better.
 * Tiers:
 *   0-99   : prefix match (command starts with query)
 *   100-199: word-boundary match (each query char starts a word)
 *   200-299: exact substring match
 *   1000+  : fuzzy match (ordered chars anywhere)
 *
 * Within each tier, shorter commands score better (more relevant).
 */
function computeScore(
  cmd: string,
  lowerCmd: string,
  lowerQ: string,
  exactIdx: number,
  fuzzy: number[] | null,
  wordBoundary: number[] | null,
): { score: number; indices: number[] } | null {
  // Prefix match (best) — command starts with query
  if (lowerCmd.startsWith(lowerQ)) {
    const indices = Array.from({ length: lowerQ.length }, (_, i) => i);
    // Penalize bare commands (e.g. just "ssh" with no args) — they're less useful
    // A bare command is one where the trimmed length equals the query length
    // (meaning no additional arguments beyond the query itself)
    const trimmedCmd = cmd.trim();
    const isBareCommand = trimmedCmd.length === lowerQ.length;
    // Also penalize commands that are just the query plus whitespace
    const isQueryOnly = trimmedCmd.toLowerCase() === lowerQ;
    const barePenalty = (isBareCommand || isQueryOnly) ? 500 : 0;
    return { score: cmd.length + barePenalty, indices }; // shorter command = better, but bare commands penalized
  }

  // Word-boundary match — each query char starts a word
  if (wordBoundary) {
    const gapScore = wordBoundary.reduce((sum, idx, i) => {
      if (i === 0) return idx;
      return sum + (idx - wordBoundary[i - 1]);
    }, 0);
    return { score: 100 + gapScore + wordBoundary[0], indices: wordBoundary };
  }

  // Exact substring match
  if (exactIdx >= 0) {
    const indices = Array.from({ length: lowerQ.length }, (_, i) => exactIdx + i);
    return { score: 200 + exactIdx + cmd.length, indices };
  }

  // Fuzzy match (fallback)
  if (fuzzy) {
    let gapScore = 0;
    for (let i = 1; i < fuzzy.length; i++) {
      gapScore += fuzzy[i] - fuzzy[i - 1] - 1;
    }
    return { score: 1000 + gapScore + fuzzy[0] + cmd.length, indices: fuzzy };
  }

  return null;
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
 * Matching: prefix > word-boundary > exact substring > fuzzy. Results sorted
 * by match quality, then command length (shorter = more relevant), then recency.
 */
export function TerminalHistoryPanel({
  entries,
  loading,
  onSelect,
  onClose,
}: {
  entries: string[];
  loading: boolean;
  onSelect: (command: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Use the user's chosen terminal font so the panel feels native; sizing
  // follows the spotlight palette (13px rows / 15px input), not the terminal.
  const prefs = getPrefs();
  const fontFamily = fontStack(prefs.fontFamily);

  const scored = useMemo(() => {
    const q = query.trim();
    // When query is empty, show most recent entries (already sorted by recency)
    if (!q) {
      return entries
        .slice(0, 16)
        .map((c, i) => ({ command: c, matchIndices: [] as number[], score: 0, recencyIndex: i }));
    }

    const results: ScoredEntry[] = [];
    const lowerQ = q.toLowerCase();

    for (let recencyIdx = 0; recencyIdx < entries.length; recencyIdx++) {
      const cmd = entries[recencyIdx];
      const lower = cmd.toLowerCase();

      const exactIdx = lower.indexOf(lowerQ);
      const fuzzy = fuzzyMatch(q, cmd);
      const wordBoundary = wordBoundaryMatch(q, cmd);

      const match = computeScore(cmd, lower, lowerQ, exactIdx, fuzzy, wordBoundary);
      if (match) {
        results.push({
          command: cmd,
          matchIndices: match.indices,
          score: match.score,
          recencyIndex: recencyIdx,
        });
      }
    }

    // Sort: score first, then recency (more recent = lower index = better)
    results.sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return a.recencyIndex - b.recencyIndex;
    });
    return results.slice(0, 16);
  }, [entries, query]);

  useEffect(() => {
    setIndex(0);
  }, [query, entries]);

  useEffect(() => {
    const el = listRef.current?.children[index] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [index]);

  // Close on click outside or Escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
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

  const choose = (i: number) => {
    const cmd = scored[i]?.command;
    if (cmd) onSelect(cmd);
  };

  return (
    <>
      <div
        className="term-hist-backdrop"
        onClick={onClose}
        onMouseDown={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="term-hist"
        ref={panelRef}
        style={{ fontFamily }}
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
            className="term-hist-input"
            value={query}
            placeholder={loading ? "Loading history…" : "Search history…"}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || (e.ctrlKey && e.key.toLowerCase() === "r")) {
                e.preventDefault();
                setIndex((i) => Math.min(Math.max(scored.length - 1, 0), i + 1));
              } else if (e.key === "ArrowUp" || (e.ctrlKey && e.key.toLowerCase() === "p")) {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(index);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />
          {query.length > 0 && (
            <button
              type="button"
              className="term-hist-input-clear"
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

        <div className="term-hist-list" ref={listRef}>
          {scored.length === 0 ? (
            <div className="term-hist-empty">
              {loading ? "Loading history…" : query.trim() ? "No matching history" : "No history entries"}
            </div>
          ) : (
            scored.map(({ command, matchIndices, score }, i) => {
              const matchType =
                score < 100 ? "prefix" : score < 200 ? "word" : score < 1000 ? "exact" : "fuzzy";
              const hasQuery = query.trim().length > 0;
              const type = getCommandType(command);
              const isComment = type === "comment";
              return (
                <button
                  key={`${i}-${command}`}
                  type="button"
                  className={[
                    "term-hist-item",
                    i === index ? "active" : "",
                    !hasQuery && i % 2 === 1 ? "alt" : "",
                    matchType === "prefix" ? "prefix-match" : matchType === "word" ? "word-match" : "",
                    isComment ? "comment" : "",
                    `type-${type}`,
                  ].join(" ")}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(i)}
                  title={command} /* full text on hover */
                >
                  <span className="term-hist-item-icon" aria-hidden="true">
                    {ICONS[type]}
                  </span>
                  <span className="term-hist-command">
                    {matchIndices.length > 0
                      ? highlightText(command, matchIndices)
                      : command}
                  </span>
                  {hasQuery && matchType !== "exact" && (
                    <span className={`term-hist-match-badge ${matchType}`}>
                      {matchType === "prefix" ? "prefix" : matchType === "word" ? "word" : "fuzzy"}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="term-hist-footer">
          <span className="term-hist-footer-count">
            {scored.length > 0
              ? `${scored.length}${entries.length > 20 ? "+" : ""} result${scored.length === 1 ? "" : "s"}`
              : query.trim()
                ? "0 results"
                : ""}
          </span>
          <span className="term-hist-footer-hints">
            <kbd>↑↓</kbd> navigate
            <span className="term-hist-footer-divider" />
            <kbd>↵</kbd> run
            <span className="term-hist-footer-divider" />
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </>
  );
}
