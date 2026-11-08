import { lazy, Suspense, useCallback, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitForkIcon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { structuredLog } from "./client";
import { useWorkspaceRoot } from "../workspace/store";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";
import "./GitAuxPanels.css";

const PAGE_SIZE = 30;
const MAX_COMMITS = 300;
const GitCommitChanges = lazy(() => import("./GitCommitChanges").then((module) => ({ default: module.GitCommitChanges })));

export function GitGraphPanel({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceRoot();
  const [page, setPage] = useState({ workspace, limit: PAGE_SIZE });
  const limit = page.workspace === workspace ? page.limit : PAGE_SIZE;
  const load = useCallback((cwd: string) => structuredLog(limit, cwd), [limit]);
  const { data, loading, error, refresh } = useGitWorkspaceQuery(workspace, load);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<{ workspace: string; hash: string } | null>(null);
  const [copy, setCopy] = useState<{ workspace: string; hash: string; failed: boolean } | null>(null);
  const entries = data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const filtered = entries.filter((entry) => [entry.subject, entry.authorName, entry.hash].some((value) => value.toLocaleLowerCase().includes(needle)));

  const copyHash = async (hash: string) => {
    try {
      await writeText(hash);
      setCopy({ workspace, hash, failed: false });
    } catch {
      setCopy({ workspace, hash, failed: true });
    }
  };

  return (
    <section className="git-aux flex h-full min-w-0 flex-col bg-background text-foreground" aria-label="Commit history">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="inline-flex min-w-0 items-center gap-2">
          <HugeiconsIcon icon={GitForkIcon} size={15} className="shrink-0 text-primary" />
          <h2 className="text-xs font-semibold">Commit history</h2>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Refresh commit history" title="Refresh commit history" disabled={loading} onClick={refresh} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40">
            <HugeiconsIcon icon={Refresh01Icon} size={14} />
          </button>
          <button type="button" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close commit history">×</button>
        </div>
        <p className="basis-full truncate text-[10px] text-muted-foreground" title={workspace}>{workspace || "No project selected"}</p>
        <input type="search" aria-label="Search loaded commits" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded commits…" className="h-8 w-full rounded-md border border-border bg-muted/20 px-2 text-xs outline-none focus:border-primary/60" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
        {loading ? <p className="p-3 text-xs text-muted-foreground" role="status">Loading commits…</p> : error ? (
          <div className="space-y-3 p-3">
            <p role="alert" className="break-words text-xs text-destructive">Could not load commit history: {error}</p>
            {workspace && <button type="button" onClick={refresh} className="text-xs text-primary hover:underline">Retry</button>}
          </div>
        ) : (
          <>
            <p className="px-2 pb-3 text-[10px] text-muted-foreground">{needle ? `${filtered.length} matches · ` : ""}{entries.length} commits loaded from the current branch</p>
            {filtered.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{needle ? "No matching commits in the loaded history." : "No commits yet."}</p> : (
              <ol className="space-y-1">
                {filtered.map((entry) => {
                  const open = expanded?.workspace === workspace && expanded.hash === entry.hash;
                  const copyState = copy?.workspace === workspace && copy.hash === entry.hash ? copy : null;
                  return <li key={entry.hash} className="min-w-0 rounded-md border border-border/50">
                    <button type="button" aria-expanded={open} onClick={() => { setExpanded(open ? null : { workspace, hash: entry.hash }); setCopy(null); }} className="flex w-full min-w-0 flex-col gap-1.5 rounded-md p-3 text-left hover:bg-muted/40 focus-visible:outline focus-visible:outline-primary">
                      <span className="break-words text-xs font-medium">{entry.subject || "(No subject)"}</span>
                      <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground"><span className="font-mono text-primary">{entry.shortHash}</span><span className="min-w-0 break-words">{entry.authorName}</span><time>{entry.date}</time></span>
                    </button>
                    {open && <div className="space-y-2 border-t border-border/50 p-3 text-[11px]">
                      <p className="break-all font-mono text-muted-foreground">{entry.hash}</p>
                      <p>{entry.filesChanged} files changed · <span className="text-primary">+{entry.insertions}</span> · <span className="text-destructive">−{entry.deletions}</span></p>
                      <button type="button" onClick={() => void copyHash(entry.hash)} className="git-aux-action">{copyState && !copyState.failed ? "Copied hash" : "Copy commit hash"}</button>
                      {copyState?.failed && <p role="alert" className="text-destructive">Could not copy the hash. Try again.</p>}
                      <p className="text-muted-foreground">Changes are compared with the first parent for merge commits.</p>
                      <Suspense fallback={<p role="status">Loading commit viewer…</p>}><GitCommitChanges hash={entry.hash} cwd={workspace} /></Suspense>
                    </div>}
                  </li>;
                })}
              </ol>
            )}
            {entries.length >= limit ? <div className="py-4 text-center text-[11px] text-muted-foreground">
              {limit < MAX_COMMITS ? <button type="button" onClick={() => setPage({ workspace, limit: Math.min(MAX_COMMITS, limit + PAGE_SIZE) })} className="git-aux-action">Load {PAGE_SIZE} more commits</button> : <p>Showing the newest {MAX_COMMITS} commits. Older history remains in Git.</p>}
            </div> : entries.length > 0 ? <p className="py-4 text-center text-[10px] text-muted-foreground">End of current branch history</p> : null}
          </>
        )}
      </div>
    </section>
  );
}
