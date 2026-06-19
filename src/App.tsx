import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { TerminalStack } from "./TerminalStack";
import { TerminalBottomBar } from "./terminal/TerminalBottomBar";
import { runInActiveTerminal } from "./ai/terminalContext";
import { setWindowFocused } from "./windowFocus";
import { useTerminalTabs } from "./useTerminalTabs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  LayoutThreeColumnIcon,
  MessageMultiple02Icon,
  SquareLockPasswordIcon,
  Moon02Icon,
  Sun03Icon,
  Settings01Icon,
  PlusSignIcon,
  Cancel01Icon,
  ComputerTerminal02Icon,
  PencilEdit02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { AiFloatingBubble } from "./ai/AiFloatingBubble";
import { openBubble, toggleBubble, requestBubbleSwitch } from "./ai/bubbleStore";
import { getEditorSelection, getEditorFile } from "./ai/editorStore";
import { AiSessionsPanel } from "./ai/AiSessionsPanel";
import { checkForUpdates } from "./updater";
import { setAiQueryListener } from "./ai/terminalInput";
import { FileExplorer } from "./explorer/FileExplorer";
import { EditorArea, type OpenFile } from "./editor/EditorArea";
import { RunbooksDialog } from "./workflows/RunbooksDialog";
import { TotpDialog } from "./totp/TotpDialog";
import { useTotpTimer } from "./totp/useTotpTimer";
import { SettingsPage } from "./settings/SettingsPage";
import { usePrefs, setPrefs, getPrefs } from "./settings/preferences";
import { fontStack } from "./styles/fonts";
import { initKeys } from "./ai/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFileBase64 } from "./fs";
import { ToastContainer, toast } from "./toast";
import { setBridgeHandler } from "./bridge";
import { openSettingsWindow } from "./settingsWindow";
import { WelcomeDialog } from "./welcome/WelcomeDialog";
import { CommandPalette, type Command } from "./command-palette/CommandPalette";
import { SnippetsDropdown } from "./snippets/SnippetsDropdown";
import { ToolsHubDialog } from "./tools-hub/ToolsHubDialog";
import { ToolsHubView } from "./tools-hub/ToolsHubView";
import { JobsDialog } from "./jobs/JobsDialog";
import { DockerView } from "./docker/DockerView";
import { KubernetesView } from "./kubernetes/KubernetesView";
import { TerraformView } from "./terraform/TerraformView";
import { RemotesView } from "./remotes/RemotesView";
import { SftpView } from "./remotes/SftpView";
import { useActiveSshHost } from "./remote/store";
import { GithubIssuesDialog } from "./github-issues/GithubIssuesDialog";
import { CiCdDialog } from "./ci-cd/CiCdDialog";
import { ClipboardDropdown } from "./clipboard/ClipboardDropdown";
import { useClipboardListener } from "./clipboard/useClipboardListener";
import { DiffDialog } from "./diff/DiffDialog";
import { pickWorkspaceFolder } from "./workspace/store";
import { SourceControlPanel } from "./git/SourceControlPanel";
import { GitHistoryDialog } from "./git/GitHistoryDialog";
import { GitGraphPanel } from "./git/GitGraphPanel";
import { IssuesPanel } from "./git/IssuesPanel";
import { ShortcutsDialog } from "./shortcuts/ShortcutsDialog";
import { StatusBar } from "./statusbar/StatusBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { DialogLayer } from "./components/DialogLayer";
import type { OpenPanelKind } from "./git/types";
import { SuggestDialog, ExplainDialog } from "./ai/AssistDialogs";
import { readActiveTerminal, getActiveTerminalExit, subscribeTerminalState, focusActiveTerminal, getActiveTerminalPtyId } from "./ai/terminalContext";
import { invoke } from "@tauri-apps/api/core";
import { PreviewDialog } from "./preview/PreviewDialog";
import { SidebarRail, type SidebarViewId } from "./sidebar/SidebarRail";
import { fileIconUrl } from "./explorer/iconResolver";
import { PathBar } from "./header/PathBar";
import type { TermTab } from "./useTerminalTabs";
import { QuickSwitcher } from "./switcher/QuickSwitcher";
import "./App.css";

/* ── Header helpers ─────────────────────────────────────────────────────── */

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
      <HugeiconsIcon icon={isDark ? Sun03Icon : Moon02Icon} size={16} strokeWidth={1.75} />
    </Button>
  );
}


/* ── TabBar (husk v1 visual style, huskv2 data model) ─────────────────── */

const TAB_COLORS = [
  { name: "red", class: "border-l-red-500", hex: "#ef4444" },
  { name: "blue", class: "border-l-blue-500", hex: "#3b82f6" },
  { name: "green", class: "border-l-emerald-500", hex: "#10b981" },
  { name: "violet", class: "border-l-violet-500", hex: "#8b5cf6" },
  { name: "amber", class: "border-l-amber-500", hex: "#f59e0b" },
  { name: "cyan", class: "border-l-cyan-500", hex: "#06b6d4" },
  { name: "pink", class: "border-l-pink-500", hex: "#ec4899" },
  { name: "slate", class: "border-l-slate-500", hex: "#64748b" },
];

type TabChipProps = {
  active: boolean;
  onClick: () => void;
  onClose?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  animate?: boolean;
  color?: string;
  children: React.ReactNode;
};

function TabChip({ active, onClick, onClose, onContextMenu, onDoubleClick, animate, color, children }: TabChipProps) {
  return (
    <div
      data-active-tab={active ? "true" : undefined}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      className={cn(
        "group relative flex h-6 shrink items-center gap-1.5 rounded-md text-xs transition-colors min-w-0 max-w-[160px] overflow-hidden border-l-2",
        onClose ? "pr-1" : "pr-2",
        active ? "bg-muted text-primary" : "text-muted-foreground hover:text-foreground",
        animate && "animate-tab-slide-in",
        color || "border-l-transparent",
        color,
      )}
    >
      <button type="button" onClick={onClick} className="flex min-w-0 items-center gap-1.5 pl-2">
        {children}
      </button>
      {onClose ? (
        <button
          type="button"
          aria-label="Close tab"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="rounded p-0.5 opacity-0 transition-opacity hover:bg-foreground/10 group-hover:opacity-60 hover:!opacity-100"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

function TabBar({
  termTabs,
  openFiles,
  active,
  onSelectTerm,
  onSelectFile,
  onCloseTerm,
  onCloseFile,
  onNewTerm,
  onRenameTerm,
  onSetTabColor,
  settingsOpen,
  onSelectSettings,
  onCloseSettings,
  animationsEnabled,
}: {
  termTabs: TermTab[];
  openFiles: OpenFile[];
  active: ActiveTab;
  onSelectTerm: (id: number) => void;
  onSelectFile: (path: string) => void;
  onCloseTerm: (id: number) => void;
  onCloseFile: (path: string) => void;
  onNewTerm: () => void;
  onRenameTerm: (id: number, title: string) => void;
  onSetTabColor: (id: number, color: string | undefined) => void;
  settingsOpen: boolean;
  onSelectSettings: () => void;
  onCloseSettings: () => void;
  animationsEnabled?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "term"; id: number } | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const canClose = termTabs.length + openFiles.length > 1;
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<{ left: number; width: number } | null>(null);

  // Update sliding indicator position when active tab changes
  useEffect(() => {
    const bar = tabBarRef.current;
    if (!bar) return;
    const activeTab = bar.querySelector('[data-active-tab="true"]') as HTMLElement | null;
    if (!activeTab) {
      setIndicatorStyle(null);
      return;
    }
    const barRect = bar.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - barRect.left + 8,
      width: tabRect.width - 16,
    });
  }, [active, termTabs, openFiles, settingsOpen]);

  // Horizontal wheel scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const beginRename = (id: number, current: string) => {
    setMenu(null);
    setEditValue(current);
    setEditingId(id);
  };
  const commitRename = () => {
    if (editingId != null && editValue.trim()) onRenameTerm(editingId, editValue.trim());
    setEditingId(null);
  };

  return (
    <div
      ref={scrollRef}
      data-tauri-drag-region
      className="relative min-w-0 shrink overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <div className="flex w-full min-w-0 items-center gap-0.5" ref={tabBarRef}>
        {termTabs.map((t) =>
          editingId === t.id ? (
            <div
              key={`t${t.id}`}
              className="flex h-6 shrink-0 items-center gap-1.5 rounded-md bg-muted px-2 text-xs text-foreground"
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} strokeWidth={2} className="shrink-0" />
              <input
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitRename();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setEditingId(null);
                  }
                }}
                className="w-24 min-w-0 bg-transparent text-foreground outline-none"
              />
            </div>
          ) : (
            <TabChip
              key={`t${t.id}`}
              active={active.kind === "term" && active.id === t.id}
              onClick={() => onSelectTerm(t.id)}
              onClose={canClose ? () => onCloseTerm(t.id) : undefined}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, kind: "term", id: t.id });
              }}
              onDoubleClick={() => beginRename(t.id, t.title)}
              animate={animationsEnabled}
              color={t.color}
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={2} className="shrink-0" />
              <span className="truncate">{t.title}</span>
            </TabChip>
          ),
        )}
        {openFiles.map((f) => (
          <TabChip
            key={`f${f.path}`}
            active={active.kind === "file" && active.path === f.path}
            onClick={() => onSelectFile(f.path)}
            onClose={() => onCloseFile(f.path)}
            animate={animationsEnabled}
          >
            <img src={fileIconUrl(f.name)} className="size-3.5 shrink-0" alt="" />
            <span className="truncate">{f.name}</span>
          </TabChip>
        ))}
        {settingsOpen ? (
          <TabChip
            active={active.kind === "settings"}
            onClick={onSelectSettings}
            onClose={onCloseSettings}
            animate={animationsEnabled}
          >
            <HugeiconsIcon icon={Settings01Icon} size={13} strokeWidth={2} className="shrink-0" />
            <span className="truncate">Settings</span>
          </TabChip>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-none text-muted-foreground hover:bg-muted hover:text-foreground"
          title="New tab"
          onClick={onNewTerm}
        >
          <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
        </Button>

        {/* Sliding active tab indicator */}
        {indicatorStyle && (
          <span
            className="absolute bottom-0.5 h-[2px] rounded-full bg-[var(--accent)] opacity-80 transition-all duration-200 ease-out pointer-events-none"
            style={{ left: indicatorStyle.left, width: indicatorStyle.width }}
          />
        )}

        {/* Context menu for rename/color/close */}
        {menu
          ? createPortal(
              <>
                <div
                  className="fixed inset-0 z-50"
                  onClick={() => setMenu(null)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu(null);
                  }}
                />
                <div
                  className="fixed z-50 min-w-[160px] rounded-md border border-border bg-popover p-1 shadow-md"
                  style={{ top: menu.y, left: menu.x }}
                  role="menu"
                >
                  {menu.kind === "term" ? (
                    <>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                        onClick={() => beginRename(menu.id, termTabs.find((t) => t.id === menu.id)?.title ?? "")}
                      >
                        <HugeiconsIcon icon={PencilEdit02Icon} size={14} strokeWidth={1.75} />
                        <span className="flex-1 text-left">Rename</span>
                      </button>
                      {/* Color picker */}
                      <div className="px-2 py-1.5">
                        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Color</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {TAB_COLORS.map((c) => (
                            <button
                              key={c.name}
                              type="button"
                              onClick={() => {
                                onSetTabColor(menu.id, c.class);
                                setMenu(null);
                              }}
                              className={cn(
                                "size-4 rounded-full ring-1 ring-transparent transition-all hover:scale-110",
                                termTabs.find((t) => t.id === menu.id)?.color === c.class && "ring-white/60 scale-110"
                              )}
                              style={{ backgroundColor: c.hex }}
                              title={c.name}
                            />
                          ))}
                          <button
                            type="button"
                            onClick={() => {
                              onSetTabColor(menu.id, undefined);
                              setMenu(null);
                            }}
                            className="flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-muted/80"
                            title="Clear"
                          >
                            <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2">
                              <path d="M1 1l6 6M7 1L1 7" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {canClose ? (
                    <button
                      type="button"
                      role="menuitem"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-destructive hover:bg-accent"
                      onClick={() => {
                        if (menu.kind === "term") onCloseTerm(menu.id);
                        setMenu(null);
                      }}
                    >
                      <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={1.75} />
                      <span className="flex-1 text-left">Close</span>
                    </button>
                  ) : null}
                </div>
              </>,
              document.body,
            )
          : null}
      </div>
    </div>
  );
}

/* ── Search inline (husk v1 compact style) ────────────────────────────── */

function SearchInline() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const expanded = open;

  useEffect(() => {
    if (expanded && inputRef.current) inputRef.current.focus();
  }, [expanded]);

  // Wire typed query directly into the active terminal's scrollback search.
  useEffect(() => {
    if (!expanded || !q) return;
    import("./ai/terminalContext").then((m) => {
      m.searchActiveTerminal(q);
    });
  }, [q, expanded]);

  return (
    <div className={cn("relative h-6 shrink-0", expanded ? "w-48" : "w-6")}>
      {expanded ? (
        <div className="absolute inset-0 flex items-center">
          <HugeiconsIcon
            icon={Search01Icon}
            size={12}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2 text-muted-foreground"
          />
          <input
            ref={inputRef}
            value={q}
            placeholder="Search terminal…"
            className="h-6 w-full rounded-md border-0 bg-muted/80 py-0 pr-7 pl-7 text-[13px] text-foreground placeholder:text-muted-foreground/70 outline-none focus-visible:ring-1 focus-visible:ring-ring"
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => {
              if (!q) setOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQ("");
                setOpen(false);
              } else if (e.key === "Enter") {
                import("./ai/terminalContext").then((m) => {
                  m.searchActiveTerminal(q);
                });
              }
            }}
          />
          {q && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                inputRef.current?.focus();
              }}
              className="absolute right-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              aria-label="Clear search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} strokeWidth={2} />
            </button>
          )}
        </div>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Search terminal scrollback"
          onClick={() => setOpen(true)}
        >
          <HugeiconsIcon icon={Search01Icon} size={14} strokeWidth={1.75} />
        </Button>
      )}
    </div>
  );
}

/* ── Window controls (non-macOS) ──────────────────────────────────────── */

function WindowControls() {
  const minimize = () => {
    import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().minimize());
  };
  const maximize = () => {
    import("@tauri-apps/api/window").then(async (m) => {
      const w = m.getCurrentWindow();
      const maximized = await w.isMaximized();
      if (maximized) w.unmaximize(); else w.maximize();
    });
  };
  const close = () => {
    import("@tauri-apps/api/window").then((m) => m.getCurrentWindow().close());
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

/* ── Main App ─────────────────────────────────────────────────────────── */

export type ActiveTab =
  | { kind: "term"; id: number }
  | { kind: "file"; path: string }
  | { kind: "settings" }
  | { kind: "git-graph" }
  | { kind: "issues" };

export type { OpenPanelKind } from "./git/types";

const SIDEBAR_DEFAULT_WIDTH = 220;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = "husk.sidebar.width";
const SIDEBAR_VIEW_STORAGE_KEY = "husk.sidebar.view";

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
}

function readSidebarWidth(): number {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    const parsed = stored ? Number.parseInt(stored, 10) : NaN;
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : SIDEBAR_DEFAULT_WIDTH;
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function readSidebarView(): SidebarViewId {
  try {
    const stored = window.localStorage.getItem(SIDEBAR_VIEW_STORAGE_KEY);
    const valid: SidebarViewId[] = [
      "explorer", "source-control", "remotes", "sftp", "workflows", "tools-hub",
      "kubernetes", "ci-cd", "terraform", "docker",
    ];
    if (stored && valid.includes(stored as SidebarViewId)) return stored as SidebarViewId;
  } catch (e) { console.error("Failed to read sidebar view", e); }
  return "explorer";
}

function App() {
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerWidth, setExplorerWidth] = useState(readSidebarWidth);
  const sidebarWidthWriteTimerRef = useRef(0);
  const [sidebarView, setSidebarView] = useState<SidebarViewId>(readSidebarView);


  // Track window focus for long-running command notifications
  useEffect(() => {
    let unsubFocus: (() => void) | undefined;
    let unsubBlur: (() => void) | undefined;
    const setup = async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      unsubFocus = await win.listen("tauri://focus", () => setWindowFocused(true));
      unsubBlur = await win.listen("tauri://blur", () => setWindowFocused(false));
    };
    setup();
    return () => {
      unsubFocus?.();
      unsubBlur?.();
    };
  }, []);

  const persistSidebarView = useCallback((view: SidebarViewId) => {
    setSidebarView(view);
    try {
      window.localStorage.setItem(SIDEBAR_VIEW_STORAGE_KEY, view);
    } catch (e) { console.error("Failed to save sidebar view", e); }
  }, []);

  const toggleSidebar = useCallback(() => {
    setExplorerOpen((v) => !v);
  }, []);

  const cycleSidebarView = useCallback(
    (view: SidebarViewId) => {
      const collapsed = !explorerOpen;
      if (collapsed) {
        setExplorerOpen(true);
        if (view !== sidebarView) persistSidebarView(view);
        return;
      }
      if (view === sidebarView) {
        setExplorerOpen(false);
        return;
      }
      persistSidebarView(view);
    },
    [persistSidebarView, sidebarView, explorerOpen],
  );

  const persistSidebarWidth = useCallback((next: number) => {
    if (sidebarWidthWriteTimerRef.current) window.clearTimeout(sidebarWidthWriteTimerRef.current);
    sidebarWidthWriteTimerRef.current = window.setTimeout(() => {
      sidebarWidthWriteTimerRef.current = 0;
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next));
      } catch (e) { console.error("Failed to save sidebar width", e); }
    }, 200);
  }, []);

  useEffect(() => {
    return () => {
      if (sidebarWidthWriteTimerRef.current) window.clearTimeout(sidebarWidthWriteTimerRef.current);
    };
  }, []);

  /* ── Dialog state (unchanged from huskv2) ── */
  const [totpOpen, setTotpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [aiSessionsOpen, setAiSessionsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [explainCtx, setExplainCtx] = useState<{ command: string; output: string; exitCode: number | null } | null>(null);
  const [pendingAiQuery, setPendingAiQuery] = useState<string | undefined>(undefined);
  const explainLastError = () => setExplainCtx({ command: "", output: readActiveTerminal(), exitCode: getActiveTerminalExit() });
  const [dockerOpen, setDockerOpen] = useState(false);
  const [k8sOpen, setK8sOpen] = useState(false);
  const [terraformOpen, setTerraformOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [cicdOpen, setCicdOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffPaths, setDiffPaths] = useState<{ left: string; right: string } | null>(null);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | undefined>(undefined);
  const [openPanel, setOpenPanel] = useState<OpenPanelKind>(null);

  const prefs = usePrefs();
  useClipboardListener();

  /* ── TOTP toolbar countdown badge ── */
  function TotpBadge() {
    const remaining = useTotpTimer();
    if (remaining > 10) return null;
    const color = remaining <= 5 ? "bg-destructive" : "bg-amber-500";
    return (
      <span className={`absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full ${color} ring-1 ring-background`} />
    );
  }

  // ── Background image (base64 via Rust) ──────────────────────
  const [bgDataUrl, setBgDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!prefs.background.enabled || !prefs.background.path) {
      setBgDataUrl(null);
      return;
    }
    let cancelled = false;
    readFileBase64(prefs.background.path)
      .then((url) => {
        if (!cancelled) setBgDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setBgDataUrl(null);
      });
    return () => { cancelled = true; };
  }, [prefs.background.enabled, prefs.background.path]);


  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-mono", fontStack(prefs.fontFamily));
  }, [prefs.fontFamily]);

  // Apply custom CSS from preferences reactively
  useEffect(() => {
    const existing = document.getElementById("husk-custom-css");
    if (!prefs.customCSS) {
      existing?.remove();
      return;
    }
    if (existing && existing.textContent === prefs.customCSS) return;
    const style = existing ?? document.createElement("style");
    style.id = "husk-custom-css";
    style.textContent = prefs.customCSS;
    if (!existing) document.head.appendChild(style);
  }, [prefs.customCSS]);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", prefs.accentColor);
    const r = parseInt(prefs.accentColor.slice(1, 3), 16);
    const g = parseInt(prefs.accentColor.slice(3, 5), 16);
    const b = parseInt(prefs.accentColor.slice(5, 7), 16);
    document.documentElement.style.setProperty("--accent-rgb", `${r} ${g} ${b}`);
  }, [prefs.accentColor]);

  useEffect(() => {
    document.documentElement.style.setProperty("--panel-gaps", `${prefs.panelGaps}px`);
    document.documentElement.style.setProperty("--panel-shadow", prefs.panelShadows ? "0 4px 12px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.2)" : "none");
    document.documentElement.style.setProperty("--active-gap-glow", prefs.activePanelGlow ? "color-mix(in srgb, var(--accent) 20%, transparent)" : "transparent");
  }, [prefs.panelGaps, prefs.panelShadows, prefs.activePanelGlow]);

  useEffect(() => {
    void initKeys();
  }, []);

  // Auto-check for updates on app start (non-blocking)
  useEffect(() => {
    void checkForUpdates(false);
  }, []);

  useEffect(() => {
    setBridgeHandler((cmd) => {
      switch (cmd.kind) {
        case "open":
          openFile(cmd.path, cmd.path.split("/").pop() || cmd.path);
          break;
        case "preview":
          setPreviewPath(cmd.path);
          setPreviewOpen(true);
          break;
        case "notify":
          toast({ title: cmd.message, variant: "info" });
          break;
        case "diff":
          setDiffPaths({ left: cmd.left, right: cmd.right });
          setDiffOpen(true);
          break;
        case "cp": {
          const ptyId = getActiveTerminalPtyId();
          if (!ptyId) {
            toast({ title: "No active terminal", variant: "error" });
            return;
          }
          if (cmd.direction === "pull") {
            // Remote → Local: cat file | base64, capture output, decode, write locally
            const remotePath = cmd.source;
            const localPath = cmd.dest;
            const fileName = remotePath.split("/").pop() || "file";
            toast({ title: `Downloading ${fileName}...`, variant: "info" });
            void (async () => {
              try {
                // Use base64 with 0 wrapping to avoid line breaks in the capture
                const captureCmd = `cat "${remotePath}" | base64 | tr -d '\\n'`;
                const output = await invoke("pty_capture", { id: ptyId, command: captureCmd, timeoutMs: 30000 });
                // Extract base64 from the output (strip shell prompts, etc.)
                const lines = (output as string).split("\n");
                // Find the line that looks like base64 (long alphanumeric string)
                let b64 = "";
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (trimmed.length > 40 && /^[A-Za-z0-9+/=]+$/.test(trimmed)) {
                    b64 = trimmed;
                    break;
                  }
                }
                if (!b64) {
                  toast({ title: "Failed to capture file content", variant: "error" });
                  return;
                }
                // Decode base64 to bytes
                const binary = atob(b64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) {
                  bytes[i] = binary.charCodeAt(i);
                }
                // Write to local file via Tauri fs
                await invoke("write_binary_file", { path: localPath, data: Array.from(bytes) });
                toast({ title: `Downloaded ${fileName}`, message: `Saved to ${localPath}`, variant: "success" });
              } catch (e) {
                toast({ title: `Download failed: ${String(e)}`, variant: "error" });
              }
            })();
          } else {
            // Local → Remote: read local file, base64 encode, inject via echo + base64 -d
            const localPath = cmd.source;
            const remotePath = cmd.dest;
            const fileName = localPath.split("/").pop() || "file";
            toast({ title: `Uploading ${fileName}...`, variant: "info" });
            void (async () => {
              try {
                // Read local file as base64
                const b64 = await invoke("read_file_base64", { path: localPath }) as string;
                // Split into chunks to avoid command line length limits
                const chunkSize = 8000;
                const chunks: string[] = [];
                for (let i = 0; i < b64.length; i += chunkSize) {
                  chunks.push(b64.slice(i, i + chunkSize));
                }
                // Write chunks to a temp file on remote, then decode
                const remoteTmp = `/tmp/.husk-upload-${fileName}`;
                // Clear temp file
                await invoke("pty_capture", { id: ptyId, command: `rm -f "${remoteTmp}"`, timeoutMs: 5000 });
                // Append chunks
                for (const chunk of chunks) {
                  const echoCmd = `echo -n "${chunk}" >> "${remoteTmp}"`;
                  await invoke("pty_capture", { id: ptyId, command: echoCmd, timeoutMs: 5000 });
                }
                // Decode base64 to final destination
                const decodeCmd = `base64 -d "${remoteTmp}" > "${remotePath}" && rm -f "${remoteTmp}"`;
                await invoke("pty_capture", { id: ptyId, command: decodeCmd, timeoutMs: 10000 });
                toast({ title: `Uploaded ${fileName}`, message: `To ${remotePath}`, variant: "success" });
              } catch (e) {
                toast({ title: `Upload failed: ${String(e)}`, variant: "error" });
              }
            })();
          }
          break;
        }
      }
    });
    return () => setBridgeHandler(null);
  }, []);

  useEffect(() => {
    setAiQueryListener((query) => {
      setPendingAiQuery(query);
    });
    return () => setAiQueryListener(null);
  }, []);

  useEffect(() => {
    getCurrentWebview().setZoom(prefs.zoomLevel).catch(() => {});
  }, [prefs.zoomLevel]);

  // Auto-trigger AI error assistance toast when a command fails.
  // Only toasts when the exit code transitions to a new non-zero value
  // (avoids re-toasting when cwd changes while exit stays non-zero).
  useEffect(() => {
    if (!prefs.aiEnabled || !prefs.terminalAiErrorAssist) return;
    let lastSeenExit: number | null = null;
    const unsub = subscribeTerminalState(() => {
      const exit = getActiveTerminalExit();
      if (exit === null || exit === 0) {
        lastSeenExit = exit;
        return;
      }
      if (exit === lastSeenExit) return; // same error, don't re-toast
      lastSeenExit = exit;
      const output = readActiveTerminal();
      toast({
        title: `Command failed (exit ${exit})`,
        message: "Get an AI explanation of what went wrong.",
        variant: "error",
        duration: 8000,
        action: {
          label: "Explain",
          onClick: () => {
            setExplainCtx({ command: "", output, exitCode: exit });
          },
        },
      });
    });
    return unsub;
  }, [prefs.aiEnabled, prefs.terminalAiErrorAssist]);

  useEffect(() => {
    const clamp = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        setPrefs({ zoomLevel: clamp(getPrefs().zoomLevel + 0.1) });
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setPrefs({ zoomLevel: clamp(getPrefs().zoomLevel - 0.1) });
      } else if (e.key === "0") {
        e.preventDefault();
        setPrefs({ zoomLevel: 1 });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        if (!prefs.aiEnabled) return;
        e.preventDefault();
        toggleBubble();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSwitcherOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setActiveKind("term");
        focusActiveTerminal();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prefs.aiEnabled]);

  const remoteHost = useActiveSshHost();
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const term = useTerminalTabs();
  const [activeKind, setActiveKind] = useState<"term" | "file" | "settings" | "git-graph" | "issues" | "sftp">("term");

  const commands: Command[] = useMemo(
    () => [
      { id: "explorer", label: "Toggle file explorer", run: () => toggleSidebar() },
      { id: "open-folder", label: "Open folder…", run: () => void pickWorkspaceFolder() },
      { id: "settings", label: "Open settings", run: () => setSettingsOpen(true) },
      { id: "settings-window", label: "Open settings (new window)", run: () => void openSettingsWindow() },
      { id: "runbooks", label: "Open workflows", run: () => { cycleSidebarView("workflows"); } },
      { id: "totp", label: "Open authenticator (2FA)", run: () => setTotpOpen(true) },
      { id: "tools", label: "Open integrations", run: () => { cycleSidebarView("tools-hub"); } },
      { id: "cli-tools", label: "Install CLI tools", run: () => setToolsOpen(true) },
      { id: "jobs", label: "Open background jobs", run: () => setJobsOpen(true) },
      ...(prefs.aiEnabled
        ? [
            { id: "suggest", label: "Suggest command (AI)", run: () => setSuggestOpen(true) },
            { id: "explain", label: "Explain last error (AI)", run: explainLastError },
            { id: "ai-bubble", label: "Toggle AI chat", hint: "Ctrl/Cmd+Shift+A", run: () => toggleBubble() },
            { id: "ai-explain-code", label: "AI: Explain selected code", run: () => {
              const sel = getEditorSelection();
              const file = getEditorFile();
              if (!sel) {
                toast({ title: "No code selected", variant: "error", duration: 2000 });
                return;
              }
              openBubble(`Explain this code from ${file ?? "current file"} (lines ${sel.startLine}-${sel.endLine}):\n\n\`\`\`\n${sel.text}\n\`\`\``);
            }},
            { id: "ai-generate-test", label: "AI: Generate tests", run: () => {
              const file = getEditorFile();
              if (!file) {
                toast({ title: "No file open", variant: "error", duration: 2000 });
                return;
              }
              openBubble(`Generate unit tests for ${file}. Include edge cases and error handling.`);
            }},
            { id: "ai-refactor", label: "AI: Refactor code", run: () => {
              const sel = getEditorSelection();
              const file = getEditorFile();
              if (!sel) {
                toast({ title: "No code selected", variant: "error", duration: 2000 });
                return;
              }
              openBubble(`Refactor this code from ${file ?? "current file"} (lines ${sel.startLine}-${sel.endLine}):\n\n\`\`\`\n${sel.text}\n\`\`\`\n\nMake it cleaner, more idiomatic, and better documented.`);
            }},
            { id: "ai-fix-error", label: "AI: Fix error / bug", run: () => {
              const sel = getEditorSelection();
              const file = getEditorFile();
              openBubble(`Find and fix the bug in ${file ?? "current file"}${sel ? ` (lines ${sel.startLine}-${sel.endLine})` : ""}.\n${sel ? `\n\`\`\`\n${sel.text}\n\`\`\`` : ""}`);
            }},
            { id: "ai-accept-edits", label: "AI: Accept all pending edits", run: () => {
              import("./ai/pendingEdits").then(({ getPendingEdits, removePendingEdit }) => {
                const edits = getPendingEdits();
                if (edits.length === 0) {
                  toast({ title: "No pending edits", variant: "error", duration: 2000 });
                  return;
                }
                edits.forEach((e) => removePendingEdit(e.id));
                toast({ title: `Accepted ${edits.length} edit${edits.length > 1 ? "s" : ""}`, variant: "success", duration: 2000 });
              });
            }},
            { id: "ai-reject-edits", label: "AI: Reject all pending edits", run: () => {
              import("./ai/pendingEdits").then(({ getPendingEdits, removePendingEdit }) => {
                const edits = getPendingEdits();
                if (edits.length === 0) {
                  toast({ title: "No pending edits", variant: "error", duration: 2000 });
                  return;
                }
                edits.forEach((e) => removePendingEdit(e.id));
                toast({ title: `Rejected ${edits.length} edit${edits.length > 1 ? "s" : ""}`, variant: "success", duration: 2000 });
              });
            }},
            { id: "ai-clear-edits", label: "AI: Clear pending edits", run: () => {
              import("./ai/pendingEdits").then(({ clearPendingEdits, getPendingEdits }) => {
                const count = getPendingEdits().length;
                if (count === 0) {
                  toast({ title: "No pending edits", variant: "error", duration: 2000 });
                  return;
                }
                clearPendingEdits();
                toast({ title: `Cleared ${count} edit${count > 1 ? "s" : ""}`, variant: "success", duration: 2000 });
              });
            }},
            { id: "ai-rebuild-index", label: "AI: Rebuild codebase index", run: () => {
              import("./ai/codebaseSearch").then(({ buildCodebaseIndex }) => {
                import("./workspace/store").then(({ getWorkspaceRoot }) => {
                  const root = getWorkspaceRoot() || "/Users/akikp";
                  buildCodebaseIndex(root).then(() => {
                    toast({ title: "Codebase index rebuilt", variant: "success", duration: 2000 });
                  }).catch((e: Error) => {
                    toast({ title: `Index failed: ${e.message}`, variant: "error", duration: 3000 });
                  });
                });
              });
            }},
          ]
        : []),
      { id: "docker", label: "Open Docker", run: () => setDockerOpen(true) },
      { id: "k8s", label: "Open Kubernetes", run: () => setK8sOpen(true) },
      { id: "terraform", label: "Open Terraform", run: () => setTerraformOpen(true) },
      { id: "remotes", label: "Open Remotes / SSH", run: () => { cycleSidebarView("remotes"); } },
      { id: "github", label: "Open GitHub", run: () => setGithubOpen(true) },
      { id: "cicd", label: "Open CI / CD", run: () => setCicdOpen(true) },
      { id: "diff", label: "Open diff viewer", run: () => { setDiffPaths(null); setDiffOpen(true); } },
      { id: "source-control", label: "Open source control", run: () => { cycleSidebarView("source-control"); } },
      { id: "git-history", label: "Open git history", run: () => setGitHistoryOpen(true) },
      { id: "shortcuts", label: "Keyboard shortcuts", run: () => setShortcutsOpen(true) },
      { id: "check-updates", label: "Check for updates", run: () => void checkForUpdates(true) },
      { id: "preview", label: "Open preview", run: () => { setPreviewPath(undefined); setPreviewOpen(true); } },
      {
        id: "theme",
        label: "Toggle light / dark theme",
        run: () => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" }),
      },
      // Terminal tab commands
      { id: "new-tab", label: "New terminal tab", hint: "Ctrl/Cmd+T", run: () => { term.addTab(); setActiveKind("term"); } },
      { id: "close-tab", label: "Close terminal tab", hint: "Ctrl/Cmd+Shift+W", run: () => term.closeTab(term.activeId) },
      { id: "next-tab", label: "Next terminal tab", hint: "Ctrl/Cmd+Tab", run: () => { const i = term.tabs.findIndex((t) => t.id === term.activeId); const n = term.tabs[(i + 1) % term.tabs.length]; if (n) { term.setActiveId(n.id); setActiveKind(n.sftpOpen ? "sftp" : "term"); } } },
      { id: "prev-tab", label: "Previous terminal tab", hint: "Ctrl/Cmd+Shift+Tab", run: () => { const i = term.tabs.findIndex((t) => t.id === term.activeId); const p = term.tabs[(i - 1 + term.tabs.length) % term.tabs.length]; if (p) { term.setActiveId(p.id); setActiveKind(p.sftpOpen ? "sftp" : "term"); } } },
    ],
    [prefs.aiEnabled, prefs.theme, term],
  );

  // ── Terminal tab universal shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
      const isTerminalFocused = target.closest(".xterm") !== null;
      // Allow terminal shortcuts even when xterm's textarea is focused;
      // skip only for genuine form inputs outside the terminal.
      if (isEditing && !isTerminalFocused) return;

      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        term.addTab();
        setActiveKind("term");
      } else if (key === "w" && e.shiftKey) {
        // Ctrl+Shift+W → close tab (Ctrl+W passes through to shell for word delete)
        if (activeKind === "term" || activeKind === "git-graph" || activeKind === "issues" || activeKind === "sftp") {
          e.preventDefault();
          term.closeTab(term.activeId);
        }
      } else if (key === "tab" && !e.shiftKey) {
        e.preventDefault();
        const current = term.tabs.findIndex((t) => t.id === term.activeId);
        const next = term.tabs[(current + 1) % term.tabs.length];
        if (next) {
          term.setActiveId(next.id);
          setActiveKind(next.sftpOpen ? "sftp" : "term");
        }
      } else if (key === "tab" && e.shiftKey) {
        e.preventDefault();
        const current = term.tabs.findIndex((t) => t.id === term.activeId);
        const prev = term.tabs[(current - 1 + term.tabs.length) % term.tabs.length];
        if (prev) {
          term.setActiveId(prev.id);
          setActiveKind(prev.sftpOpen ? "sftp" : "term");
        }
      } else if (key === "a" && e.shiftKey) {
        e.preventDefault();
        openBubble();
      } else if (/^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const idx = parseInt(e.code.replace("Digit", ""), 10) - 1;
        const allTabs = [
          ...term.tabs.map((t) => ({ kind: "term" as const, id: t.id })),
          ...openFiles.map((f) => ({ kind: "file" as const, path: f.path })),
        ];
        const target = allTabs[idx];
        if (target) {
          if (target.kind === "term") {
            term.setActiveId(target.id);
            const tab = term.tabs.find((t) => t.id === target.id);
            setActiveKind(tab?.sftpOpen ? "sftp" : "term");
          } else {
            setActiveFile(target.path);
            setActiveKind("file");
          }
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [term, activeKind, openFiles]);

  const openSettings = () => {
    setSettingsOpen(true);
    setActiveKind("settings");
  };
  const closeSettings = () => {
    setSettingsOpen(false);
    setActiveKind((k) => (k === "settings" ? "term" : k));
  };
  const openGitGraph = () => {
    setActiveKind("git-graph");
    setOpenPanel("git-graph");
  };
  const closeGitGraph = () => {
    setOpenPanel(null);
    setActiveKind((k) => (k === "git-graph" ? "term" : k));
  };
  const openIssues = () => {
    setActiveKind("issues");
    setOpenPanel("issues");
  };
  const closeIssues = () => {
    setOpenPanel(null);
    setActiveKind((k) => (k === "issues" ? "term" : k));
  };
  const selectTerm = (id: number) => {
    term.setActiveId(id);
    // Restore SFTP view if this tab has it open
    const tab = term.tabs.find((t) => t.id === id);
    console.log("[selectTerm] tab.id=", id, "sftpOpen=", tab?.sftpOpen, "setting activeKind to", tab?.sftpOpen ? "sftp" : "term");
    setActiveKind(tab?.sftpOpen ? "sftp" : "term");
  };

  const openSftp = useCallback((host: string) => {
    term.updateTab(term.activeId, (t) => ({ ...t, sftpHost: host, sftpOpen: true }));
    setActiveKind("sftp");
  }, [term]);

  const closeSftp = useCallback(() => {
    term.updateTab(term.activeId, (t) => ({ ...t, sftpOpen: false }));
    setActiveKind((k) => (k === "sftp" ? "term" : k));
  }, [term]);

  const openFile = useCallback((path: string, name: string) => {
    setOpenFiles((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, { path, name, remoteHost }]));
    setActiveFile(path);
    setActiveKind("file");
  }, [remoteHost]);

  const selectFile = (path: string) => {
    setActiveFile(path);
    setActiveKind("file");
  };

  const closeFile = (path: string) => {
    const idx = openFiles.findIndex((f) => f.path === path);
    const next = openFiles.filter((f) => f.path !== path);
    setOpenFiles(next);
    if (activeFile === path) {
      if (next.length) {
        setActiveFile(next[Math.max(0, idx - 1)].path);
      } else {
        setActiveFile(null);
        setActiveKind("term");
      }
    }
  };

  const active: ActiveTab =
    activeKind === "settings"
      ? { kind: "settings" }
      : activeKind === "file" && activeFile
        ? { kind: "file", path: activeFile }
        : { kind: "term", id: term.activeId };

  return (
    <TooltipProvider>
      <div className="relative flex h-screen flex-col overflow-hidden text-foreground">
        {/* ── Background image (dark mode only) ─────────────────── */}
        {prefs.theme === "dark" && bgDataUrl && (
          <>
            <img
              src={bgDataUrl}
              alt=""
              className="pointer-events-none fixed inset-0 size-full object-cover"
              style={{
                zIndex: -2,
                opacity: prefs.background.opacity / 100,
                filter: `blur(${prefs.background.blur}px)`,
              }}
            />
            <div
              className="pointer-events-none fixed inset-0"
              style={{
                zIndex: -1,
                backgroundColor: `rgba(0,0,0,${prefs.background.dim / 100})`,
              }}
            />
          </>
        )}

        {/* ── Header ─────────────────────────────────────────────── */}
        <header
          data-tauri-drag-region
          className={cn(
            "relative flex h-7 shrink-0 items-center gap-1.5 border-b border-border/60 select-none",
            prefs.frostedGlass && bgDataUrl
              ? "bg-background/60 backdrop-blur-md"
              : "bg-background/92",
            IS_MAC ? "pr-2 pl-[72px]" : "pr-0 pl-2",
          )}
          style={{
            marginLeft: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            marginTop: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            borderTopLeftRadius: prefs.panelGaps > 0 ? "0.375rem" : undefined,
            borderTopRightRadius: prefs.panelGaps > 0 ? "0.375rem" : undefined,
          }}
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
              <HugeiconsIcon icon={LayoutThreeColumnIcon} size={16} strokeWidth={1.75} />
            </Button>
            {prefs.aiEnabled && (
              <div className="relative">
                <Button
                  onClick={() => setAiSessionsOpen((v) => !v)}
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
                  <HugeiconsIcon icon={MessageMultiple02Icon} size={15} strokeWidth={1.75} />
                </Button>
                <AiSessionsPanel
                  open={aiSessionsOpen}
                  onClose={() => setAiSessionsOpen(false)}
                  onSelectSession={(id) => requestBubbleSwitch(id)}
                />
              </div>
            )}
          </div>

          {!IS_MAC && <span className="mx-1 h-5 w-px shrink-0 bg-border" />}
          {IS_MAC && <span className="mr-1 h-full w-px shrink-0 bg-border" />}

          {/* Center: tabs */}
          <div className="flex min-w-0 flex-1 items-center gap-2 self-stretch" data-tauri-drag-region>
            <TabBar
              termTabs={term.tabs}
              openFiles={openFiles}
              active={active}
              onSelectTerm={selectTerm}
              onSelectFile={selectFile}
              onCloseTerm={term.closeTab}
              onCloseFile={closeFile}
              onNewTerm={term.addTab}
              onRenameTerm={term.renameTab}
              onSetTabColor={term.setTabColor}
              settingsOpen={settingsOpen}
              onSelectSettings={() => setActiveKind("settings")}
              onCloseSettings={closeSettings}
              animationsEnabled={prefs.animationsEnabled}
            />
            <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
          </div>

          {/* Right: search + actions */}
          <SearchInline />

          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            className="relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Authenticator (2FA)"
            onClick={() => setTotpOpen(true)}
          >
            <HugeiconsIcon icon={SquareLockPasswordIcon} size={14} strokeWidth={1.75} />
            <TotpBadge />
          </Button>
          <ClipboardDropdown />
          <SnippetsDropdown />
          {prefs.aiEnabled && (
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
              title="Toggle AI chat (Ctrl+Shift+L)"
              onClick={() => toggleBubble()}
            >
              <HugeiconsIcon icon={SparklesIcon} size={15} strokeWidth={1.75} />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "size-6 shrink-0 rounded-md",
              activeKind === "settings"
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            title="Settings"
            onClick={openSettings}
          >
            <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
          </Button>

          {USE_CUSTOM_WINDOW_CONTROLS && (
            <>
              <span className="ml-1 h-5 w-px shrink-0 bg-border" />
              <WindowControls />
            </>
          )}
        </header>

        {/* ── Path bar (cwd / breadcrumb) ────────────────────────── */}
        <div
          className="bg-background/85"
          style={{
            marginLeft: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
          }}
        >
          <PathBar activeFile={activeKind === "file" ? activeFile : undefined} />
        </div>

        {/* ── Main workspace (manual layout, husk v1 visual) ─────── */}
        <main
          className={cn(
            "zoom-content flex min-h-0 flex-1 overflow-hidden",
            prefs.panelGaps > 0 && prefs.panelGapStyle !== "none" && activeKind === "file" && `gap-pattern-${prefs.panelGapStyle}`,
          )}
          style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
        >
          {/* Sidebar */}
          {explorerOpen && (
            <>
              <div
                className={cn(
                  "flex flex-col border-r border-[var(--border)] overflow-hidden rounded-lg",
                  prefs.frostedGlass && bgDataUrl
                    ? "bg-background/50 backdrop-blur-md"
                    : "bg-background/95",
                  prefs.animationsEnabled && "animate-sidebar-enter",
                  prefs.neonBorderGlow && "neon-glow",
                  prefs.panelShadows && "panel-shadow",
                )}
                style={{
                  width: explorerWidth,
                  minWidth: SIDEBAR_MIN_WIDTH,
                  maxWidth: SIDEBAR_MAX_WIDTH,
                  margin: prefs.panelGaps > 0 ? `var(--panel-gaps) 0 var(--panel-gaps) var(--panel-gaps)` : undefined,
                }}
              >
                <div className="min-h-0 flex-1 overflow-hidden">
                  {sidebarView === "explorer" ? (
                    <div className="h-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      <FileExplorer onOpenFile={openFile} activeFile={activeFile} remoteHost={remoteHost} />
                    </div>
                  ) : sidebarView === "source-control" ? (
                    <SourceControlPanel inline onOpenGitGraph={openGitGraph} onOpenIssues={openIssues} />
                  ) : sidebarView === "remotes" ? (
                    <RemotesView
                      inline
                      onSftp={(h) => openSftp(h)}
                    />
                  ) : sidebarView === "workflows" ? (
                    <RunbooksDialog inline />
                  ) : sidebarView === "tools-hub" ? (
                    <ToolsHubView onSelectView={(v) => persistSidebarView(v)} />
                  ) : sidebarView === "kubernetes" ? (
                    <KubernetesView inline />
                  ) : sidebarView === "ci-cd" ? (
                    <CiCdDialog inline />
                  ) : sidebarView === "terraform" ? (
                    <TerraformView inline />
                  ) : sidebarView === "docker" ? (
                    <DockerView inline />
                  ) : null}
                </div>
                <SidebarRail
                  view={sidebarView}
                  onSelectView={(v) => cycleSidebarView(v)}
                  onCommandPalette={() => setPaletteOpen(true)}
                />
              </div>
              {/* Sidebar resize handle */}
              <div
                className={cn(
                  "relative flex shrink-0 cursor-col-resize items-center justify-center bg-border/60 hover:bg-border",
                  prefs.panelGaps > 0 ? "w-2" : "w-px",
                )}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const startX = e.clientX;
                  const startW = explorerWidth;
                  let final = startW;
                  const onMove = (ev: globalThis.MouseEvent) => {
                    final = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, startW + (ev.clientX - startX)));
                    setExplorerWidth(final);
                  };
                  const onUp = () => {
                    window.removeEventListener("mousemove", onMove);
                    window.removeEventListener("mouseup", onUp);
                    persistSidebarWidth(final);
                  };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
              />
            </>
          )}

          {/* Workspace */}
          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg",
              prefs.panelShadows && "panel-shadow",
              prefs.activePanelGlow && activeKind === "term" && "active-panel-glow active",
            )}
            style={{
              margin: prefs.panelGaps > 0
                ? `var(--panel-gaps) var(--panel-gaps) var(--panel-gaps) 0`
                : undefined,
            }}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1">
              {/* Terminal layer */}
              <div
                className={cn(
                  "absolute inset-0 flex flex-col",
                  activeKind !== "term" && "invisible pointer-events-none",
                  prefs.neonBorderGlow && activeKind === "term" && "neon-glow",
                )}
                aria-hidden={activeKind !== "term"}
              >
                <div className="min-h-0 flex-1">
                  <ErrorBoundary
                    fallback={
                      <div className="flex h-full flex-col items-center justify-center gap-3 p-4 text-center">
                        <div className="text-[13px] font-medium text-destructive">Terminal crashed</div>
                        <div className="text-[11px] text-muted-foreground">
                          Switch to another tab or restart the app to recover.
                        </div>
                      </div>
                    }
                  >
                    <TerminalStack term={term} viewActive={activeKind === "term"} />
                  </ErrorBoundary>
                </div>
                <TerminalBottomBar onSendToTerminal={(text: string) => runInActiveTerminal(text)} />
              </div>

              {/* Editor + AI pane row — AI panel overlays editor so nothing
                  resizes when the panel toggles.  No flex/grid reflow, no
                  Monaco automaticLayout slide. */}
              <div
                className={cn(
                  "relative min-h-0 min-w-0 flex-1",
                  activeKind !== "file" && "invisible pointer-events-none",
                  prefs.neonBorderGlow && activeKind === "file" && "neon-glow",
                )}
                aria-hidden={activeKind !== "file"}
              >
                {/* Editor layer */}
                {openFiles.length > 0 ? (
                  <div
                    className={cn(
                      "h-full w-full overflow-hidden rounded-lg border border-border bg-background",
                      prefs.neonBorderGlow && activeKind === "file" && "neon-glow",
                      prefs.panelShadows && "panel-shadow",
                      prefs.activePanelGlow && activeKind === "file" && "active-panel-glow active",
                    )}
                    style={{
                      margin: prefs.panelGaps > 0 ? `var(--panel-gaps) 0 var(--panel-gaps) var(--panel-gaps)` : undefined,
                    }}
                  >
                    <EditorArea files={openFiles} activePath={activeFile} />
                  </div>
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <HugeiconsIcon icon={PencilEdit02Icon} size={32} strokeWidth={1.5} className="opacity-40" />
                    <p className="text-sm font-medium">No files open</p>
                    <p className="text-xs opacity-60">Open a file from the sidebar or press Ctrl+O</p>
                  </div>
                )}
              </div>

              {/* Settings layer */}
              {settingsOpen ? (
                <div
                  className={cn(
                    "absolute inset-0",
                    prefs.frostedGlass && bgDataUrl
                      ? "bg-background/80 backdrop-blur-xl"
                      : "bg-background/95",
                    activeKind !== "settings" && "invisible pointer-events-none",
                    prefs.animationsEnabled && "transition-all duration-200 ease-out",
                    activeKind !== "settings" && prefs.animationsEnabled && "scale-95 opacity-0",
                    prefs.neonBorderGlow && activeKind === "settings" && "neon-glow",
                  )}
                  aria-hidden={activeKind !== "settings"}
                >
                  <SettingsPage onClose={closeSettings} />
                </div>
              ) : null}
              {/* Git Graph layer */}
              {openPanel === "git-graph" && (
                <div
                  className={cn(
                    "absolute inset-0",
                    activeKind !== "git-graph" && "invisible pointer-events-none",
                    prefs.neonBorderGlow && activeKind === "git-graph" && "neon-glow",
                  )}
                  aria-hidden={activeKind !== "git-graph"}
                >
                  <ErrorBoundary>
                    <GitGraphPanel onClose={closeGitGraph} />
                  </ErrorBoundary>
                </div>
              )}
              {/* Issues layer */}
              {openPanel === "issues" && (
                <div
                  className={cn(
                    "absolute inset-0",
                    activeKind !== "issues" && "invisible pointer-events-none",
                    prefs.neonBorderGlow && activeKind === "issues" && "neon-glow",
                  )}
                  aria-hidden={activeKind !== "issues"}
                >
                  <ErrorBoundary>
                    <IssuesPanel onClose={closeIssues} />
                  </ErrorBoundary>
                </div>
              )}
              {/* SFTP layers — one per tab, only active one visible */}
              {term.tabs.map((tab) => {
                console.log("[SFTP render] tab.id=", tab.id, "sftpOpen=", tab.sftpOpen, "activeId=", term.activeId, "activeKind=", activeKind, "visible=", tab.sftpOpen && tab.sftpHost && term.activeId === tab.id && activeKind === "sftp");
                return tab.sftpOpen && tab.sftpHost ? (
                  <div
                    key={tab.id}
                    className={cn(
                      "absolute inset-0",
                      (term.activeId !== tab.id || activeKind !== "sftp") && "invisible pointer-events-none",
                      prefs.neonBorderGlow && term.activeId === tab.id && activeKind === "sftp" && "neon-glow",
                    )}
                    aria-hidden={term.activeId !== tab.id || activeKind !== "sftp"}
                  >
                    <ErrorBoundary>
                      <SftpView host={tab.sftpHost} onClose={closeSftp} />
                    </ErrorBoundary>
                  </div>
                ) : null;
              })}
            </div>
          </div>

        </main>

        {/* ── Status bar ─────────────────────────────────────────── */}
        <div
          style={{
            marginLeft: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            marginBottom: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
          }}
        >
          <StatusBar onExplainError={prefs.aiEnabled ? explainLastError : undefined} />
        </div>

        {/* ── Floating overlays ──────────────────────────────────── */}
        <DialogLayer open={gitHistoryOpen}>
          <GitHistoryDialog onClose={() => setGitHistoryOpen(false)} />
        </DialogLayer>
        <DialogLayer open={shortcutsOpen}>
          <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />
        </DialogLayer>
        {totpOpen && <TotpDialog onClose={() => setTotpOpen(false)} variant="dropdown" />}
        <DialogLayer open={jobsOpen}>
          <JobsDialog onClose={() => setJobsOpen(false)} />
        </DialogLayer>
        {prefs.aiEnabled && activeKind !== "settings" && (
          <AiFloatingBubble
            pendingQuery={pendingAiQuery}
            activeTabId={term.activeId}
          />
        )}
        <DialogLayer open={prefs.aiEnabled && suggestOpen}>
          <SuggestDialog onClose={() => setSuggestOpen(false)} />
        </DialogLayer>
        <DialogLayer open={explainCtx !== null}>
          {explainCtx && (
            <ExplainDialog
              command={explainCtx.command}
              output={explainCtx.output}
              exitCode={explainCtx.exitCode}
              onClose={() => setExplainCtx(null)}
            />
          )}
        </DialogLayer>
        <DialogLayer open={dockerOpen}>
          <DockerView onClose={() => setDockerOpen(false)} />
        </DialogLayer>
        <DialogLayer open={k8sOpen}>
          <KubernetesView onClose={() => setK8sOpen(false)} />
        </DialogLayer>
        <DialogLayer open={terraformOpen}>
          <TerraformView onClose={() => setTerraformOpen(false)} />
        </DialogLayer>
        <DialogLayer open={githubOpen}>
          <GithubIssuesDialog onClose={() => setGithubOpen(false)} />
        </DialogLayer>
        <DialogLayer open={cicdOpen}>
          <CiCdDialog onClose={() => setCicdOpen(false)} />
        </DialogLayer>
        <DialogLayer open={toolsOpen}>
          <ToolsHubDialog onClose={() => setToolsOpen(false)} />
        </DialogLayer>
        <DialogLayer open={diffOpen}>
          {diffOpen && (
            <DiffDialog
              initialLeft={diffPaths?.left}
              initialRight={diffPaths?.right}
              onClose={() => setDiffOpen(false)}
            />
          )}
        </DialogLayer>
        <DialogLayer open={previewOpen}>
          {previewOpen && (
            <PreviewDialog initialPath={previewPath} onClose={() => setPreviewOpen(false)} />
          )}
        </DialogLayer>
        {!prefs.hasSeenWelcome ? <WelcomeDialog /> : null}
        {paletteOpen && (
          <CommandPalette open commands={commands} onClose={() => setPaletteOpen(false)} />
        )}
        <DialogLayer open={switcherOpen}>
          {switcherOpen && (
            <QuickSwitcher
              open={switcherOpen}
              term={term}
              openFiles={openFiles}
              active={active}
              settingsOpen={settingsOpen}
              onSelect={(item) => {
                if (item.kind === "term") selectTerm(item.id);
                else if (item.kind === "file") selectFile(item.path);
                else openSettings();
              }}
              onClose={() => setSwitcherOpen(false)}
            />
          )}
        </DialogLayer>
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}

export default App;
