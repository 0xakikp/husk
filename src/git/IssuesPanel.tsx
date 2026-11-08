import { useCallback, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Bug01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listIssues, hasGhCli } from "./client";
import { useWorkspaceRoot } from "../workspace/store";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";
import { safeIssueUrl } from "./issueUrl";
import "./GitAuxPanels.css";

const PAGE_SIZE = 30;
const MAX_ISSUES = 300;

export function IssuesPanel({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceRoot();
  const [page, setPage] = useState({ workspace, limit: PAGE_SIZE });
  const limit = page.workspace === workspace ? page.limit : PAGE_SIZE;
  const load = useCallback(async (cwd: string, signal: AbortSignal) => {
    const available = await hasGhCli(cwd);
    if (signal.aborted) return [];
    if (!available) throw new Error("GitHub CLI is unavailable. Install gh and authenticate with gh auth login, then retry.");
    const result = await listIssues(cwd, limit);
    if (result.kind === "error") throw new Error(result.message);
    return result.issues;
  }, [limit]);
  const { data, loading, error, refresh } = useGitWorkspaceQuery(workspace, load);
  const [search, setSearch] = useState("");
  const [openError, setOpenError] = useState<{ workspace: string; message: string } | null>(null);
  const issues = data ?? [];
  const needle = search.trim().toLocaleLowerCase();
  const filtered = issues.filter((issue) => [`${issue.number}`, issue.title, issue.author?.login ?? "", ...issue.labels.map((label) => label.name)].some((value) => value.toLocaleLowerCase().includes(needle)));

  const openIssue = async (url: string) => {
    setOpenError(null);
    try { await openUrl(url); }
    catch { setOpenError({ workspace, message: "Could not open the issue in your browser. Try again." }); }
  };

  return (
    <section className="git-aux flex h-full min-w-0 flex-col bg-background text-foreground" aria-label="GitHub issues">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="inline-flex items-center gap-2"><HugeiconsIcon icon={Bug01Icon} size={15} className="text-primary" /><h2 className="text-xs font-semibold">GitHub issues</h2></div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh issues" title="Refresh issues" className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><HugeiconsIcon icon={Refresh01Icon} size={14} /></button>
          <button type="button" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Close issues">×</button>
        </div>
        <p className="basis-full truncate text-[10px] text-muted-foreground" title={workspace}>{workspace || "No project selected"}</p>
        <input type="search" aria-label="Search loaded issues" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search loaded issues…" className="h-8 w-full rounded-md border border-border bg-muted/20 px-2 text-xs outline-none focus:border-primary/60" />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-busy={loading}>
        {loading ? <p role="status" className="p-3 text-xs text-muted-foreground">Loading open issues…</p> : error ? <div className="space-y-3 p-3"><p role="alert" className="break-words text-xs text-destructive">Could not load issues: {error}</p>{workspace && <button type="button" onClick={refresh} className="text-xs text-primary hover:underline">Retry</button>}</div> : <>
          <p className="px-1 pb-3 text-[10px] text-muted-foreground">{needle ? `${filtered.length} matches · ` : ""}{issues.length} open issues loaded · opens in your browser</p>
          {openError?.workspace === workspace && <p role="alert" className="mb-3 text-xs text-destructive">{openError.message}</p>}
          {filtered.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{needle ? "No matching issues in the loaded results." : "No open issues in this repository."}</p> : <ul className="space-y-2">
            {filtered.map((issue) => {
              const url = safeIssueUrl(issue.url, issue.number);
              return <li key={issue.number} className="min-w-0 rounded-md border border-border/50 p-3">
                <button type="button" disabled={!url} onClick={() => { if (url) void openIssue(url); }} title={url ?? "A valid issue link is unavailable"} aria-label={`Open issue #${issue.number}: ${issue.title} in browser`} className="block w-full break-words text-left text-xs font-medium hover:text-primary disabled:cursor-default disabled:text-muted-foreground"><span className="text-primary">#{issue.number}</span> {issue.title}{url && <span aria-hidden="true"> ↗</span>}</button>
                <p className="mt-2 break-words text-[10px] text-muted-foreground">{issue.author?.login ?? "Deleted user"} · {issue.createdAt.slice(0, 10)}</p>
                {issue.labels.length > 0 && <ul className="mt-2 flex flex-wrap gap-1" aria-label="Labels">{issue.labels.map((label) => <li key={label.name} className="max-w-full break-words rounded border border-border px-1.5 py-0.5 text-[9px] text-muted-foreground"><span aria-hidden="true" className="mr-1 inline-block size-1.5 rounded-full" style={{ backgroundColor: /^[0-9a-f]{6}$/i.test(label.color) ? `#${label.color}` : "currentColor" }} />{label.name}</li>)}</ul>}
                {!url && <p className="mt-2 text-[10px] text-muted-foreground">Issue link unavailable.</p>}
              </li>;
            })}
          </ul>}
          {issues.length >= limit && <div className="py-4 text-center text-[11px] text-muted-foreground">{limit < MAX_ISSUES ? <button type="button" onClick={() => setPage({ workspace, limit: Math.min(MAX_ISSUES, limit + PAGE_SIZE) })} className="rounded border border-border px-3 py-1.5 text-primary hover:border-primary/60">Load {PAGE_SIZE} more issues</button> : <p>Showing up to {MAX_ISSUES} open issues. More may be available on GitHub.</p>}</div>}
        </>}
      </div>
    </section>
  );
}
