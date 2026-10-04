const LS_KEY = "huskv2.cmd-palette.history";
const MAX_HISTORY = 20;
const MAX_RECORDS = 500;

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
  const records: Record<string, CommandRecord> = Object.create(null);
  try {
    const raw = localStorage.getItem(LS_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const stored = value as Partial<HistoryStore>;
      if (stored.records && typeof stored.records === "object" && !Array.isArray(stored.records)) {
        for (const [id, candidate] of Object.entries(stored.records)) {
          if (!candidate || typeof candidate !== "object") continue;
          if (!Number.isFinite(candidate.count) || candidate.count < 1 || !Number.isFinite(candidate.lastUsed) || candidate.lastUsed < 0) continue;
          records[id] = { id, count: Math.min(Math.floor(candidate.count), 1_000_000), lastUsed: Math.min(candidate.lastUsed, Date.now()) };
        }
      }
      trimRecords(records);
      const recent = Array.isArray(stored.recent)
        ? [...new Set(stored.recent.filter((id): id is string => typeof id === "string"))].slice(0, MAX_HISTORY)
        : [];
      return { records, recent };
    }
  } catch (e) { console.error("Failed to load command history", e); }
  return { records, recent: [] };
}

function trimRecords(records: Record<string, CommandRecord>): void {
  const ids = Object.keys(records);
  if (ids.length <= MAX_RECORDS) return;
  ids.sort((left, right) => records[right].lastUsed - records[left].lastUsed);
  for (const id of ids.slice(MAX_RECORDS)) delete records[id];
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
  rec.count = Math.min(rec.count + 1, 1_000_000);
  rec.lastUsed = now;
  cache.records[id] = rec;
  trimRecords(cache.records);

  cache.recent = [id, ...cache.recent.filter((x) => x !== id)].slice(0, MAX_HISTORY);
  save(cache);
}

/** Frecency score: higher = more frequent/recent */
export function getFrecencyScore(id: string): number {
  const rec = cache.records[id];
  if (!rec) return 0;
  const hoursSinceLastUse = Math.max(0, (Date.now() - rec.lastUsed) / 36e5);
  // Exponential decay: 1/hour factor
  const recencyFactor = Math.max(0.1, 1 / (1 + hoursSinceLastUse));
  return rec.count * recencyFactor;
}

export function getCommandHistory(): string[] {
  return [...cache.recent];
}
