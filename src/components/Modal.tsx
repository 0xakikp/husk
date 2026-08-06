import { useEffect, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import { PanelHeader, type PanelIcon } from "../shell/PanelHeader";
import { SHEET_HOST_ID, sheetHost, useIsSidebarSheet } from "./sheetHost";

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
  icon,
  context,
}: {
  title: ReactNode;
  onClose?: () => void;
  className?: string;
  children: ReactNode;
  inline?: boolean;
  headerActions?: ReactNode;
  icon?: PanelIcon;
  context?: ReactNode;
}) {
  const isSheet = useIsSidebarSheet();
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
    /* No bg here: the sidebar container (SidebarHost) already paints the
       surface — translucent frosted when a terminal background image is set,
       near-opaque otherwise. An opaque bg on this root hid the wallpaper
       behind every rail panel except the file explorer. */
    return (
      <div className="flex h-full min-h-0 flex-col">
        {icon ? (
          <PanelHeader icon={icon} title={title} context={context} actions={headerActions} />
        ) : (
          <div className="flex h-8 shrink-0 items-center justify-between gap-1 border-b border-border/40 px-3">
            <span className="sidebar-rail-title truncate">{title}</span>
            {headerActions ? <div className="flex items-center gap-0.5">{headerActions}</div> : null}
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    );
  }
  /* Opened from inside a sidebar view: fill the panel instead of floating over
     the app. Radix's Portal takes a container, so this keeps the focus trap,
     Esc handling and a11y wiring and only changes where it lands. */
  const asSheet = isSheet && !!document.getElementById(SHEET_HOST_ID);

  return (
    <DialogPrimitive.Root
      open
      /* Non-modal: Radix's modal mode traps focus, marks the rest of the app
         aria-hidden and sets `pointer-events: none` on <body>, which is exactly
         what stops you using the terminal while a dialog is open. Esc still
         closes — Radix listens on the document either way. */
      modal={false}
      onOpenChange={(o) => {
        if (!o) onClose?.();
      }}
    >
      <DialogPrimitive.Portal container={asSheet ? sheetHost() : undefined}>
        {/* No dim, no blur, and transparent to the pointer: the terminal behind
            stays readable and clickable so its output can be copied into this
            dialog. Kept (rather than deleted) only for the fade animation. */}
        <DialogPrimitive.Overlay className={asSheet ? "hidden" : "pointer-events-none fixed inset-0 z-50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0"} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          {...(asSheet ? {} : { "data-movable": true })}
          /* A click outside is now aimed at whatever is under it — usually the
             terminal — so it must not also mean cancel. */
          onInteractOutside={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className={cn(
            asSheet
              ? "sidebar-sheet-panel"
              : "fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-80px)] w-[460px] max-w-[calc(100vw-40px)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-[0_24px_70px_rgba(0,0,0,0.7)] duration-150 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            // A sheet is the panel, so a caller's max-width/rounding would fight it.
            !asSheet && className,
          )}
        >
          <div
            {...(asSheet ? {} : { "data-drag-handle": true })}
            className={cn(
              "flex shrink-0 items-center justify-between border-b border-border",
              asSheet ? "h-8 px-3" : "h-11 cursor-move px-4",
            )}
          >
            <DialogPrimitive.Title
              className={cn(
                "font-[family-name:var(--font-heading)] truncate",
                // Matches the inline panel header, so drilling in does not change
                // the weight and colour of the thing you are reading.
                asSheet ? "text-xs font-semibold text-primary" : "text-sm font-medium",
              )}
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="inline-flex size-6 items-center justify-center rounded text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white"
              aria-label="Close"
            >
              <span className="text-lg leading-none">×</span>
            </DialogPrimitive.Close>
          </div>
          <div
            className={cn(
              "no-scrollbar overflow-y-auto",
              // flex-1/min-h-0 so the body scrolls inside the panel rather than
              // pushing past it; p-6 is too generous for a 220px column.
              asSheet ? "min-h-0 flex-1 p-3" : "p-6",
            )}
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
