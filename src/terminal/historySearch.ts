export type HistorySort = "newest" | "relevance";
export type HistoryMatch = {
  command: string;
  matchIndices: number[];
  kind: "recent" | "exact" | "prefix" | "substring" | "terms" | "fuzzy";
  recencyIndex: number;
};

const rank = { recent: 0, exact: 0, prefix: 1, substring: 2, terms: 3, fuzzy: 4 };

/** Entries arrive newest first. Filtering must not silently replace that order
 * with command length. Approximate matches are a fallback, not extra noise. */
export function searchHistory(entries: readonly string[], query: string, sort: HistorySort = "newest") {
  const q = query.trim().toLowerCase();
  const terms = [...new Set(q.split(/\s+/).filter(Boolean))];
  const direct: HistoryMatch[] = [];
  const fuzzy: HistoryMatch[] = [];
  const seen = new Set<string>();
  for (let recencyIndex = 0; recencyIndex < entries.length; recencyIndex++) {
    const command = entries[recencyIndex];
    if (!command.trim() || seen.has(command)) continue;
    seen.add(command);
    const base = { command, recencyIndex };
    if (!q) { direct.push({ ...base, kind: "recent", matchIndices: [] }); continue; }
    const lower = command.toLowerCase();
    const start = lower.indexOf(q);
    if (start !== -1) {
      direct.push({ ...base, kind: lower === q ? "exact" : start === 0 ? "prefix" : "substring",
        matchIndices: Array.from({ length: q.length }, (_, index) => start + index) });
      continue;
    }
    const positions = terms.map((term) => lower.indexOf(term));
    if (positions.every((position) => position !== -1)) {
      const indices = terms.flatMap((term, index) => Array.from({ length: term.length }, (_, offset) => positions[index] + offset));
      direct.push({ ...base, kind: "terms", matchIndices: [...new Set(indices)].sort((a, b) => a - b) });
      continue;
    }
    // Familiar Ctrl+R abbreviations still work if no literal/word matches exist.
    let cursor = 0;
    const indices: number[] = [];
    for (const char of q.replace(/\s+/g, "")) {
      const position = lower.indexOf(char, cursor);
      if (position === -1) break;
      indices.push(position); cursor = position + char.length;
    }
    if (indices.length === [...q.replace(/\s+/g, "")].length) fuzzy.push({ ...base, kind: "fuzzy", matchIndices: indices });
  }
  const matches = direct.length ? direct : fuzzy;
  if (sort === "relevance" && q) matches.sort((a, b) => rank[a.kind] - rank[b.kind] || a.recencyIndex - b.recencyIndex);
  return { matches, approximate: !direct.length && fuzzy.length > 0 };
}
