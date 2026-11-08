import { useCallback } from "react";
import { commitDiff } from "./patches";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";
import { GitDiffView } from "./GitDiffView";

export function GitCommitChanges({ hash, cwd }: { hash: string; cwd: string }) {
  const load = useCallback((root: string) => commitDiff(hash, root), [hash]);
  const { data, loading, error, refresh } = useGitWorkspaceQuery(cwd, load);
  return <div className="git-commit-diff">
    {loading ? <p role="status">Loading commit changes…</p> : error ? <div role="alert"><p>{error}</p><button type="button" className="git-aux-action" onClick={refresh}>Retry changes</button></div>
      : <GitDiffView text={data ?? ""} title={`Commit ${hash.slice(0, 8)}`} />}
  </div>;
}
