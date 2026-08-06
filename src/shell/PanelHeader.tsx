import type { ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "@/lib/utils";

export type PanelIcon = Parameters<typeof HugeiconsIcon>[0]["icon"];

/**
 * Banded-chip panel header — one anatomy for every sidebar rail view:
 * accent icon tile (the rail glyph), bold title, faint context, then
 * status/actions pinned right on a tinted band. The tile makes the panel
 * and its rail button read as one thing.
 */
export function PanelHeader({
  icon,
  title,
  context,
  status,
  actions,
  className,
}: {
  icon: PanelIcon;
  title: ReactNode;
  context?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "@container flex shrink-0 items-center gap-2 border-b border-border/40 bg-muted/20 px-2.5 py-[7px]",
        className,
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <HugeiconsIcon icon={icon} size={11} strokeWidth={1.9} />
      </span>
      {/* Space priority: context hides below 340px panel width; the title
          NEVER truncates; icons never clip or shrink below full size. */}
      <span className="shrink-0 text-[11.5px] font-semibold text-foreground">{title}</span>
      {context ? (
        <span className="hidden min-w-0 truncate text-[10px] text-muted-foreground/60 @[340px]:block">{context}</span>
      ) : null}
      {status || actions ? (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {status}
          {actions}
        </div>
      ) : null}
    </div>
  );
}
