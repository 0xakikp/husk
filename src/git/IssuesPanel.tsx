import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bug01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { listIssues, hasGhCli, type GhIssue } from "./client";

export function IssuesPanel({ onClose }: { onClose: () => void }) {
  const [issues, setIssues] = useState<GhIssue[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGh, setHasGh] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      void (async () => {
        try {
          const available = await hasGhCli();
          if (cancelled) return;
          if (!available) {
            setHasGh(false);
            setError("gh CLI not found. Install it and authenticate with `gh auth login`.");
            setLoading(false);
            return;
          }
          setHasGh(true);
          const res = await listIssues();
          if (cancelled) return;
          if (res.kind === "error") {
            setError(res.message);
          } else {
            setIssues(res.issues);
          }
          setLoading(false);
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

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="inline-flex items-center gap-2">
          <HugeiconsIcon icon={Bug01Icon} size={14} strokeWidth={1.75} className="text-primary" />
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Issues
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              setIssues([]);
              setLoading(true);
              setError(null);
              void (async () => {
                try {
                  const available = await hasGhCli();
                  if (!available) {
                    setHasGh(false);
                    setError("gh CLI not found. Install it and authenticate with `gh auth login`.");
                    setLoading(false);
                    return;
                  }
                  setHasGh(true);
                  const res = await listIssues();
                  if (res.kind === "error") {
                    setError(res.message);
                  } else {
                    setIssues(res.issues);
                  }
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

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden]">
        {loading ? (
          <div className="flex flex-col gap-1.5 p-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex h-10 items-center gap-3">
                <div className="h-3 w-8 animate-pulse rounded bg-muted" />
                <div className="h-3 flex-1 animate-pulse rounded bg-muted" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col gap-3 px-4 py-6">
            <div className="rounded-md border border-rose-500/20 bg-rose-500/10 px-3 py-2">
              <p className="text-[12px] text-rose-400">Error: {error}</p>
            </div>
            {hasGh === false && (
              <p className="text-[11px] text-muted-foreground">
                Install the GitHub CLI and run <code className="rounded bg-muted px-1 text-[10px]">gh auth login</code> to connect.
              </p>
            )}
          </div>
        ) : issues.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
              <HugeiconsIcon icon={Bug01Icon} size={16} className="text-primary" />
            </div>
            <p className="text-[12px] font-medium text-foreground">No open issues</p>
            <p className="text-[11px] text-muted-foreground">
              There are no open issues in this repository.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-1 p-3">
            {issues.map((i) => (
              <a
                key={i.number}
                href={`https://github.com/issues/${i.number}`}
                target="_blank"
                rel="noreferrer"
                className="flex flex-col gap-1 rounded-md border border-border/40 p-2.5 transition-colors hover:border-primary/30 hover:bg-accent/5"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-0 text-[9px] font-bold uppercase ${
                      i.state === "OPEN"
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-rose-500/15 text-rose-400"
                    }`}
                  >
                    {i.state}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-foreground">
                    #{i.number} {i.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 pl-[calc(1.5rem+0.5rem)]">
                  {i.labels.map((l) => (
                    <span
                      key={l.name}
                      className="rounded px-1 py-0 text-[9px] font-medium"
                      style={{
                        backgroundColor: `#${l.color}22`,
                        color: `#${l.color}`,
                      }}
                    >
                      {l.name}
                    </span>
                  ))}
                  <span className="text-[10px] text-muted-foreground">
                    by {i.author.login} · {i.createdAt.slice(0, 10)}
                  </span>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
