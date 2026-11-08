import { GitForkIcon } from "@hugeicons/core-free-icons";
import { Modal } from "../components/Modal";
import { useWorkspaceRoot } from "../workspace/store";
import { log } from "./client";
import { useGitWorkspaceQuery } from "./useGitWorkspaceQuery";

const loadHistory = (cwd: string) => log(80, cwd);

export function GitHistoryDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspaceRoot();
  const { data, loading, error, refresh } = useGitWorkspaceQuery(workspace, loadHistory);

  return <Modal title="Git history" icon={GitForkIcon} onClose={onClose} className="w-[760px]">
    <p className="mb-3 break-all text-[11px] text-muted-foreground">{workspace || "No project selected"}</p>
    {loading ? <p role="status" className="text-xs text-muted-foreground">Loading history…</p> : error ? <div className="space-y-3"><p role="alert" className="break-words text-xs text-destructive">Could not load history: {error}</p>{workspace && <button type="button" onClick={refresh} className="text-xs text-primary hover:underline">Retry</button>}</div> : data ? <>
      <pre className="max-h-[55vh] overflow-auto whitespace-pre text-[11px] leading-relaxed">{data}</pre>
      <p className="mt-3 text-[10px] text-muted-foreground">Current branch · up to 80 commits · read-only</p>
      <button type="button" onClick={refresh} className="mt-3 text-xs text-primary hover:underline">Refresh history</button>
    </> : <p className="text-xs text-muted-foreground">No commits yet.</p>}
  </Modal>;
}
