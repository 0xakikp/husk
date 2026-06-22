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
  score: number; // lower = better (0 = exact contiguous substring)
}

/**
 * Reverse-history picker (Ctrl+R): a filterable list of the shell's past
 * commands. Up/Down to move, Enter to drop the command at the prompt, Esc to
 * close. Replaces the shell's built-in reverse-i-search with a GUI list.
 *
 * Matching: exact substring first, then fuzzy (ordered chars). Results sorted
 * by match quality then recency (list order).
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
    if (!q) return entries.slice(0, 50).map((c) => ({ command: c, matchIndices: [] as number[], score: 0 }));

    const results: ScoredEntry[] = [];
    const lowerQ = q.toLowerCase();
    const seen = new Set<string>();

    for (const cmd of entries) {
      if (seen.has(cmd)) continue;
      const lower = cmd.toLowerCase();

      // Exact substring match (best)
      const exactIdx = lower.indexOf(lowerQ);
      if (exactIdx >= 0) {
        // contiguous match indices
        const indices = Array.from({ length: lowerQ.length }, (_, i) => exactIdx + i);
        results.push({
          command: cmd,
          matchIndices: indices,
          score: exactIdx, // lower = earlier in string = better match
        });
        seen.add(cmd);
        continue;
      }

      // Fuzzy match (fallback)
      const fuzzy = fuzzyMatch(q, cmd);
      if (fuzzy) {
        // Score: sum of gaps between matched chars (smaller gaps = tighter match)
        let gapScore = 0;
        for (let i = 1; i < fuzzy.length; i++) {
          gapScore += fuzzy[i] - fuzzy[i - 1] - 1;
        }
        results.push({
          command: cmd,
          matchIndices: fuzzy,
          score: 1000 + gapScore + fuzzy[0], // high base to sort below exact matches
        });
        seen.add(cmd);
      }
    }

    // Sort: exact substring matches first (by position), then fuzzy (by tightness)
    results.sort((a, b) => a.score - b.score);
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
          <div className="term-hist-empty">{loading ? "…" : "No matching history"}</div>
        ) : (
          scored.map(({ command, matchIndices }, i) => (
            <button
              key={`${i}-${command}`}
              type="button"
              className={`term-hist-item${i === index ? " active" : ""}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
            >
              {matchIndices.length > 0 ? highlightText(command, matchIndices) : command}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
