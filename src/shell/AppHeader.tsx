import type * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ClipboardIcon,
  LayoutThreeColumnIcon,
  MessageMultiple02Icon,
  Moon02Icon,
  Settings01Icon,
  SparklesIcon,
  Sun03Icon,
  Timer01Icon,
} from "@hugeicons/core-free-icons";
import { AiSessionsPanel } from "../ai/AiSessionsPanel";
import { useTotpTimer } from "../totp/useTotpTimer";
import { usePrefs, setPrefs } from "../settings/preferences";
import { TabBar } from "./TabBar";
import type { ActiveKind } from "./types";
import type { Prefs } from "../settings/preferences";

function ThemeToggle() {
  const theme = usePrefs().theme;
  const isDark = theme === "dark";
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={() => setPrefs({ theme: isDark ? "light" : "dark" })}
      title={isDark ? "Switch to light theme" : "Switch to dark theme"}
    >
      <HugeiconsIcon icon={isDark ? Sun03Icon : Moon02Icon} size={16} strokeWidth={1.5} />
    </Button>
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

function TotpBadge() {
  const remaining = useTotpTimer();
  if (remaining > 10) return null;
  const color = remaining <= 5 ? "bg-destructive" : "bg-amber-500";
  return (
    <span className={`absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full ${color} ring-1 ring-background`} />
  );
}

export function AppHeader({
  prefs,
  toggleSidebar,
  aiSessionsOpen,
  setAiSessionsOpen,
  aiSessionsButtonRef,
  onSelectAiSession,
  tabBarProps,
  clipboardButtonRef,
  onToggleClipboard,
  onOpenTotp,
  onToggleComposer,
  onOpenSettings,
  activeKind,
}: {
  prefs: Prefs;
  toggleSidebar: () => void;
  aiSessionsOpen: boolean;
  setAiSessionsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  aiSessionsButtonRef: React.RefObject<HTMLDivElement | null>;
  onSelectAiSession: (id: string) => void;
  tabBarProps: React.ComponentProps<typeof TabBar>;
  clipboardButtonRef: React.RefObject<HTMLButtonElement | null>;
  onToggleClipboard: () => void;
  onOpenTotp: () => void;
  onToggleComposer: () => void;
  onOpenSettings: () => void;
  activeKind: ActiveKind;
}) {
  return (
    <header
      data-tauri-drag-region
      className={cn(
        "relative flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 select-none",
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
      {/* Left: sidebar toggle + AI sessions */}
      <div className="flex shrink-0 items-center gap-0.5">
        <Button
          onClick={toggleSidebar}
          title="Toggle sidebar"
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <HugeiconsIcon icon={LayoutThreeColumnIcon} size={16} strokeWidth={1.5} />
        </Button>
        {prefs.aiEnabled && (
          <div className="relative" ref={aiSessionsButtonRef}>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                setAiSessionsOpen((v) => !v);
              }}
              title="AI Sessions"
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0 rounded-md",
                aiSessionsOpen
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={MessageMultiple02Icon} size={15} strokeWidth={1.5} />
            </Button>
            <AiSessionsPanel
              open={aiSessionsOpen}
              onClose={() => setAiSessionsOpen(false)}
              onSelectSession={onSelectAiSession}
              anchorRef={aiSessionsButtonRef}
            />
          </div>
        )}
      </div>

      {!IS_MAC && <span className="mx-1 h-5 w-px shrink-0 bg-border" />}
      {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border" />}

      {/* Center: tabs */}
      <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch" data-tauri-drag-region>
        <TabBar {...tabBarProps} />
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      {/* Right: search + actions */}

      <div className="flex items-center gap-0.5">
        <ThemeToggle />
        <Button
          variant="ghost"
          size="icon"
          className="relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Authenticator (2FA)"
          onClick={onOpenTotp}
        >
          <HugeiconsIcon icon={Timer01Icon} size={14} strokeWidth={1.75} />
          <TotpBadge />
        </Button>
        <button
          ref={clipboardButtonRef}
          type="button"
          aria-label="Clipboard history"
          title="Clipboard history"
          onClick={onToggleClipboard}
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon icon={ClipboardIcon} size={16} strokeWidth={1.5} />
        </button>

        {prefs.aiEnabled && (
          <Button
            variant="ghost"
            size="icon"
            className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Toggle AI composer (Ctrl+Shift+L)"
            onClick={onToggleComposer}
          >
            <HugeiconsIcon icon={SparklesIcon} size={15} strokeWidth={1.5} />
          </Button>
        )}
        <Button
          size="icon"
          className={cn(
            "size-6 shrink-0 rounded-md",
            activeKind === "settings"
              ? "bg-accent text-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
          title="Settings"
          onClick={onOpenSettings}
        >
          <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.5} />
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
