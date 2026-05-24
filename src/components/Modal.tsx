import { type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * Shared modal built on Radix Dialog (focus trap, Esc, scroll-lock, a11y),
 * styled with Tailwind + husk tokens. Dialogs are rendered conditionally by the
 * parent, so `open` is always true and closing routes through `onClose`
 * (Esc / overlay click / the × button).
 */
export function Modal({
  title,
  onClose,
  className,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-80px)] w-[460px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_20px_60px_rgba(0,0,0,0.5)]",
            className,
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
            <DialogPrimitive.Title className="font-[family-name:var(--font-heading)] text-sm font-medium">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="text-lg leading-none text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Close"
            >
              ×
            </DialogPrimitive.Close>
          </div>
          <div className="no-scrollbar overflow-y-auto p-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
