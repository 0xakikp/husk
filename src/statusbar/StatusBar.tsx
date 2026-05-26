import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, GitBranchIcon, ArrowRight01Icon, AlertCircleIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useWorkspaceRoot } from "../workspace/store";
import { currentBranch, isRepo } from "../git/client";
import { useActiveTerminalCwd, useActiveTerminalExit } from "../ai/terminalContext";

export function StatusBar({
  onExplainError,
}: {
  onExplainError?: () => void;
}) {
  const root = useWorkspaceRoot();
  const cwd = useActiveTerminalCwd();
  const exit = useActiveTerminalExit();
  const [branch, setBranch] = useState("");

  useEffect(() => {
    let alive = true;
    void (async () => {
      if (await isRepo()) {
        const b = await currentBranch();
        if (alive) setBranch(b);
      } else if (alive) {
        setBranch("");
      }
    })();
    return () => {
      alive = false;
    };
  }, [root]);

  const name = root ? root.split("/").filter(Boolean).pop() || root : "~";
  // Live shell cwd from OSC 7 — show the last couple of path segments, full
  // path on hover.
  const prettyCwd = (() => {
    const parts = cwd.split("/").filter(Boolean);
    if (parts.length === 0) return cwd ? "/" : "";
    return (parts.length > 2 ? "…/" : "/") + parts.slice(-2).join("/");
  })();

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-[11px] text-muted-foreground select-none">
        <span className="flex items-center gap-1.5">
          <HugeiconsIcon icon={Folder01Icon} size={12} strokeWidth={1.75} className="opacity-80" />
          {name}
        </span>
        {branch ? (
          <span className="flex items-center gap-1.5">
            <HugeiconsIcon icon={GitBranchIcon} size={12} strokeWidth={1.75} className="opacity-80" />
            {branch}
          </span>
        ) : null}
        {prettyCwd ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex items-center gap-1.5">
                <HugeiconsIcon icon={ArrowRight01Icon} size={12} strokeWidth={2} className="text-primary" />
                {prettyCwd}
              </span>
            </TooltipTrigger>
            <TooltipContent>{cwd}</TooltipContent>
          </Tooltip>
        ) : null}
        {exit != null && exit !== 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onExplainError?.()}
                className="ml-auto flex items-center gap-1.5 text-destructive transition-[filter] hover:brightness-125"
              >
                <HugeiconsIcon icon={AlertCircleIcon} size={12} strokeWidth={1.75} />
                {exit} · explain
              </button>
            </TooltipTrigger>
            <TooltipContent>Explain this error (AI)</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
