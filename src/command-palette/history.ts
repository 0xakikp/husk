const LS_KEY = "huskv2.cmd-palette.history";
const MAX_HISTORY = 20;

interface CommandRecord {
  id: string;
  count: number;
  lastUsed: number;
}

interface HistoryStore {
  records: Record<string, CommandRecord>;
  recent: string[]; // ordered most-recent-first
}

function load(): HistoryStore {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as HistoryStore;
  } catch (e) { console.error("Failed to load command history", e); }
  return { records: {}, recent: [] };
}

function save(store: HistoryStore): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(store));
  } catch (e) { console.error("Failed to save command history", e); }
}

let cache = load();

export function recordCommandUse(id: string): void {
  const now = Date.now();
  const rec = cache.records[id] || { id, count: 0, lastUsed: 0 };
  rec.count += 1;
  rec.lastUsed = now;
  cache.records[id] = rec;

  cache.recent = [id, ...cache.recent.filter((x) => x !== id)].slice(0, MAX_HISTORY);
  save(cache);
}

/** Frecency score: higher = more frequent/recent */
export function getFrecencyScore(id: string): number {
  const rec = cache.records[id];
  if (!rec) return 0;
  const hoursSinceLastUse = (Date.now() - rec.lastUsed) / 36e5;
  // Exponential decay: 1/hour factor
  const recencyFactor = Math.max(0.1, 1 / (1 + hoursSinceLastUse));
  return rec.count * recencyFactor;
}

export function getCommandHistory(): string[] {
  return [...cache.recent];
}
