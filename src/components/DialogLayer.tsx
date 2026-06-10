import { cn } from "@/lib/utils";

/**
 * Wraps a floating overlay/dialog with a hyprland-style scale enter animation.
 * When the component mounts (dialog opens), it scales from 0.95 → 1 with a
 * subtle fade over 300ms using a smooth cubic-bezier curve.
 */
export function DialogLayer({
  open,
  children,
  className,
}: {
  open: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  if (!open) return null;
  return (
    <div className={cn("fixed inset-0 z-50 animate-dialog-enter", className)}>
      {children}
    </div>
  );
}
