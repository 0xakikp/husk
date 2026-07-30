import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * A labelled settings group rendered as a single bordered card.
 * Rows inside are separated by hairline dividers instead of each row
 * being its own box.
 */
export function SettingsGroup({
  label,
  children,
  className,
}: {
  label?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {label ? (
        <span className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground/70">
          {label}
        </span>
      ) : null}
      <div className="overflow-hidden rounded-lg border border-border/40 bg-muted/10 divide-y divide-border/40">
        {children}
      </div>
    </div>
  );
}
