import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderTreeIcon, FolderGitTwoIcon, DatabaseIcon, WorkflowCircle01Icon,
  PuzzleIcon, NotebookIcon, TimelineListIcon, MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";

export type SidebarViewId =
  | "explorer" | "source-control" | "remotes" | "workflows" | "vault"
  | "timeline" | "tools-hub" | "kubernetes" | "docker" | "tailscale"
  | "sftp" | "bookmarks";

/** Sub-panels keep their owning rail destination selected. IDs stay stable. */
export function sidebarRailParent(view: SidebarViewId): SidebarViewId {
  if (["kubernetes", "docker", "tailscale"].includes(view)) return "tools-hub";
  if (view === "sftp") return "remotes";
  if (view === "bookmarks") return "explorer";
  return view;
}

const SLOTS = [
  { id: "explorer", label: "Files", icon: FolderTreeIcon },
  { id: "source-control", label: "Source control", icon: FolderGitTwoIcon },
  { id: "remotes", label: "Remotes", icon: DatabaseIcon },
  { id: "workflows", label: "Workflows", icon: WorkflowCircle01Icon },
  { id: "vault", label: "Notes", icon: NotebookIcon },
  { id: "timeline", label: "Timeline", icon: TimelineListIcon },
  { id: "tools-hub", label: "Tools", icon: PuzzleIcon },
] as const;

export function visibleRailSlots(width: number): number {
  const capacity = Math.max(1, Math.floor((width - 8) / 32));
  return capacity >= SLOTS.length ? SLOTS.length : Math.max(0, capacity - 1);
}

const buttonClass = (selected: boolean) => cn(
  "relative inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors",
  "focus-visible:ring-1 focus-visible:ring-primary/60",
  selected ? "bg-primary/12 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
);

export function SidebarRail({ view, onSelectView, changedCount = 0 }: {
  view: SidebarViewId;
  onSelectView: (v: SidebarViewId) => void;
  changedCount?: number;
}) {
  const railRef = useRef<HTMLElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(SLOTS.length);
  const parent = sidebarRailParent(view);
  const visible = SLOTS.slice(0, visibleCount);
  const hidden = SLOTS.slice(visibleCount);
  const hiddenActive = hidden.find((slot) => slot.id === parent);

  useLayoutEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const measure = (width: number) => {
      if (width > 0) setVisibleCount(visibleRailSlots(width));
    };
    measure(rail.getBoundingClientRect().width);
    const observer = new ResizeObserver(() => measure(rail.getBoundingClientRect().width));
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const moveFocus = (event: KeyboardEvent<HTMLElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = [...(railRef.current?.querySelectorAll<HTMLButtonElement>("[data-rail-button]") ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current < 0) return; // Leave portalled overflow-menu keys to Radix.
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus();
  };

  return (
    <TooltipProvider delayDuration={300}>
      <nav ref={railRef} aria-label="Sidebar sections" onKeyDown={moveFocus}
        className="flex h-10 shrink-0 items-center justify-around px-1">
        {visible.map((slot) => (
          <Tooltip key={slot.id}>
            <TooltipTrigger asChild>
              <button type="button" data-rail-button aria-label={slot.label}
                aria-pressed={slot.id === parent} onClick={() => onSelectView(slot.id)}
                className={buttonClass(slot.id === parent)}>
                <HugeiconsIcon icon={slot.icon} size={17} strokeWidth={slot.id === parent ? 1.75 : 1.5} />
                {slot.id === "source-control" && changedCount > 0 && (
                  <span className="pointer-events-none absolute -right-0.5 -top-0.5 rounded-full border border-border bg-card px-1 text-[8.5px] leading-3 text-foreground">
                    {changedCount > 99 ? "99+" : changedCount}
                  </span>
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={8}
              className="border border-border bg-popover text-[10.5px] text-popover-foreground shadow-lg">
              {slot.label}
            </TooltipContent>
          </Tooltip>
        ))}
        {hidden.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" data-rail-button
                aria-label={hiddenActive ? "More sections (" + hiddenActive.label + " active)" : "More sections"}
                className={buttonClass(!!hiddenActive)}>
                <HugeiconsIcon icon={MoreHorizontalIcon} size={17} strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="top" align="end" className="border border-border">
              <DropdownMenuRadioGroup value={parent} onValueChange={(id) => onSelectView(id as SidebarViewId)}>
                {hidden.map((slot) => (
                  <DropdownMenuRadioItem key={slot.id} value={slot.id} className="rounded-md px-2 py-1.5 text-[11px]">
                    <HugeiconsIcon icon={slot.icon} size={14} strokeWidth={1.5} />{slot.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </TooltipProvider>
  );
}
