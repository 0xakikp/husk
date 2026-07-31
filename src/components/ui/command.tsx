import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"

import { cn } from "@/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { HugeiconsIcon } from "@hugeicons/react"
import { SearchIcon } from "@hugeicons/core-free-icons"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl bg-background p-1 text-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description = "Search for a command to run...",
  children,
  className,
  showCloseButton = false,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof Dialog> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  /** Forwarded to the content layer so Escape can be intercepted (e.g. to close
   *  a nested action menu) by calling preventDefault on the event. */
  onEscapeKeyDown?: React.ComponentProps<typeof DialogContent>["onEscapeKeyDown"]
}) {
  return (
    <Dialog {...props}>
      <DialogHeader className="sr-only">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <DialogContent
        className={cn(
          /* Top-centred: inset + mx-auto rather than a centring translate, so the
             position never depends on a transform. @keyframes hyprland-scale-in
             below is unlayered and runs `forwards`, so any translate in it would
             silently outrank these classes. CommandList is capped to keep the
             bottom edge on screen. */
          "top-[12vh] left-0 right-0 mx-auto translate-x-0 translate-y-0 overflow-hidden rounded-xl! border border-border/40 bg-background/70 p-0 shadow-lg backdrop-blur-xl",
          "[&[data-state=open]]:animate-none", /* suppress radix default zoom */
          "animate-hyprland-enter",
          className
        )}
        /* No full-screen blur behind the launcher — the dim alone is enough, and
           the panel keeps its own frosted backdrop. */
        overlayClassName="supports-backdrop-filter:backdrop-blur-none"
        showCloseButton={showCloseButton}
        onEscapeKeyDown={onEscapeKeyDown}
      >
        {children}
      </DialogContent>
    </Dialog>
  )
}

function CommandInput({
  className,
  leftSlot,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  leftSlot?: React.ReactNode;
}) {
  return (
    <div data-slot="command-input-wrapper" className="p-2.5">
      <div className="command-capsule group relative flex h-11 items-center gap-2 rounded-full border border-accent/20 bg-white/[0.03] px-2.5 focus-within:border-accent/60">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent transition-colors duration-200 group-focus-within:bg-accent/20">
          <HugeiconsIcon icon={SearchIcon} strokeWidth={2} className="size-4" />
        </span>
        {leftSlot ? (
          <div className="flex shrink-0 items-center">{leftSlot}</div>
        ) : null}
        <CommandPrimitive.Input
          data-slot="command-input"
          className={cn(
            "h-full w-full min-w-0 border-0 bg-transparent text-[15px] text-foreground caret-accent outline-none ring-0 shadow-none placeholder:text-muted-foreground/35 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <kbd className="pointer-events-none shrink-0 rounded border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[9.5px] tracking-wider text-muted-foreground/50">
          esc
        </kbd>
      </div>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        /* The 7rem covers the search capsule row (~64px), footer and borders; 84vh
           then leaves the palette ending under 96vh given its 12vh top anchor, so
           a full list scrolls instead of running off the bottom. */
        "no-scrollbar max-h-[min(60vh,calc(84vh_-_7rem))] scroll-py-1 overflow-x-hidden overflow-y-auto p-1.5 outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden px-1 py-1 text-foreground **:[[cmdk-group-heading]]:mb-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1 **:[[cmdk-group-heading]]:text-[10px] **:[[cmdk-group-heading]]:font-semibold **:[[cmdk-group-heading]]:uppercase **:[[cmdk-group-heading]]:tracking-[0.12em] **:[[cmdk-group-heading]]:text-muted-foreground/50",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("my-1 h-px bg-border/40", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        /* cmdk renders data-selected on every item as "true" OR "false", so the
           bare `data-selected:` variant (an attribute-presence selector) would
           match every row — match =true explicitly. */
        "group/command-item relative flex cursor-default items-center gap-2 rounded-none px-2 py-1.5 text-[13px] text-foreground outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ml-auto inline-flex shrink-0 items-center rounded border border-white/[0.06] bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/70 group-data-[selected=true]/command-item:border-white/[0.08] group-data-[selected=true]/command-item:bg-white/[0.06] group-data-[selected=true]/command-item:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
