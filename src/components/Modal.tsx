import { useEffect, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";

/**
 * Shared modal built on Radix Dialog (focus trap, Esc, scroll-lock, a11y),
 * styled with Tailwind + husk tokens. Dialogs are rendered conditionally by the
 * parent, so `open` is always true and closing routes through `onClose`.
 *
 * With `inline`, it renders as a flush sidebar view instead (header + scrollable
 * body, no overlay) — husk v1's model where the rail switches the sidebar view.
 */
export function Modal({
  title,
  onClose,
  className,
  children,
  inline = false,
  headerActions,
}: {
  title: ReactNode;
  onClose?: () => void;
  className?: string;
  children: ReactNode;
  inline?: boolean;
  headerActions?: ReactNode;
}) {
  // Safety net: Radix's modal Dialog sets `pointer-events: none` on <body>
  // while open. Because dialogs here render conditionally, an unmount-while-open
  // can skip Radix's cleanup and leave the whole window unclickable (can't drag
  // or select it). Always restore body interactivity when a Modal unmounts.
  useEffect(() => {
    return () => {
      document.body.style.pointerEvents = "";
    };
  }, []);

  if (inline) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/40 px-3">
          <span className="truncate text-xs font-semibold text-primary">{title}</span>
          {headerActions ? <div className="flex items-center gap-0.5">{headerActions}</div> : null}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    );
  }
  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(o) => {
        if (!o) onClose?.();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-80px)] w-[460px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            className,
          )}
        >
          <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
            <DialogPrimitive.Title className="font-[family-name:var(--font-heading)] text-sm font-medium">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <span className="text-lg leading-none">×</span>
            </DialogPrimitive.Close>
          </div>
          <div className="no-scrollbar overflow-y-auto p-4">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
