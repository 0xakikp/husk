import { invoke } from "@tauri-apps/api/core";

export type WorkspaceSearchMode = "files" | "contents";

export type WorkspaceSearchResult = {
  path: string;
  rel: string;
  name: string;
  line: number | null;
  column: number | null;
  text: string | null;
};

export type WorkspaceSearchOutcome = {
  results: WorkspaceSearchResult[];
  truncated: boolean;
  timedOut: boolean;
  scannedFiles: number;
  skippedFiles: number;
  errors: number;
  reason: string | null;
};

export type WorkspaceSearchOptions = {
  root: string;
  query: string;
  mode: WorkspaceSearchMode;
  includeHidden?: boolean;
  includeIgnored?: boolean;
  maxResults?: number;
  signal?: AbortSignal;
};

const abortError = () => new DOMException("Workspace search was cancelled.", "AbortError");

/** One local directory scope, with native traversal/ignore matching and no CLI
 * dependency. Abort cancels the actual worker, not only its React result. */
export async function searchWorkspace(options: WorkspaceSearchOptions): Promise<WorkspaceSearchOutcome> {
  if (options.signal?.aborted) throw abortError();
  if (!options.root || !options.root.trim()) throw new Error("Open a folder before searching.");
  const id = crypto.randomUUID();
  const request = {
    id,
    root: options.root,
    query: options.query,
    mode: options.mode,
    includeHidden: options.includeHidden ?? false,
    includeIgnored: options.includeIgnored ?? false,
    maxResults: Math.max(1, Math.min(500, Math.floor(options.maxResults ?? 200) || 200)),
  };
  return new Promise<WorkspaceSearchOutcome>((resolve, reject) => {
    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener("abort", onAbort);
      action();
    };
    const onAbort = () => {
      void invoke("workspace_search_cancel", { id }).catch(() => {});
      finish(() => reject(abortError()));
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    void invoke<WorkspaceSearchOutcome>("workspace_search", { request }).then(
      (outcome) => finish(() => options.signal?.aborted ? reject(abortError()) : resolve(outcome)),
      (cause: unknown) => finish(() => reject(options.signal?.aborted
        ? abortError() : cause instanceof Error ? cause : new Error(String(cause)))),
    );
    // Covers an abort between the initial check and registering the listener.
    if (options.signal?.aborted) onAbort();
  });
}

/** Keep incomplete results distinct from an exhaustive "no matches". */
export function workspaceSearchNotice(outcome: WorkspaceSearchOutcome): string | null {
  const notices: string[] = [];
  if (outcome.reason) notices.push(outcome.reason);
  else if (outcome.timedOut) notices.push("Search reached its time limit. Narrow your query or choose a smaller folder.");
  else if (outcome.truncated) notices.push("More matches exist. Narrow your search.");
  if (outcome.errors) notices.push(`${outcome.errors} unreadable ${outcome.errors === 1 ? "item was" : "items were"} skipped.`);
  if (outcome.skippedFiles) notices.push(`${outcome.skippedFiles} binary, large, linked, or unsupported ${outcome.skippedFiles === 1 ? "file was" : "files were"} skipped.`);
  return notices.join(" ") || null;
}
