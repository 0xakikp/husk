import { useEffect, useMemo, useRef, useState } from "react";

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
    return { score: cmd.length, indices }; // shorter command = better
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

  const scored = useMemo(() => {
    const q = query.trim();
    // When query is empty, show most recent entries (already sorted by recency)
    if (!q) {
      return entries
        .slice(0, 50)
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
    return results.slice(0, 50);
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
    <div className="term-hist" ref={panelRef}>
      <div className="term-hist-header">
        <span className="term-hist-title">History</span>
        <span className="term-hist-hint">Ctrl+R</span>
      </div>
      <input
        autoFocus
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
      <div className="term-hist-list" ref={listRef}>
        {scored.length === 0 ? (
          <div className="term-hist-empty">
            {loading ? "Loading history…" : query.trim() ? "No matching history" : "No history entries"}
          </div>
        ) : (
          scored.map(({ command, matchIndices, score }, i) => {
            const matchType =
              score < 100 ? "prefix" : score < 200 ? "word" : score < 1000 ? "exact" : "fuzzy";
            return (
              <button
                key={`${i}-${command}`}
                type="button"
                className={`term-hist-item${i === index ? " active" : ""}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="term-hist-command">
                  {matchIndices.length > 0 ? highlightText(command, matchIndices) : command}
                </span>
                {matchType !== "exact" && (
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
        <span>
          {scored.length > 0
            ? `${scored.length} result${scored.length === 1 ? "" : "s"}`
            : query.trim()
              ? "0 results"
              : ""}
        </span>
        {scored.length > 0 && index >= 0 && (
          <span>{`${index + 1} / ${scored.length}`}</span>
        )}
      </div>
    </div>
  );
}
