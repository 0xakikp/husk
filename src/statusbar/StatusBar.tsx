import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, GitBranchIcon, ArrowRight01Icon, AlertCircleIcon, LayoutThreeColumnIcon } from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { IS_MAC } from "@/lib/platform";
import { useWorkspaceRoot } from "../workspace/store";
import { currentBranch, isRepo } from "../git/client";
import { useActiveTerminalCwd, useActiveTerminalExit } from "../ai/terminalContext";

export function StatusBar({
  onExplainError,
  sidebarOpen,
  onToggleSidebar,
}: {
  onExplainError?: () => void;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
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
      <div /* Opaque: chrome frames the content, so the wallpaper should not show through it. */
      className="flex h-6 shrink-0 items-center gap-3 border-t border-border bg-background px-3 text-[11px] text-muted-foreground select-none">
        {/* The sidebar's only permanent affordance.
            Collapsing the sidebar unmounts its rail too, so with no title-bar
            icon there was nothing on screen saying a file explorer exists — you
            had to already know Cmd+B or go looking in the launcher. It lives
            here rather than back in the title bar because the status bar costs
            the terminal no width, and it names the shortcut, which an icon
            cannot. Same idea as the "Search ⌘K" chip up top. */}
        {onToggleSidebar && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleSidebar}
                aria-pressed={sidebarOpen}
                className={cn(
                  "flex items-center gap-1.5 rounded px-1 -mx-1 transition-colors hover:text-foreground",
                  sidebarOpen && "text-foreground",
                )}
              >
                <HugeiconsIcon icon={LayoutThreeColumnIcon} size={12} strokeWidth={1.75} className="opacity-80" />
                <span>Files</span>
                <kbd className="rounded border border-border/50 bg-muted/30 px-1 font-mono text-[9px] leading-[13px] text-muted-foreground/70">
                  {IS_MAC ? "\u2318B" : "Ctrl B"}
                </kbd>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="text-[10.5px]">
              {sidebarOpen ? "Hide" : "Show"} the file explorer
            </TooltipContent>
          </Tooltip>
        )}
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
