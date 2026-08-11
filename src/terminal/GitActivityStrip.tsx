import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon } from "@hugeicons/core-free-icons";

import { branchAheadBehind, currentBranch, isRepo, status } from "../git/client";
import { typeInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { clearGitActivity, useGitActivity } from "./gitActivityStore";

type GitSummary = { branch: string; changedFiles: number; ahead: number; behind: number };

/** Re-reads Git from the completed command's cwd, never from whichever tab is
 * active by the time the request resolves. */
export function GitActivityStrip({
  leafId,
  onOpenSourceControl,
}: {
  leafId: number | null;
  onOpenSourceControl: () => void;
}) {
  const activity = useGitActivity(leafId);
  const [summary, setSummary] = useState<GitSummary | null>(null);

  useEffect(() => {
    if (!activity) {
      setSummary(null);
      return;
    }
    setSummary(null);
    let cancelled = false;
    void (async () => {
      if (!(await isRepo(activity.cwd))) return;
      const [branch, files, divergence] = await Promise.all([
        currentBranch(activity.cwd),
        status(activity.cwd),
        branchAheadBehind(activity.cwd),
      ]);
      if (!cancelled) setSummary({ branch, changedFiles: files.length, ...divergence });
    })();
    return () => { cancelled = true; };
  }, [activity?.at, activity?.cwd]);

  if (!activity || leafId == null) return null;
  const details = summary
    ? `${summary.branch || "detached HEAD"}${summary.changedFiles ? ` · ${summary.changedFiles} changed` : ""}${summary.ahead ? ` · ↑${summary.ahead}` : ""}${summary.behind ? ` · ↓${summary.behind}` : ""}`
    : "refreshing status…";

  const stageStatus = () => {
    if (!typeInActiveTerminal("git status --short")) {
      toast({ title: "No active terminal", message: "Focus this terminal to stage Git status.", variant: "error" });
      return;
    }
    toast({ title: "Git status staged", message: "Review it in the terminal, then press Enter to run.", variant: "info" });
  };

  return (
    <div className="flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-violet-400/25 bg-background/50 px-2.5 font-mono text-[10.5px]">
      <span className="size-1.5 shrink-0 rounded-full bg-violet-400 shadow-[0_0_5px_rgba(167,139,250,0.5)]" />
      <span className="shrink-0 font-semibold uppercase tracking-[0.12em] text-violet-300">git</span>
      <span className="shrink-0 text-foreground/90">{activity.action}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={details}>· {details}</span>

      <div className="min-w-1 flex-1" />

      <button
        type="button"
        onClick={onOpenSourceControl}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-violet-300/90 transition-colors hover:bg-violet-400/10 hover:text-violet-200"
      >
        review
      </button>
      <button
        type="button"
        onClick={stageStatus}
        className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Stage git status in the terminal; it will not run until you press Enter"
      >
        status
      </button>
      <button
        type="button"
        onClick={() => clearGitActivity(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss Git summary"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
