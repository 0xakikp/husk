import type { ComponentProps, ReactNode } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { cn } from "@/lib/utils";

export const huskContextMenuContentClass =
  "husk-context-menu z-[100] min-w-[168px] overflow-hidden";

export const huskContextMenuItemClass =
  "husk-context-menu-item flex w-full items-center gap-2 text-left outline-none data-disabled:pointer-events-none data-disabled:opacity-40";

export const huskContextMenuDangerClass =
  "husk-context-menu-item-danger";

export const HuskContextMenu = ContextMenu;
export const HuskContextMenuTrigger = ContextMenuTrigger;

export function HuskContextMenuContent({
  title,
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuContent> & { title?: string; children: ReactNode }) {
  return (
    <ContextMenuContent className={cn(huskContextMenuContentClass, className)} {...props}>
      {title ? (
        <ContextMenuLabel className="husk-context-menu-label truncate">
          {title}
        </ContextMenuLabel>
      ) : null}
      {children}
    </ContextMenuContent>
  );
}

export function HuskContextMenuItem({
  icon,
  danger = false,
  className,
  children,
  ...props
}: ComponentProps<typeof ContextMenuItem> & {
  icon?: Parameters<typeof HugeiconsIcon>[0]["icon"];
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <ContextMenuItem
      {...props}
      className={cn(huskContextMenuItemClass, danger && huskContextMenuDangerClass, className)}
      variant={danger ? "destructive" : "default"}
    >
      {icon ? <HugeiconsIcon icon={icon} size={12} strokeWidth={1.7} className="shrink-0 opacity-80" /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </ContextMenuItem>
  );
}

export function HuskContextMenuSeparator({ className, ...props }: ComponentProps<typeof ContextMenuSeparator>) {
  return <ContextMenuSeparator className={cn("husk-context-menu-separator", className)} {...props} />;
}
