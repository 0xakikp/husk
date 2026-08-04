import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AppHeader } from "./shell/AppHeader";
import { DialogHost } from "./shell/DialogHost";
import { SidebarHost } from "./shell/SidebarHost";
import { WorkspacePanels } from "./shell/WorkspacePanels";
import { typeInActiveTerminal } from "./ai/terminalContext";
import { setWindowFocused } from "./windowFocus";
import { useTerminalTabs } from "./useTerminalTabs";
import { openBubble, toggleComposer, sendToComposer } from "./ai/bubbleStore";
import { setActiveSessionId } from "./ai/sessionStore";
import { closeEditorFindWidget } from "./ai/editorStore";
import { checkForUpdates } from "./updater";
import { setAiQueryListener } from "./ai/terminalInput";
import type { OpenFile } from "./editor/EditorArea";
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
import { useActiveSshHost, setActiveSshHost } from "./remote/store";
import { StatusBar } from "./statusbar/StatusBar";
import type { OpenPanelKind } from "./git/types";
import { readActiveTerminal, getActiveTerminalExit, subscribeTerminalState, focusActiveTerminal, getActiveTerminalPtyId, runInActiveTerminal } from "./ai/terminalContext";
import { useLauncherItems, type LauncherCtx } from "./command-palette/useLauncherItems";
import { pinNote, unpinNote } from "./notes/store";
import { useContext as k8sUseContext } from "./kubernetes/client";
import { extractParams, composeCommand } from "./workflows/params";
import type { Workflow } from "./workflows/store";
import { invoke } from "@tauri-apps/api/core";
import type { SidebarViewId } from "./sidebar/SidebarRail";
import { PathBar } from "./header/PathBar";
import { useDialogDrag } from "./components/dialogDrag";
import type { ActiveTab, ActiveKind } from "./shell/types";
import type { K8sResourceSelection } from "./kubernetes/KubernetesView";
import type { DockerResourceSelection } from "./docker/DockerDetailPanel";
import "./App.css";

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

function App() {
  // One listener for every dialog in the app — drag any of them by its header.
  useDialogDrag();

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

  /** Show a sidebar view unconditionally (never toggles it closed). */
  const showSidebarView = useCallback(
    (view: SidebarViewId) => {
      if (!explorerOpen) setExplorerOpen(true);
      if (view !== sidebarView) persistSidebarView(view);
    },
    [explorerOpen, sidebarView, persistSidebarView],
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
  const [paletteInput, setPaletteInput] = useState("");
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [aiSessionsOpen, setAiSessionsOpen] = useState(false);
  const aiSessionsButtonRef = useRef<HTMLDivElement>(null);
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

  /* Registered in the CAPTURE phase on window. These are global shortcuts, so
     they must fire before anything downstream can swallow the event: xterm's
     custom key handler, a React onKeyDown calling stopPropagation (React listens
     on the root container, so a synthetic stopPropagation kills the native event
     before it ever reaches a bubble-phase window listener), or a focused input.
     As a bubble listener this was reachable by window.dispatchEvent but not
     always by a real keypress — which is exactly the asymmetry we hit. */
  useEffect(() => {
    /* Match the PHYSICAL key as well as e.key.
       e.key is layout- and IME-dependent: on a non-US layout, or with an input
       method active, the K key can report something other than "k" (an IME can
       report "Process" or "Dead" outright), so a key-only test silently fails on
       some machines while passing on others running identical code. e.code is the
       physical position and does not vary. */
    const hit = (e: KeyboardEvent, key: string, code: string) =>
      e.key.toLowerCase() === key || e.code === code;

    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && hit(e, "b", "KeyB")) {
        /* Cmd/Ctrl+B for the sidebar — VS Code, Zed, Cursor and Sublime all use
           it, and until now the sidebar had no shortcut at all: the title-bar
           icon and a palette command were the only ways to reach it. */
        e.preventDefault();
        e.stopPropagation();
        toggleSidebar();
      } else if ((e.metaKey || e.ctrlKey) && hit(e, "k", "KeyK")) {
        e.preventDefault();
        e.stopPropagation();
        setPaletteOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && hit(e, "l", "KeyL")) {
        if (!prefs.aiEnabled) return;
        e.preventDefault();
        toggleComposer();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && hit(e, "a", "KeyA")) {
        e.preventDefault();
        setSwitcherOpen((v) => !v);
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && hit(e, "t", "KeyT")) {
        e.preventDefault();
        setActiveKind("term");
        focusActiveTerminal();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [prefs.aiEnabled]);

  const remoteHost = useActiveSshHost();
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const term = useTerminalTabs();
  const [activeKind, setActiveKind] = useState<ActiveKind>("term");

  // Close Monaco find widget when leaving the file editor tab
  useEffect(() => {
    if (activeKind !== "file") {
      closeEditorFindWidget();
    }
  }, [activeKind]);

  const commands: Command[] = useMemo(
    () => [
      { id: "explorer", label: "Toggle file explorer", run: () => toggleSidebar() },
      { id: "browser", label: "Open browser", keywords: "web internet page url chrome", run: () => openBrowser() },
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
      // e.target is not always an Element — a programmatically dispatched event
      // targets window, and reading .tagName off that threw out of a
      // capture-phase listener.
      const target = e.target instanceof HTMLElement ? e.target : null;
      const tag = target?.tagName.toLowerCase() ?? "";
      const isEditing = tag === "input" || tag === "textarea" || tag === "select" || !!target?.isContentEditable;
      const isTerminalFocused = !!target?.closest(".xterm");
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
  const openBrowser = () => {
    setActiveKind("web");
    setOpenPanel("web");
  };
  const closeBrowser = () => {
    setOpenPanel((p) => (p === "web" ? null : p));
    setActiveKind((k) => (k === "web" ? "term" : k));
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

  // ── Launcher (Spotlight): merge static commands with live sources ──
  const launcherCtx = useMemo<LauncherCtx>(
    () => ({
      openNote: (path, name) => {
        showSidebarView("vault");
        openFile(path, name);
      },
      pinNote: (path) => pinNote(path),
      unpinNote: (path) => unpinNote(path),
      openFile: (path, name) => openFile(path, name),
      openFileAtLine: (path, name, line) => {
        openFile(path, name);
        // EditorArea holds the reveal until the model for `path` is active, so
        // this is safe to fire before the file has finished loading.
        window.dispatchEvent(new CustomEvent("husk:reveal-line", { detail: { path, line } }));
      },
      typeInTerminal: (text) => {
        if (text) typeInActiveTerminal(text);
      },
      openDocker: () => setDockerOpen(true),
      openK8s: () => setK8sOpen(true),
      switchK8sContext: (name) => {
        void k8sUseContext(name)
          .then(() => toast({ title: `Switched to ${name}`, variant: "success", duration: 2000 }))
          .catch((e: unknown) =>
            toast({ title: "kubectl error", message: e instanceof Error ? e.message : String(e), variant: "error" }),
          );
        setK8sOpen(true);
      },
      runWorkflow: (wf: Workflow) => {
        if (extractParams(wf.steps).length > 0) {
          showSidebarView("workflows");
          toast({ title: "Workflow needs parameters — run it from the workflows panel", variant: "info", duration: 2500 });
          return;
        }
        const cmd = composeCommand(wf.steps, {}, { stopOnError: wf.stopOnError !== false });
        if (cmd) runInActiveTerminal(cmd);
      },
      openWorkflows: () => showSidebarView("workflows"),
      openJobs: () => setJobsOpen(true),
      connectRemote: (host) => {
        setActiveSshHost(host);
        showSidebarView("remotes");
      },
      openBookmarks: () => showSidebarView("bookmarks"),
      askAi: (q) => openBubble(q),
      setQuery: (v) => setPaletteInput(v),
      openFiles: openFiles.map((f) => ({ path: f.path, name: f.name })),
    }),
    [showSidebarView, openFile, openFiles],
  );

  const launcherItems = useLauncherItems(paletteOpen, paletteInput, commands, launcherCtx);

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
              className={`pointer-events-none fixed inset-0 size-full ${
                prefs.background.fit === "contain" ? "object-contain" : "object-cover"
              }`}
              style={{
                zIndex: -2,
                opacity: prefs.background.opacity / 100,
                filter: `blur(${prefs.background.blur}px)`,
              }}
            />
          </>
        )}

        <AppHeader
          prefs={prefs}
          toggleSidebar={toggleSidebar}
          aiSessionsOpen={aiSessionsOpen}
          setAiSessionsOpen={setAiSessionsOpen}
          aiSessionsButtonRef={aiSessionsButtonRef}
          onSelectAiSession={(id) => {
            setActiveSessionId(id);
            setActiveKind("ai");
          }}
          tabBarProps={{
            termTabs: term.tabs,
            openFiles,
            active,
            onSelectTerm: selectTerm,
            onSelectFile: selectFile,
            onCloseTerm: term.closeTab,
            onCloseFile: closeFile,
            onNewTerm: term.addTab,
            onRenameTerm: term.renameTab,
            onSetTabColor: term.setTabColor,
            onPinTerm: term.pinTab,
            onUnpinTerm: term.unpinTab,
            onPinFile: pinFile,
            onUnpinFile: unpinFile,
            onMoveTerm: term.moveTab,
            onMoveFile: moveFile,
            settingsOpen,
            onSelectSettings: () => setActiveKind("settings"),
            onCloseSettings: closeSettings,
            onSelectAi: () => setActiveKind("ai"),
            onPinAi: () => setPrefs({ aiTabPinned: true }),
            onUnpinAi: () => setPrefs({ aiTabPinned: false }),
            onSetAiTabColor: (color) => setPrefs({ aiTabColor: color }),
            aiPinned: prefs.aiTabPinned,
            aiColor: prefs.aiTabColor,
            animationsEnabled: prefs.animationsEnabled,
          }}
          onOpenSearch={() => setPaletteOpen(true)}
          onOpenSettings={openSettings}
          activeKind={activeKind}
        />

        {/* ── Main workspace (manual layout, husk v1 visual) ─────── */}
        <main
          className={cn(
            "zoom-content flex min-h-0 flex-1 overflow-hidden",
            prefs.panelGaps > 0 && prefs.panelGapStyle !== "none" && activeKind === "file" && `gap-pattern-${prefs.panelGapStyle}`,
          )}
          style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
        >
          <SidebarHost
            explorerOpen={explorerOpen}
            explorerWidth={explorerWidth}
            sidebarView={sidebarView}
            prefs={prefs}
            bgDataUrl={bgDataUrl}
            activeFile={activeFile}
            remoteHost={remoteHost}
            openFile={openFile}
            openGitGraph={openGitGraph}
            openIssues={openIssues}
            openSftp={openSftp}
            setSelectedK8sResource={setSelectedK8sResource}
            setSelectedDockerResource={setSelectedDockerResource}
            persistSidebarView={persistSidebarView}
            cycleSidebarView={cycleSidebarView}
            setPaletteOpen={setPaletteOpen}
            setExplorerWidth={setExplorerWidth}
            persistSidebarWidth={persistSidebarWidth}
            sidebarMinWidth={SIDEBAR_MIN_WIDTH}
            sidebarMaxWidth={SIDEBAR_MAX_WIDTH}
            typeInActiveTerminal={typeInActiveTerminal}
          />
          {/* Breadcrumb sits above the TERMINAL only, so the sidebar runs the
              full height beside it. Right margin matches WorkspacePanels so the
              two align; the row's own gap separates this column from the sidebar. */}
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            /* Panel gap between the breadcrumb and the terminal, so they float
               apart like the sidebar does rather than sitting flush. Set on the
               column rather than as a margin on either child, so the two cannot
               double up. */
            style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
          >
            <div
              className={cn(
                "shrink-0 overflow-hidden rounded-lg border border-[var(--border)]",
                prefs.frostedGlass && bgDataUrl
                  ? "bg-background/50 backdrop-blur-md"
                  : "bg-background/95",
                prefs.neonBorderGlow && "neon-glow",
                prefs.panelShadows && "panel-shadow",
              )}
              style={{
                marginTop: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
                marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : "8px",
              }}
            >
              <PathBar activeFile={activeKind === "file" ? activeFile : undefined} />
            </div>
          <WorkspacePanels
            term={term}
            activeKind={activeKind}
            setActiveKind={setActiveKind}
            selectedK8sResource={selectedK8sResource}
            setSelectedK8sResource={setSelectedK8sResource}
            selectedDockerResource={selectedDockerResource}
            setSelectedDockerResource={setSelectedDockerResource}
            prefs={prefs}
            bgDataUrl={bgDataUrl}
            openFiles={openFiles}
            activeFile={activeFile}
            settingsOpen={settingsOpen}
            openPanel={openPanel}
            closeSettings={closeSettings}
            closeGitGraph={closeGitGraph}
            closeIssues={closeIssues}
            closeSftp={closeSftp}
            closeBrowser={closeBrowser}
            chromeOccluded={paletteOpen || switcherOpen}
          />
          </div>
        </main>

        {/* ── Status bar ─────────────────────────────────────────── */}
        {/* Chrome, so flush to the window edge like the header. The margins left
            bands below and beside it where nothing paints, and the wallpaper sits
            behind everything at z-index -2. */}
        <div>
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
          paletteInput={paletteInput}
          setPaletteInput={setPaletteInput}
          commands={launcherItems}
          clipboardOpen={clipboardOpen}
          setClipboardOpen={setClipboardOpen}
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
