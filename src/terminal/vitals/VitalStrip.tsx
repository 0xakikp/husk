import { cn } from "@/lib/utils";
import {
  Clock01Icon,
  CommandIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useVitals } from "./useVitals";

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m}m ${rem}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function commandName(cmd: string): string {
  if (!cmd) return "";
  // Extract first token, strip path
  const first = cmd.trim().split(/\s+/)[0] ?? "";
  return first.split("/").pop() ?? first;
}

export function VitalStrip() {
  const { command, running, elapsedMs, tick } = useVitals();
  void tick; // ensures the component re-renders every second while running

  if (!running || !command) return null;

  const name = commandName(command);
  const duration = formatDuration(elapsedMs);
  const isLong = elapsedMs > 60000; // amber after 1 min
  const isVeryLong = elapsedMs > 300000; // red after 5 min

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {/* Duration timer */}
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium tabular-nums",
          isVeryLong
            ? "bg-red-500/10 text-red-500"
            : isLong
              ? "bg-amber-500/10 text-amber-500"
              : "bg-muted/20 text-muted-foreground",
        )}
        title={`Running for ${duration}`}
      >
        <HugeiconsIcon icon={Clock01Icon} size={10} strokeWidth={1.75} />
        {duration}
      </span>

      {/* Command name */}
      <span
        className="inline-flex max-w-[120px] items-center gap-1 truncate rounded-md bg-primary/8 px-1.5 py-0.5 text-[11px] font-medium text-primary"
        title={command}
      >
        <HugeiconsIcon icon={CommandIcon} size={10} strokeWidth={1.75} />
        <span className="truncate">{name}</span>
      </span>
    </div>
  );
}
