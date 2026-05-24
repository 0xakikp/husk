import { useState, useEffect, type MouseEvent } from "react";
import { TerminalTabs } from "./TerminalTabs";
import { AiPanel } from "./ai/AiPanel";
import { FileExplorer } from "./explorer/FileExplorer";
import { EditorArea, type OpenFile } from "./editor/EditorArea";
import { RunbooksDialog } from "./workflows/RunbooksDialog";
import { TotpDialog } from "./totp/TotpDialog";
import { SettingsPage } from "./settings/SettingsPage";
import { usePrefs, setPrefs, getPrefs } from "./settings/preferences";
import { initKeys } from "./ai/store";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ToastContainer } from "./toast";
import { WelcomeDialog } from "./welcome/WelcomeDialog";
import { CommandPalette, type Command } from "./command-palette/CommandPalette";
import { SnippetsDialog } from "./snippets/SnippetsDialog";
import { ToolsHubDialog } from "./tools-hub/ToolsHubDialog";
import { JobsDialog } from "./jobs/JobsDialog";
import { DockerView } from "./docker/DockerView";
import { KubernetesView } from "./kubernetes/KubernetesView";
import { TerraformView } from "./terraform/TerraformView";
import { AwsProfilesDialog } from "./aws-profiles/AwsProfilesDialog";
import { RemotesView } from "./remotes/RemotesView";
import { GithubIssuesDialog } from "./github-issues/GithubIssuesDialog";
import { CiCdDialog } from "./ci-cd/CiCdDialog";
import { ClipboardManager } from "./clipboard/ClipboardManager";
import { useClipboardListener } from "./clipboard/useClipboardListener";
import { DiffDialog } from "./diff/DiffDialog";
import { pickWorkspaceFolder } from "./workspace/store";
import { SourceControlPanel } from "./git/SourceControlPanel";
import { GitHistoryDialog } from "./git/GitHistoryDialog";
import { ShortcutsDialog } from "./shortcuts/ShortcutsDialog";
import { StatusBar } from "./statusbar/StatusBar";
import { PreviewDialog } from "./preview/PreviewDialog";
import { SidebarRail } from "./sidebar/SidebarRail";
import { WorkspacePath } from "./header/WorkspacePath";
import "./App.css";

function App() {
  const [aiOpen, setAiOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(380);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [runbooksOpen, setRunbooksOpen] = useState(false);
  const [totpOpen, setTotpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [snippetsOpen, setSnippetsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [jobsOpen, setJobsOpen] = useState(false);
  const [dockerOpen, setDockerOpen] = useState(false);
  const [k8sOpen, setK8sOpen] = useState(false);
  const [terraformOpen, setTerraformOpen] = useState(false);
  const [awsOpen, setAwsOpen] = useState(false);
  const [remotesOpen, setRemotesOpen] = useState(false);
  const [githubOpen, setGithubOpen] = useState(false);
  const [cicdOpen, setCicdOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [scOpen, setScOpen] = useState(false);
  const [gitHistoryOpen, setGitHistoryOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const prefs = usePrefs();
  useClipboardListener();

  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme;
  }, [prefs.theme]);

  // Load AI keys from the OS keychain (migrating any legacy localStorage keys).
  useEffect(() => {
    void initKeys();
  }, []);

  useEffect(() => {
    getCurrentWebview()
      .setZoom(prefs.zoomLevel)
      .catch(() => {});
  }, [prefs.zoomLevel]);

  useEffect(() => {
    const clamp = (z: number) => Math.min(3, Math.max(0.5, Math.round(z * 10) / 10));
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        e.stopPropagation();
        setPrefs({ zoomLevel: clamp(getPrefs().zoomLevel + 0.1) });
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        e.stopPropagation();
        setPrefs({ zoomLevel: clamp(getPrefs().zoomLevel - 0.1) });
      } else if (e.key === "0") {
        e.preventDefault();
        e.stopPropagation();
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const commands: Command[] = [
    { id: "ai", label: "Toggle AI panel", run: () => setAiOpen((v) => !v) },
    { id: "explorer", label: "Toggle file explorer", run: () => setExplorerOpen((v) => !v) },
    { id: "open-folder", label: "Open folder…", run: () => void pickWorkspaceFolder() },
    { id: "settings", label: "Open settings", run: () => setSettingsOpen(true) },
    { id: "runbooks", label: "Open runbooks", run: () => setRunbooksOpen(true) },
    { id: "totp", label: "Open authenticator (2FA)", run: () => setTotpOpen(true) },
    { id: "snippets", label: "Open snippets", run: () => setSnippetsOpen(true) },
    { id: "tools", label: "Open tools", run: () => setToolsOpen(true) },
    { id: "jobs", label: "Open background jobs", run: () => setJobsOpen(true) },
    { id: "docker", label: "Open Docker", run: () => setDockerOpen(true) },
    { id: "k8s", label: "Open Kubernetes", run: () => setK8sOpen(true) },
    { id: "terraform", label: "Open Terraform", run: () => setTerraformOpen(true) },
    { id: "aws", label: "Open AWS profiles", run: () => setAwsOpen(true) },
    { id: "remotes", label: "Open Remotes / SSH", run: () => setRemotesOpen(true) },
    { id: "github", label: "Open GitHub", run: () => setGithubOpen(true) },
    { id: "cicd", label: "Open CI / CD", run: () => setCicdOpen(true) },
    { id: "clipboard", label: "Open clipboard history", run: () => setClipboardOpen(true) },
    { id: "diff", label: "Open diff viewer", run: () => setDiffOpen(true) },
    { id: "source-control", label: "Open source control", run: () => setScOpen(true) },
    { id: "git-history", label: "Open git history", run: () => setGitHistoryOpen(true) },
    { id: "shortcuts", label: "Keyboard shortcuts", run: () => setShortcutsOpen(true) },
    { id: "preview", label: "Open preview", run: () => setPreviewOpen(true) },
    {
      id: "theme",
      label: "Toggle light / dark theme",
      run: () => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" }),
    },
  ];
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  const openFile = (path: string, name: string) => {
    setOpenFiles((prev) => (prev.some((f) => f.path === path) ? prev : [...prev, { path, name }]));
    setActiveFile(path);
  };

  const closeFile = (path: string) => {
    const idx = openFiles.findIndex((f) => f.path === path);
    const next = openFiles.filter((f) => f.path !== path);
    setOpenFiles(next);
    if (activeFile === path) {
      setActiveFile(next.length ? next[Math.max(0, idx - 1)].path : null);
    }
  };

  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = aiWidth;
    const onMove = (ev: globalThis.MouseEvent) => {
      setAiWidth(Math.min(720, Math.max(280, startW + (startX - ev.clientX))));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const hasEditor = openFiles.length > 0;

  return (
    <div className="app">
      <header className="titlebar">
        <img src="/logo.png" className="titlebar-logo" alt="huskv2" />
        <span className="titlebar-title">huskv2</span>
        <WorkspacePath />
        <div className="titlebar-spacer" />
        <button
          type="button"
          className={`titlebar-btn${explorerOpen ? " active" : ""}`}
          onClick={() => setExplorerOpen((v) => !v)}
          title="Toggle explorer"
        >
          ☰
        </button>
        <button
          type="button"
          className="titlebar-btn"
          onClick={() => setTotpOpen(true)}
          title="Authenticator (2FA)"
        >
          🔑
        </button>
        <button
          type="button"
          className="titlebar-btn"
          onClick={() => setRunbooksOpen(true)}
          title="Runbooks"
        >
          ⧉
        </button>
        <button
          type="button"
          className={`titlebar-btn${aiOpen ? " active" : ""}`}
          onClick={() => setAiOpen((v) => !v)}
          title="Toggle AI panel"
        >
          ✦
        </button>
        <button
          type="button"
          className="titlebar-btn"
          onClick={() => setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" })}
          title="Toggle light / dark"
        >
          {prefs.theme === "dark" ? "☾" : "☀"}
        </button>
        <button
          type="button"
          className={`titlebar-btn${settingsOpen ? " active" : ""}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title="Settings"
        >
          ⚙
        </button>
      </header>

      {settingsOpen ? (
        <SettingsPage onClose={() => setSettingsOpen(false)} />
      ) : (
      <div className="workspace">
        <SidebarRail
          explorerOpen={explorerOpen}
          onFiles={() => setExplorerOpen((v) => !v)}
          onSourceControl={() => setScOpen(true)}
          onGitHistory={() => setGitHistoryOpen(true)}
          onSearch={() => setPaletteOpen(true)}
        />
        {explorerOpen ? (
          <div className="workspace-explorer">
            <FileExplorer onOpenFile={openFile} />
          </div>
        ) : null}

        <div className="workspace-main">
          {hasEditor ? (
            <div className="editor-region">
              <EditorArea
                files={openFiles}
                activePath={activeFile}
                onSelect={setActiveFile}
                onClose={closeFile}
              />
            </div>
          ) : null}
          <div className={`terminal-region${hasEditor ? " split" : ""}`}>
            <TerminalTabs />
          </div>
        </div>

        {aiOpen ? (
          <>
            <div
              className="resize-handle"
              role="separator"
              aria-orientation="vertical"
              onMouseDown={startResize}
            />
            <div className="workspace-ai" style={{ width: aiWidth }}>
              <AiPanel onClose={() => setAiOpen(false)} />
            </div>
          </>
        ) : null}
      </div>
      )}

      <StatusBar />

      {scOpen ? <SourceControlPanel onClose={() => setScOpen(false)} /> : null}
      {gitHistoryOpen ? <GitHistoryDialog onClose={() => setGitHistoryOpen(false)} /> : null}
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {runbooksOpen ? <RunbooksDialog onClose={() => setRunbooksOpen(false)} /> : null}
      {totpOpen ? <TotpDialog onClose={() => setTotpOpen(false)} /> : null}
      {snippetsOpen ? <SnippetsDialog onClose={() => setSnippetsOpen(false)} /> : null}
      {toolsOpen ? <ToolsHubDialog onClose={() => setToolsOpen(false)} /> : null}
      {jobsOpen ? <JobsDialog onClose={() => setJobsOpen(false)} /> : null}
      {dockerOpen ? <DockerView onClose={() => setDockerOpen(false)} /> : null}
      {k8sOpen ? <KubernetesView onClose={() => setK8sOpen(false)} /> : null}
      {terraformOpen ? <TerraformView onClose={() => setTerraformOpen(false)} /> : null}
      {awsOpen ? <AwsProfilesDialog onClose={() => setAwsOpen(false)} /> : null}
      {remotesOpen ? <RemotesView onClose={() => setRemotesOpen(false)} /> : null}
      {githubOpen ? <GithubIssuesDialog onClose={() => setGithubOpen(false)} /> : null}
      {cicdOpen ? <CiCdDialog onClose={() => setCicdOpen(false)} /> : null}
      {clipboardOpen ? <ClipboardManager onClose={() => setClipboardOpen(false)} /> : null}
      {diffOpen ? <DiffDialog onClose={() => setDiffOpen(false)} /> : null}
      {previewOpen ? <PreviewDialog onClose={() => setPreviewOpen(false)} /> : null}
      {!prefs.hasSeenWelcome ? <WelcomeDialog /> : null}
      {paletteOpen ? (
        <CommandPalette commands={commands} onClose={() => setPaletteOpen(false)} />
      ) : null}
      <ToastContainer />
    </div>
  );
}

export default App;
