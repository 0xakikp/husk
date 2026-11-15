import { useEffect, useState } from "react";
import { searchWorkspace, workspaceSearchNotice, type WorkspaceSearchOutcome } from "./search";
import { displayEntryName } from "./entryNames";

export function FilesSearch({ root, includeHidden, refreshKey, active = true, onClose, onOpenFile, onOpenFileAtLine }: {
  root: string;
  includeHidden: boolean;
  refreshKey: number;
  active?: boolean;
  onClose: () => void;
  onOpenFile: (path: string, name: string) => void;
  onOpenFileAtLine?: (path: string, name: string, line: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"files" | "contents">("files");
  const [includeIgnored, setIncludeIgnored] = useState(false);
  const [outcome, setOutcome] = useState<WorkspaceSearchOutcome | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setOutcome(null); setError(null); setLoading(active && Boolean(query.trim()));
    if (!active || !query.trim()) return () => controller.abort();
    const timer = window.setTimeout(() => {
      void searchWorkspace({ root, query: query.trim(), mode, includeHidden, includeIgnored, maxResults: 200, signal: controller.signal })
        .then((result) => { if (!controller.signal.aborted) setOutcome(result); })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 200);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [root, query, mode, includeHidden, includeIgnored, refreshKey, retry, active]);
  const notice = outcome ? workspaceSearchNotice(outcome) : null;

  return <section className="files-search" aria-label="Search this Files root">
    <div className="files-search-modes" aria-label="Search type">
      <button type="button" aria-pressed={mode === "files"} onClick={() => setMode("files")}>Files</button>
      <button type="button" aria-pressed={mode === "contents"} onClick={() => setMode("contents")}>Contents</button>
      <button type="button" className="files-search-close" aria-label="Close search and clear query" onClick={onClose}>×</button>
    </div>
    <input autoFocus type="search" aria-label={mode === "files" ? "Find files by name or path" : "Find text in files"}
      value={query} onChange={(event) => setQuery(event.target.value)}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}
      placeholder={mode === "files" ? "File name or path…" : "Text in files…"} />
    <div className="files-search-options">
      <label><input type="checkbox" checked={includeIgnored} onChange={(event) => setIncludeIgnored(event.target.checked)} />Include ignored</label>
      <span>{includeHidden ? "Hidden included" : "Hidden excluded"}</span>
    </div>
    <p className="files-search-hint">Recursive · this folder only · {mode === "files" ? "names and paths" : "literal text"}</p>
    <div className="files-search-results" aria-busy={loading}>
      {loading ? <p className="files-tree-message" role="status">Searching…</p>
        : error ? <div className="files-tree-message" role="alert"><span>{error}</span><button type="button" onClick={() => setRetry((value) => value + 1)}>Retry search</button></div>
        : !query.trim() ? <p className="files-tree-message">Find a file anywhere below this folder, or search its contents. Hidden and ignored files are separate options.</p>
        : outcome ? <>
          <p className="files-search-summary" role="status">{outcome.results.length} result{outcome.results.length === 1 ? "" : "s"}
            {outcome.truncated || outcome.timedOut ? " · partial results" : ""}
            {outcome.skippedFiles > 0 ? ` · ${outcome.skippedFiles} skipped` : ""}</p>
          {notice && <p className="files-search-warning">{notice}</p>}
          {outcome.results.length === 0 && <p className="files-tree-message">{outcome.truncated || outcome.timedOut || outcome.skippedFiles || outcome.errors
            ? "No matches in the searched portion. Some items were not searched."
            : "No matches in this folder with these options."}</p>}
          {outcome.results.map((result, index) => <button type="button" className="files-search-result" key={`${result.path}:${result.line}:${index}`}
            title={`${displayEntryName(result.path)}${result.line ? `:${result.line}` : ""}`}
            onClick={() => {
              if (result.line && onOpenFileAtLine) onOpenFileAtLine(result.path, result.name, result.line);
              else onOpenFile(result.path, result.name);
            }}>
            <span className="files-search-result-name">{displayEntryName(result.name)}{result.line ? <span>:{result.line}</span> : null}</span>
            <span className="files-search-result-path">{displayEntryName(result.rel)}</span>
            {result.text !== null && <span className="files-search-result-text">{result.text}</span>}
          </button>)}
        </> : null}
    </div>
  </section>;
}
