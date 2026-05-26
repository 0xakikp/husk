import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitForkIcon,
  Refresh01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import { structuredLog, type CommitEntry } from "./client";

export function GitGraphPanel({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<CommitEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      void (async () => {
        try {
          const data = await structuredLog(30);
          if (!cancelled) {
            setEntries(data);
            setLoading(false);
          }
        } catch (e) {
          if (!cancelled) {
            setError(e instanceof Error ? e.message : String(e));
            setLoading(false);
          }
        }
      })();
    }, 100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const filtered = entries.filter(
    (e) =>
      e.subject.toLowerCase().includes(search.toLowerCase()) ||
      e.authorName.toLowerCase().includes(search.toLowerCase()) ||
      e.hash.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="inline-flex items-center gap-2">
          <HugeiconsIcon icon={GitForkIcon} size={14} strokeWidth={1.75} className="text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Git Graph
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative flex items-center">
            <HugeiconsIcon
              icon={Search01Icon}
              size={12}
              className="pointer-events-none absolute left-2 text-muted-foreground"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="h-7 w-48 rounded-md bg-muted/40 pl-6 pr-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-1 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setEntries([]);
              setLoading(true);
              setError(null);
              void (async () => {
                try {
                  const data = await structuredLog(30);
                  setEntries(data);
                  setLoading(false);
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                  setLoading(false);
                }
              })();
            }}
            className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <HugeiconsIcon icon={Refresh01Icon} size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      </div>

      <div className="flex shrink-0 items-center border-b border-border/50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="w-20 shrink-0">SHA</span>
        <span className="min-w-0 flex-1">Subject</span>
        <span className="w-32 shrink-0 text-right">Author</span>
        <span className="w-24 shrink-0 text-right">Date</span>
        <span className="w-20 shrink-0 text-right">Changes</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loading ? (
          <div className="flex flex-col gap-1.5 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex h-7 items-center gap-3">
                <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
                <div className="h-3 w-24 animate-pulse rounded bg-muted" />
                <div className="h-3 w-20 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-[12px] text-rose-400">Error: {error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setError(null);
                void (async () => {
                  try {
                    const data = await structuredLog(30);
                    setEntries(data);
                    setLoading(false);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                    setLoading(false);
                  }
                })();
              }}
              className="text-[11px] text-primary hover:underline"
            >
              Retry
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-center">
            <p className="text-[12px] text-muted-foreground">No commits</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((e) => (
              <div
                key={e.hash}
                className="flex items-center gap-2 border-b border-border/30 px-4 py-1.5 text-[11px]"
              >
                <span className="w-16 shrink-0 font-mono text-muted-foreground">
                  {e.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate text-foreground">{e.subject}</span>
                <span className="w-32 shrink-0 truncate text-right text-muted-foreground">
                  {e.authorName}
                </span>
                <span className="w-24 shrink-0 text-right text-muted-foreground">{e.date}</span>
                <span className="w-20 shrink-0 text-right font-mono text-[10px]">
                  {e.filesChanged > 0 && (
                    <span className="text-muted-foreground">📄 {e.filesChanged} </span>
                  )}
                  {e.insertions > 0 && <span className="text-primary">+{e.insertions} </span>}
                  {e.deletions > 0 && <span className="text-rose-400">-{e.deletions}</span>}
                </span>
              </div>
            ))}
            <p className="py-4 text-center text-[11px] text-muted-foreground">End of history</p>
          </div>
        )}
      </div>
    </div>
  );
}
