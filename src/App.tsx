import { lazy, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { TerminalStack } from "./TerminalStack";
import { TabBar } from "./shell/TabBar";
import { DialogHost } from "./shell/DialogHost";
import { TerminalBottomBar } from "./terminal/TerminalBottomBar";
import { TerminalAiComposer, tabSessionId } from "./terminal/TerminalAiComposer";
import { runInActiveTerminal, typeInActiveTerminal } from "./ai/terminalContext";
import { setWindowFocused } from "./windowFocus";
import { useTerminalTabs } from "./useTerminalTabs";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Search01Icon,
  LayoutThreeColumnIcon,
  MessageMultiple02Icon,
  Timer01Icon,
  Moon02Icon,
  Sun03Icon,
  Settings01Icon,
  Cancel01Icon,
  PencilEdit02Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { openBubble, toggleComposer, sendToComposer } from "./ai/bubbleStore";
import { setActiveSessionId } from "./ai/sessionStore";
import { getEditorSelection, getEditorFile, closeEditorFindWidget } from "./ai/editorStore";
import { AiSessionsPanel } from "./ai/AiSessionsPanel";
import { checkForUpdates } from "./updater";
import { setAiQueryListener } from "./ai/terminalInput";
import { FileExplorer } from "./explorer/FileExplorer";
import type { OpenFile } from "./editor/EditorArea";
import { useTotpTimer } from "./totp/useTotpTimer";
import { usePrefs, setPrefs, getPrefs } from "./settings/preferences";
import { fontStack } from "./styles/fonts";
import { initKeys } from "./ai/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readFileBase64 } from "./fs";
import { ToastContainer, toast } from "./toast";
import { setBridgeHandler } from "./bridge";
import { openSettingsWindow } from "./settingsWindow";
import type { Command } from "./command-palette/CommandPalette";
import { useClipboardListener } from "./clipboard/useClipboardListener";
import { pickWorkspaceFolder } from "./workspace/store";
import { useActiveSshHost } from "./remote/store";
import { ClipboardIcon } from "@hugeicons/core-free-icons";
import { StatusBar } from "./statusbar/StatusBar";
import { ErrorBoundary } from "./components/ErrorBoundary";
import type { OpenPanelKind } from "./git/types";
import { readActiveTerminal, getActiveTerminalExit, subscribeTerminalState, focusActiveTerminal, getActiveTerminalPtyId } from "./ai/terminalContext";
import { invoke } from "@tauri-apps/api/core";
import { SidebarRail, type SidebarViewId } from "./sidebar/SidebarRail";
import { PathBar } from "./header/PathBar";
import type { ActiveTab } from "./shell/types";
import { lazyPanel } from "./shell/lazy";
import type { K8sResourceSelection } from "./kubernetes/KubernetesView";
import type { DockerResourceSelection } from "./docker/DockerDetailPanel";
import "./App.css";

const EditorArea = lazy(() => import("./editor/EditorArea").then((m) => ({ default: m.EditorArea })));
const RunbooksDialog = lazy(() => import("./workflows/RunbooksDialog").then((m) => ({ default: m.RunbooksDialog })));
const SettingsPage = lazy(() => import("./settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const ToolsHubView = lazy(() => import("./tools-hub/ToolsHubView").then((m) => ({ default: m.ToolsHubView })));
const DockerView = lazy(() => import("./docker/DockerView").then((m) => ({ default: m.DockerView })));
const DockerDetailPanel = lazy(() => import("./docker/DockerDetailPanel").then((m) => ({ default: m.DockerDetailPanel })));
const KubernetesView = lazy(() => import("./kubernetes/KubernetesView").then((m) => ({ default: m.KubernetesView })));
const PodDetailPanel = lazy(() => import("./kubernetes/PodDetailPanel").then((m) => ({ default: m.PodDetailPanel })));
const ServiceDetailPanel = lazy(() => import("./kubernetes/ServiceDetailPanel").then((m) => ({ default: m.ServiceDetailPanel })));
const DeploymentDetailPanel = lazy(() => import("./kubernetes/DeploymentDetailPanel").then((m) => ({ default: m.DeploymentDetailPanel })));
const IngressDetailPanel = lazy(() => import("./kubernetes/IngressDetailPanel").then((m) => ({ default: m.IngressDetailPanel })));
const ConfigMapDetailPanel = lazy(() => import("./kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.ConfigMapDetailPanel })));
const SecretDetailPanel = lazy(() => import("./kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.SecretDetailPanel })));
const PvcDetailPanel = lazy(() => import("./kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.PvcDetailPanel })));
const QuotaDetailPanel = lazy(() => import("./kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.QuotaDetailPanel })));
const JobDetailPanel = lazy(() => import("./kubernetes/JobDetailPanel").then((m) => ({ default: m.JobDetailPanel })));
const TerraformView = lazy(() => import("./terraform/TerraformView").then((m) => ({ default: m.TerraformView })));
const TailscaleView = lazy(() => import("./tailscale/TailscaleView").then((m) => ({ default: m.TailscaleView })));
const RemotesView = lazy(() => import("./remotes/RemotesView").then((m) => ({ default: m.RemotesView })));
const SftpView = lazy(() => import("./remotes/SftpView").then((m) => ({ default: m.SftpView })));
const CiCdDialog = lazy(() => import("./ci-cd/CiCdDialog").then((m) => ({ default: m.CiCdDialog })));
const SourceControlPanel = lazy(() => import("./git/SourceControlPanel").then((m) => ({ default: m.SourceControlPanel })));
const GitGraphPanel = lazy(() => import("./git/GitGraphPanel").then((m) => ({ default: m.GitGraphPanel })));
const IssuesPanel = lazy(() => import("./git/IssuesPanel").then((m) => ({ default: m.IssuesPanel })));
const AiTabPanel = lazy(() => import("./ai/AiTabPanel").then((m) => ({ default: m.AiTabPanel })));
const BookmarksView = lazy(() => import("./bookmarks/BookmarksView").then((m) => ({ default: m.BookmarksView })));

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
    import("./ai/terminalContext")
      .then((m) => {
        m.searchActiveTerminal(q);
      })
      .catch(() => {});
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
                import("./ai/terminalContext")
                  .then((m) => {
                    m.searchActiveTerminal(q);
                  })
                  .catch(() => {});
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

/* ── Main App ─────────────────────────────────────────────────────────── */

export type { ActiveTab } from "./shell/types";

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
      "explorer", "source-control", "remotes", "workflows", "tools-hub",
      "kubernetes", "ci-cd", "terraform", "docker", "tailscale", "sftp", "bookmarks",
    ];
    if (stored && valid.includes(stored as SidebarViewId)) return stored as SidebarViewId;
  } catch (e) { console.error("Failed to read sidebar view", e); }
  return "explorer";
}

function K8sResourceDetailPanel({
  selection,
  onClose,
}: {
  selection: K8sResourceSelection;
  onClose: () => void;
}) {
  switch (selection.kind) {
    case "pod":
      return <PodDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "service":
      return <ServiceDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "deployment":
      return <DeploymentDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "ingress":
      return <IngressDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "configmap":
      return <ConfigMapDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "secret":
      return <SecretDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "pvc":
      return <PvcDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "quota":
      return <QuotaDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    case "job":
      return <JobDetailPanel namespace={selection.namespace} name={selection.name} onClose={onClose} />;
    default:
      return null;
  }
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
  const aiSessionsButtonRef = useRef<HTMLDivElement>(null);
  const clipboardButtonRef = useRef<HTMLButtonElement>(null);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [explainCtx, setExplainCtx] = useState<{ command: string; output: string; exitCode: number | null } | null>(null);

  const explainLastError = () => setExplainCtx({ command: "", output: readActiveTerminal(), exitCode: getActiveTerminalExit() });
  const [dockerOpen, setDockerOpen] = useState(false);
  const [k8sOpen, setK8sOpen] = useState(false);
  const [terraformOpen, setTerraformOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [cicdOpen, setCicdOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [diffPaths, setDiffPaths] = useState<{ left: string; right: string } | null>(null);
  const [cloudSyncOpen, setCloudSyncOpen] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewPath, setPreviewPath] = useState<string | undefined>(undefined);
  const [openPanel, setOpenPanel] = useState<OpenPanelKind>(null);

  const [selectedK8sResource, setSelectedK8sResource] = useState<K8sResourceSelection | null>(null);
  const [selectedDockerResource, setSelectedDockerResource] = useState<DockerResourceSelection | null>(null);

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
      sendToComposer(query);
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
        toggleComposer();
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
  const [activeKind, setActiveKind] = useState<"term" | "file" | "settings" | "git-graph" | "issues" | "sftp" | "ai">("term");

  // Close Monaco find widget when leaving the file editor tab
  useEffect(() => {
    if (activeKind !== "file") {
      closeEditorFindWidget();
    }
  }, [activeKind]);

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
      { id: "open-clipboard", label: "Open clipboard history", hint: "Ctrl/Cmd+Shift+V", run: () => setClipboardOpen(true) },
      ...(prefs.aiEnabled
        ? [
            { id: "suggest", label: "Suggest command (AI)", run: () => setSuggestOpen(true) },
            { id: "explain", label: "Explain last error (AI)", run: explainLastError },
            { id: "ai-bubble", label: "Toggle AI composer", hint: "Ctrl/Cmd+Shift+A", run: () => toggleComposer() },
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
                  const root = getWorkspaceRoot() || "/";
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
      { id: "cloud-sync", label: "Cloud sync (export/import)", run: () => setCloudSyncOpen(true) },
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
      } else if (key === "v" && e.shiftKey) {
        e.preventDefault();
        setClipboardOpen(true);
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

  // Listen for internal "open settings" events from panels like the AI tab
  useEffect(() => {
    const onOpenSettings = () => {
      setSettingsOpen(true);
      setActiveKind("settings");
    };
    window.addEventListener("husk:open-settings", onOpenSettings);
    return () => window.removeEventListener("husk:open-settings", onOpenSettings);
  }, []);

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
    setOpenFiles((prev) => {
      if (prev.some((f) => f.path === path)) return prev;
      return [...prev, { path, name, remoteHost, pinned: false }];
    });
    setActiveFile(path);
    setActiveKind("file");
  }, [remoteHost]);

  const selectFile = (path: string) => {
    setActiveFile(path);
    setActiveKind("file");
  };

  const closeFile = (path: string) => {
    const file = openFiles.find((f) => f.path === path);
    if (file?.pinned) return; // Cannot close pinned files
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

  const pinFile = (path: string) => {
    setOpenFiles((prev) => {
      const file = prev.find((f) => f.path === path);
      if (!file || file.pinned) return prev;
      const next = prev.filter((f) => f.path !== path);
      const pinnedCount = next.filter((f) => f.pinned).length;
      next.splice(pinnedCount, 0, { ...file, pinned: true });
      return next;
    });
  };

  const unpinFile = (path: string) => {
    setOpenFiles((prev) => {
      const file = prev.find((f) => f.path === path);
      if (!file || !file.pinned) return prev;
      const next = prev.filter((f) => f.path !== path);
      const pinnedCount = next.filter((f) => f.pinned).length;
      next.splice(pinnedCount, 0, { ...file, pinned: false });
      return next;
    });
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= openFiles.length || toIndex >= openFiles.length) return;
    const next = [...openFiles];
    const [removed] = next.splice(fromIndex, 1);
    const pinnedCount = next.filter((f) => f.pinned).length;
    if (removed.pinned && toIndex > pinnedCount) {
      next.splice(pinnedCount, 0, removed);
    } else if (!removed.pinned && toIndex < pinnedCount) {
      next.splice(pinnedCount, 0, removed);
    } else {
      next.splice(toIndex, 0, removed);
    }
    setOpenFiles(next);
  };

  const active: ActiveTab =
    activeKind === "settings"
      ? { kind: "settings" }
      : activeKind === "file" && activeFile
        ? { kind: "file", path: activeFile }
        : activeKind === "ai"
          ? { kind: "ai" }
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
                  <HugeiconsIcon icon={MessageMultiple02Icon} size={15} strokeWidth={1.75} />
                </Button>
                <AiSessionsPanel
                  open={aiSessionsOpen}
                  onClose={() => setAiSessionsOpen(false)}
                  onSelectSession={(id) => {
                    setActiveSessionId(id);
                    setActiveKind("ai");
                  }}
                  anchorRef={aiSessionsButtonRef}
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
              onPinTerm={term.pinTab}
              onUnpinTerm={term.unpinTab}
              onPinFile={pinFile}
              onUnpinFile={unpinFile}
              onMoveTerm={term.moveTab}
              onMoveFile={moveFile}
              settingsOpen={settingsOpen}
              onSelectSettings={() => setActiveKind("settings")}
              onCloseSettings={closeSettings}
              onSelectAi={() => setActiveKind("ai")}
              onPinAi={() => setPrefs({ aiTabPinned: true })}
              onUnpinAi={() => setPrefs({ aiTabPinned: false })}
              onSetAiTabColor={(color) => setPrefs({ aiTabColor: color })}
              aiPinned={prefs.aiTabPinned}
              aiColor={prefs.aiTabColor}
              animationsEnabled={prefs.animationsEnabled}
            />
            <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
          </div>

          {/* Right: search + actions */}
          <SearchInline />

          <div className="flex items-center gap-0.5">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="icon"
              className="relative size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              title="Authenticator (2FA)"
              onClick={() => setTotpOpen(true)}
            >
              <HugeiconsIcon icon={Timer01Icon} size={14} strokeWidth={1.75} />
              <TotpBadge />
            </Button>
            <button
              ref={clipboardButtonRef}
              type="button"
              aria-label="Clipboard history"
              title="Clipboard history"
              onClick={() => setClipboardOpen((v) => !v)}
              className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground"
            >
              <HugeiconsIcon icon={ClipboardIcon} size={16} strokeWidth={1.75} />
            </button>

            {prefs.aiEnabled && (
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "size-6 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title="Toggle AI composer (Ctrl+Shift+L)"
                onClick={() => toggleComposer()}
              >
                <HugeiconsIcon icon={SparklesIcon} size={15} strokeWidth={1.75} />
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
              onClick={openSettings}
            >
              <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
            </Button>
          </div>

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
                    lazyPanel(<SourceControlPanel inline onOpenGitGraph={openGitGraph} onOpenIssues={openIssues} />, "Source Control")
                  ) : sidebarView === "remotes" ? (
                    lazyPanel(
                      <RemotesView
                        inline
                        onSftp={(h) => openSftp(h)}
                      />,
                      "Remotes",
                    )
                  ) : sidebarView === "workflows" ? (
                    lazyPanel(<RunbooksDialog inline />, "Workflows")
                  ) : sidebarView === "tools-hub" ? (
                    lazyPanel(<ToolsHubView onSelectView={(v) => persistSidebarView(v)} />, "Integrations")
                  ) : sidebarView === "kubernetes" ? (
                    lazyPanel(
                      <KubernetesView
                        inline
                        onInspectResource={(sel) => setSelectedK8sResource(sel)}
                      />,
                      "Kubernetes",
                    )
                  ) : sidebarView === "ci-cd" ? (
                    lazyPanel(<CiCdDialog inline />, "CI/CD")
                  ) : sidebarView === "terraform" ? (
                    lazyPanel(<TerraformView inline />, "Terraform")
                  ) : sidebarView === "docker" ? (
                    lazyPanel(
                      <DockerView
                        inline
                        onInspectResource={(sel) => setSelectedDockerResource(sel)}
                      />,
                      "Docker",
                    )
                  ) : sidebarView === "tailscale" ? (
                    lazyPanel(
                      <TailscaleView
                        inline
                        onConnect={(device) => {
                          const sshUser = device.user || "root";
                          const cmd = `ssh ${sshUser}@${device.ipv4}`;
                          typeInActiveTerminal(cmd);
                        }}
                      />,
                      "Tailscale",
                    )
                  ) : sidebarView === "vault" ? (
                    lazyPanel(
                      <BookmarksView
                        inline
                        onTypeCommand={(cmd) => {
                          typeInActiveTerminal(cmd);
                        }}
                        onOpenFile={(path) => {
                          const name = path.split("/").pop() || path;
                          openFile(path, name);
                        }}
                        onOpenDirectory={(path) => {
                          typeInActiveTerminal(`cd "${path}"`);
                        }}
                      />,
                      "Vault",
                    )
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
              marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : '8px',
              marginBottom: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
              marginLeft: prefs.panelGaps > 0 ? '0' : undefined,
              marginTop: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
            }}
          >
            <div className="relative flex min-h-0 min-w-0 flex-1">
              {/* Terminal layer */}
              <div
                className={cn(
                  "absolute inset-0 flex flex-col",
                  (activeKind !== "term" || selectedK8sResource != null || selectedDockerResource != null) && "invisible pointer-events-none",
                  prefs.neonBorderGlow && activeKind === "term" && "neon-glow",
                )}
                aria-hidden={activeKind !== "term" || selectedK8sResource != null || selectedDockerResource != null}
              >
                <div className="relative flex min-h-0 flex-1 flex-col">
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
                  {prefs.panelGaps > 0 && (
                    <div
                      className={prefs.panelGapStyle !== "none" ? `gap-pattern-${prefs.panelGapStyle}` : undefined}
                      style={{ height: `var(--panel-gaps)`, flexShrink: 0 }}
                    />
                  )}
                  <TerminalAiComposer
                    sessionId={tabSessionId(term.activeId)}
                    onOpenInAiTab={() => setActiveKind("ai")}
                    registerSend={true}
                  />
                </div>
                <TerminalBottomBar onSendToTerminal={(text: string) => runInActiveTerminal(text)} />
              </div>

              {/* Kubernetes resource detail layer */}
              {selectedK8sResource && (
                <div
                  className={cn(
                    "absolute inset-0 z-10 flex flex-col",
                    prefs.neonBorderGlow && "neon-glow",
                  )}
                  aria-hidden={!selectedK8sResource}
                >
                  <ErrorBoundary>
                    {lazyPanel(<K8sResourceDetailPanel selection={selectedK8sResource} onClose={() => setSelectedK8sResource(null)} />, "Kubernetes")}
                  </ErrorBoundary>
                </div>
              )}

              {/* Docker resource detail layer */}
              {selectedDockerResource && (
                <div
                  className={cn(
                    "absolute inset-0 z-10 flex flex-col",
                    prefs.neonBorderGlow && "neon-glow",
                  )}
                  aria-hidden={!selectedDockerResource}
                >
                  <ErrorBoundary>
                    {lazyPanel(
                      <DockerDetailPanel
                        selection={selectedDockerResource}
                        onClose={() => setSelectedDockerResource(null)}
                        onAction={async (fn, label) => {
                          await fn();
                          toast({ title: label, variant: "success" });
                        }}
                      />,
                      "Docker",
                    )}
                  </ErrorBoundary>
                </div>
              )}

              {/* Editor + AI pane row — AI panel overlays editor so nothing
                  resizes when the panel toggles.  No flex/grid reflow, no
                  Monaco automaticLayout slide. */}
              <div
                className={cn(
                  "relative min-h-0 min-w-0 flex-1",
                  activeKind !== "file" && "invisible pointer-events-none",
                  prefs.neonBorderGlow && activeKind === "file" && "neon-glow",
                )}
                style={{
                  padding: prefs.panelGaps > 0 ? `var(--panel-gaps)` : '8px',
                }}
                aria-hidden={activeKind !== "file"}
              >
                {/* Editor layer */}
                {openFiles.length > 0 ? (
                  <div className={cn("flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-background", prefs.neonBorderGlow && activeKind === "file" && "neon-glow", prefs.panelShadows && "panel-shadow", prefs.activePanelGlow && activeKind === "file" && "active-panel-glow active")}>
                    <div className="flex-1 overflow-hidden">
                      {lazyPanel(<EditorArea files={openFiles} activePath={activeFile} />, "Editor")}
                    </div>
                    {prefs.panelGaps > 0 && (
                      <div
                        className={prefs.panelGapStyle !== "none" ? `gap-pattern-${prefs.panelGapStyle}` : undefined}
                        style={{ height: `var(--panel-gaps)`, flexShrink: 0 }}
                      />
                    )}
                    <TerminalAiComposer
                      sessionId={tabSessionId(term.activeId)}
                      onOpenInAiTab={() => setActiveKind("ai")}
                      className="composer-editor"
                    />
                  </div>
                ) : (
                  <div className="h-full w-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <HugeiconsIcon icon={PencilEdit02Icon} size={32} strokeWidth={1.5} className="opacity-40" />
                    <p className="text-sm font-medium">No files open</p>
                    <p className="text-xs opacity-60">Open a file from the sidebar or press Ctrl+O</p>
                  </div>
                )}
              </div>

              {/* AI layer */}
              {activeKind === "ai" && (
                <div
                  className={cn(
                    "absolute inset-0 z-10",
                    prefs.neonBorderGlow && "neon-glow",
                  )}
                  aria-hidden={activeKind !== "ai"}
                >
                  <ErrorBoundary>
                    {lazyPanel(<AiTabPanel />, "Husk AI")}
                  </ErrorBoundary>
                </div>
              )}

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
                  {lazyPanel(<SettingsPage onClose={closeSettings} />, "Settings")}
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
                    {lazyPanel(<GitGraphPanel onClose={closeGitGraph} />, "Git Graph")}
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
                    {lazyPanel(<IssuesPanel onClose={closeIssues} />, "Issues")}
                  </ErrorBoundary>
                </div>
              )}
              {/* SFTP layers — one per tab, only active one visible */}
              {term.tabs.map((tab) =>
                tab.sftpHost ? (
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
                      {lazyPanel(<SftpView host={tab.sftpHost!} onClose={closeSftp} />, "SFTP")}
                    </ErrorBoundary>
                  </div>
                ) : null
              )}
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

        <DialogHost
          aiEnabled={prefs.aiEnabled}
          hasSeenWelcome={prefs.hasSeenWelcome}
          gitHistoryOpen={gitHistoryOpen}
          setGitHistoryOpen={setGitHistoryOpen}
          shortcutsOpen={shortcutsOpen}
          setShortcutsOpen={setShortcutsOpen}
          totpOpen={totpOpen}
          setTotpOpen={setTotpOpen}
          jobsOpen={jobsOpen}
          setJobsOpen={setJobsOpen}
          suggestOpen={suggestOpen}
          setSuggestOpen={setSuggestOpen}
          explainCtx={explainCtx}
          setExplainCtx={setExplainCtx}
          dockerOpen={dockerOpen}
          setDockerOpen={setDockerOpen}
          k8sOpen={k8sOpen}
          setK8sOpen={setK8sOpen}
          terraformOpen={terraformOpen}
          setTerraformOpen={setTerraformOpen}
          githubOpen={githubOpen}
          setGithubOpen={setGithubOpen}
          cicdOpen={cicdOpen}
          setCicdOpen={setCicdOpen}
          toolsOpen={toolsOpen}
          setToolsOpen={setToolsOpen}
          diffOpen={diffOpen}
          setDiffOpen={setDiffOpen}
          diffPaths={diffPaths}
          previewOpen={previewOpen}
          setPreviewOpen={setPreviewOpen}
          previewPath={previewPath}
          cloudSyncOpen={cloudSyncOpen}
          setCloudSyncOpen={setCloudSyncOpen}
          paletteOpen={paletteOpen}
          setPaletteOpen={setPaletteOpen}
          commands={commands}
          clipboardOpen={clipboardOpen}
          setClipboardOpen={setClipboardOpen}
          clipboardButtonRef={clipboardButtonRef}
          switcherOpen={switcherOpen}
          setSwitcherOpen={setSwitcherOpen}
          term={term}
          openFiles={openFiles}
          active={active}
          settingsOpen={settingsOpen}
          onInspectK8sResource={setSelectedK8sResource}
          selectTerm={selectTerm}
          selectFile={selectFile}
          openSettings={openSettings}
        />
        <ToastContainer />
      </div>
    </TooltipProvider>
  );
}

export default App;
