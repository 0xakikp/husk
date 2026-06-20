import { cn } from "@/lib/utils";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  FolderTreeIcon,
  FolderGitTwoIcon,
  DatabaseIcon,
  PlayListIcon,
  PuzzleIcon,
  CommandIcon,
  StarIcon,
} from "@hugeicons/core-free-icons";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type SidebarViewId =
  | "explorer"
  | "source-control"
  | "remotes"
  | "workflows"
  | "tools-hub"
  | "kubernetes"
  | "ci-cd"
  | "terraform"
  | "docker"
  | "sftp"
  | "bookmarks";

const RAIL_TOOLTIP_CLASS =
  "border border-border/60 bg-zinc-950 text-zinc-100 shadow-lg shadow-black/30 dark:bg-zinc-950 dark:text-zinc-100";

type RailSlot =
  | {
      kind: "view";
      id: SidebarViewId;
      label: string;
      icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
      badge?: number;
    }
  | {
      kind: "action";
      id: string;
      label: string;
      icon: Parameters<typeof HugeiconsIcon>[0]["icon"];
      onTrigger: () => void;
      disabled?: boolean;
      active?: boolean;
    };

export function SidebarRail({
  view,
  onSelectView,
  onCommandPalette,
  changedCount = 0,
}: {
  view: SidebarViewId;
  onSelectView: (v: SidebarViewId) => void;
  onCommandPalette: () => void;
  changedCount?: number;
}) {
  const slots: RailSlot[] = [
    { kind: "view", id: "explorer", label: "Files", icon: FolderTreeIcon },
    { kind: "view", id: "source-control", label: "Source Control", icon: FolderGitTwoIcon, badge: changedCount },
    { kind: "view", id: "remotes", label: "Remotes", icon: DatabaseIcon },
    { kind: "view", id: "workflows", label: "Workflows", icon: PlayListIcon },
    { kind: "view", id: "bookmarks", label: "Bookmarks", icon: StarIcon },
    { kind: "view", id: "tools-hub", label: "Integrations", icon: PuzzleIcon },
    { kind: "action", id: "command-palette", label: "Command Palette", icon: CommandIcon, onTrigger: onCommandPalette },
  ];

  return (
    <TooltipProvider delayDuration={300}>
      <div
        style={{ height: 40 }}
        className="flex shrink-0 items-center justify-around bg-background px-1.5"
      >
        {slots.map((slot) => {
          const isActive = slot.kind === "view" && slot.id === view;
          const isAction = slot.kind === "action";
          const isActionActive = isAction && slot.active === true;
          const isDisabled = isAction && slot.disabled === true;
          const showBadge = slot.kind === "view" && !!slot.badge && slot.badge > 0;
          return (
            <Tooltip key={slot.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={slot.label}
                  aria-pressed={isActive || isActionActive || undefined}
                  disabled={isDisabled}
                  onClick={() => {
                    if (slot.kind === "view") onSelectView(slot.id);
                    else slot.onTrigger();
                  }}
                  className={cn(
                    "group relative inline-flex size-8 cursor-pointer items-center justify-center rounded-md outline-none transition-[background-color,color] duration-150",
                    "focus-visible:ring-1 focus-visible:ring-[#11c700]/40 focus-visible:ring-offset-0",
                    "disabled:cursor-not-allowed disabled:opacity-40",
                    isActive
                      ? "bg-[#11c700]/15 text-[#11c700]"
                      : isActionActive
                        ? "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.08]"
                        : isAction
                          ? "bg-transparent text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
                          : "bg-transparent text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground",
                  )}
                >
                  <HugeiconsIcon
                    icon={slot.icon}
                    size={17}
                    strokeWidth={isActive || isActionActive ? 2 : 1.75}
                    color={isActive ? "#11c700" : undefined}
                    className="transition-[stroke-width] duration-150"
                  />
                  {showBadge ? (
                    <span
                      className={cn(
                        "pointer-events-none absolute -right-1 -top-1 inline-flex h-3.5 min-w-3.5 items-center justify-center rounded-full border px-1 text-[8.5px] font-semibold leading-none tabular-nums",
                        "border-border/70 bg-card text-muted-foreground/95 ring-2 ring-card",
                      )}
                    >
                      {slot.badge! > 99 ? "99+" : slot.badge}
                    </span>
                  ) : null}
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="top"
                sideOffset={8}
                className={cn(RAIL_TOOLTIP_CLASS, "text-[10.5px]")}
              >
                {slot.label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
