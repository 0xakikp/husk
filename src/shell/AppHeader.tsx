import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Settings01Icon,
} from "@hugeicons/core-free-icons";
import { TabBar } from "./TabBar";
import type { ActiveKind } from "./types";

/**
 * The one thing on the right: a text affordance for the launcher.
 *
 * Theme, clipboard and the AI composer used to be icons up here. All three are
 * already commands in the launcher ("Toggle light / dark theme", "Open clipboard
 * history", "Toggle AI composer") and the composer has Ctrl+Shift+L, so five
 * icons were competing for attention to duplicate what one keystroke does.
 * Teaching the keystroke is worth more than the icons were.
 */
function SearchHint({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Search files, history, commands and actions"
      className="group hidden h-[18px] shrink-0 items-center gap-1.5 rounded-md border border-border/40 bg-muted/20 pl-2 pr-1 text-[10px] text-muted-foreground/80 transition-colors hover:border-border/70 hover:bg-muted/40 hover:text-foreground sm:inline-flex"
    >
      <span>Search</span>
      <kbd className="rounded border border-border/50 bg-background/50 px-1 font-mono text-[9px] leading-[13px] text-muted-foreground/70 transition-colors group-hover:text-foreground/80">
        {IS_MAC ? "\u2318K" : "Ctrl K"}
      </kbd>
    </button>
  );
}

function WindowControls() {
  const minimize = () => {
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().minimize())
      .catch(() => {});
  };
  const maximize = () => {
    import("@tauri-apps/api/window")
      .then(async (m) => {
        const w = m.getCurrentWindow();
        const maximized = await w.isMaximized();
        if (maximized) w.unmaximize(); else w.maximize();
      })
      .catch(() => {});
  };
  const close = () => {
    import("@tauri-apps/api/window")
      .then((m) => m.getCurrentWindow().close())
      .catch(() => {});
  };

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={minimize}
        className="inline-flex h-6 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Minimize"
      >
        <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor"><rect width="10" height="1" /></svg>
      </button>
      <button
        type="button"
        onClick={maximize}
        className="inline-flex h-6 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Maximize"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1"><rect x="0.5" y="0.5" width="9" height="9" rx="1" /></svg>
      </button>
      <button
        type="button"
        onClick={close}
        className="inline-flex h-6 w-10 items-center justify-center text-muted-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
        aria-label="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M1 1l8 8M9 1L1 9" /></svg>
      </button>
    </div>
  );
}

export function AppHeader({
  tabBarProps,
  onOpenSearch,
  onOpenSettings,
  activeKind,
}: {
  tabBarProps: React.ComponentProps<typeof TabBar>;
  /** Opens the launcher — the right-hand hint and its shortcut. */
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  activeKind: ActiveKind;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        /* h-8, not h-7. At 28px the 24px buttons had 2px of clearance while the
           12px traffic lights had 8px — two vertical rhythms in one strip, which
           is what made the OS controls look oversized beside the toolbar. */
        "relative flex h-8 shrink-0 items-center gap-1.5 border-b border-border/60 select-none",
        /* Always opaque, frosted glass included. This is window chrome — traffic
           lights, tab labels, window controls — so it frames the content rather
           than being content, and a wallpaper showing through it costs legibility
           for no aesthetic gain. Frosted glass still applies to the sidebar and
           workspace panels, which are the surfaces where seeing the wallpaper is
           an actual choice. */
        "bg-background",
        /* 88px, not 72. The traffic lights end at x=66 (centres 20/40/60, 12px
           across), so 72 left only 6px before the first icon button — at 24px
           square they read as colliding with the window controls. 88 gives a 22px
           gap, matching the spacing between the lights themselves. */
        IS_MAC ? "pr-2 pl-[88px]" : "pr-0 pl-2",
      )}
      /* No panel-gap margins here. Gaps separate PANELS; the title bar is the
         window's own edge, and insetting it left a band above and beside the bar
         where nothing is painted — the wallpaper sits at fixed inset-0 / z-index -2
         behind everything, so it showed through as a stray strip along the top of
         the window. Chrome sits flush; gaps still apply to the workspace panels. */
    >
      {/* No action icons on the left any more. Sidebar toggle went to Cmd+B and
          "Toggle sidebar" in the launcher; AI sessions became the Chats scope
          (chat:), which is searchable in a way a dropdown never was. */}
      {/* No divider here. It separated the left icon cluster from the tabs; with
          the cluster gone it sat between the window controls and the first tab,
          dividing nothing and costing the tabs the space. */}

      {/* Center: tabs */}
      <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch" data-tauri-drag-region>
        <TabBar {...tabBarProps} />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      {/* Far right, after the search hint: settings is the one control that is
          not about the current view, so it sits at the window's edge. */}
      <div className="flex shrink-0 items-center gap-1">
        <SearchHint onOpen={onOpenSearch} />
        <Button
          size="icon"
          className={cn(
            "size-5 shrink-0 rounded-md",
            activeKind === "settings"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title="Settings"
          onClick={onOpenSettings}
        >
          <HugeiconsIcon icon={Settings01Icon} size={14} strokeWidth={1.75} />
        </Button>
      </div>

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border" />
          <WindowControls />
        </>
      )}
    </header>
  );
}
