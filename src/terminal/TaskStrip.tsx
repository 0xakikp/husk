import { useEffect, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Cancel01Icon, StopIcon } from "@hugeicons/core-free-icons";

import { typeInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";
import { clearTask, MIN_TASK_VISIBLE_MS, useTask } from "./taskStore";

function commandLabel(command: string): string {
  const compact = command.trim().replace(/\s+/g, " ");
  return compact.length > 46 ? `${compact.slice(0, 45)}…` : compact || "terminal command";
}

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

/**
 * A per-terminal task signal. It waits three seconds before appearing so quick
 * shell commands never flash extra chrome; successful long tasks remain until
 * dismissed or the next task replaces them.
 */
export function TaskStrip({
  leafId,
  onOpenLogs,
}: {
  leafId: number | null;
  onOpenLogs?: (leafId: number) => void;
}) {
  const task = useTask(leafId);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!task || task.completedAt != null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [task?.leafId, task?.startedAt, task?.completedAt]);

  if (!task || leafId == null) return null;
  const end = task.completedAt ?? now;
  const elapsed = end - task.startedAt;
  if (elapsed < MIN_TASK_VISIBLE_MS) return null;
  const running = task.completedAt == null;

  const interrupt = () => {
    if (!typeInActiveTerminal("\x03")) {
      toast({ title: "No active terminal", message: "Focus this terminal to interrupt the command.", variant: "error" });
      return;
    }
    toast({ title: "Interrupt requested", message: "Sent Ctrl+C to the active terminal.", variant: "info" });
  };

  return (
    <div className="relative flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-lg border border-primary/20 bg-background/50 px-2.5 font-mono text-[10.5px]">
      {running ? <span className="absolute inset-x-0 bottom-0 h-px animate-pulse bg-primary/70" /> : null}
      <span className={`size-1.5 shrink-0 rounded-full ${running ? "animate-pulse bg-primary shadow-[0_0_5px_hsl(var(--primary)/0.55)]" : "bg-emerald-400"}`} />
      <span className={`shrink-0 font-semibold uppercase tracking-[0.12em] ${running ? "text-primary/90" : "text-emerald-400"}`}>
        {running ? "running" : "complete"}
      </span>
      <span className="min-w-0 truncate text-foreground/90" title={task.command}>{commandLabel(task.command)}</span>
      <span className="shrink-0 text-muted-foreground/75">· {formatDuration(elapsed)}</span>

      <div className="min-w-1 flex-1" />

      {onOpenLogs ? (
        <button
          type="button"
          onClick={() => onOpenLogs(leafId)}
          className="shrink-0 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/45 hover:text-foreground"
          title="Show this terminal's output"
        >
          output
        </button>
      ) : null}
      {running ? (
        <button
          type="button"
          onClick={interrupt}
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-red-400/10 hover:text-red-400"
          title="Send Ctrl+C to the active terminal"
        >
          <HugeiconsIcon icon={StopIcon} size={10} strokeWidth={1.75} />
          stop
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => clearTask(leafId)}
        className="shrink-0 rounded-md p-0.5 text-muted-foreground/70 transition-colors hover:bg-muted/45 hover:text-foreground"
        title="Dismiss task status"
      >
        <HugeiconsIcon icon={Cancel01Icon} size={10} strokeWidth={1.75} />
      </button>
    </div>
  );
}
