import { lazy } from "react";
import type * as React from "react";
import { DialogLayer } from "../components/DialogLayer";
import { SuggestDialog, ExplainDialog } from "../ai/AssistDialogs";
import { WelcomeDialog } from "../welcome/WelcomeDialog";
import { lazyPanel } from "./lazy";
import type { Command } from "../command-palette/CommandPalette";
import type { OpenFile } from "../editor/EditorArea";
import type { TerminalTabsApi } from "../useTerminalTabs";
import type { K8sResourceSelection } from "../kubernetes/KubernetesView";
import type { ActiveTab } from "./types";

const TotpDialog = lazy(() => import("../totp/TotpDialog").then((m) => ({ default: m.TotpDialog })));
const JobsDialog = lazy(() => import("../jobs/JobsDialog").then((m) => ({ default: m.JobsDialog })));
const DockerView = lazy(() => import("../docker/DockerView").then((m) => ({ default: m.DockerView })));
const KubernetesView = lazy(() => import("../kubernetes/KubernetesView").then((m) => ({ default: m.KubernetesView })));
const TerraformView = lazy(() => import("../terraform/TerraformView").then((m) => ({ default: m.TerraformView })));
const GithubIssuesDialog = lazy(() => import("../github-issues/GithubIssuesDialog").then((m) => ({ default: m.GithubIssuesDialog })));
const CiCdDialog = lazy(() => import("../ci-cd/CiCdDialog").then((m) => ({ default: m.CiCdDialog })));
const ToolsHubDialog = lazy(() => import("../tools-hub/ToolsHubDialog").then((m) => ({ default: m.ToolsHubDialog })));
const DiffDialog = lazy(() => import("../diff/DiffDialog").then((m) => ({ default: m.DiffDialog })));
const PreviewDialog = lazy(() => import("../preview/PreviewDialog").then((m) => ({ default: m.PreviewDialog })));
const CloudSyncDialog = lazy(() => import("../cloud-sync/CloudSyncDialog").then((m) => ({ default: m.CloudSyncDialog })));
const GitHistoryDialog = lazy(() => import("../git/GitHistoryDialog").then((m) => ({ default: m.GitHistoryDialog })));
const ShortcutsDialog = lazy(() => import("../shortcuts/ShortcutsDialog").then((m) => ({ default: m.ShortcutsDialog })));
const CommandPalette = lazy(() => import("../command-palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));
const ClipboardPanel = lazy(() => import("../clipboard/ClipboardPanel").then((m) => ({ default: m.ClipboardPanel })));
const QuickSwitcher = lazy(() => import("../switcher/QuickSwitcher").then((m) => ({ default: m.QuickSwitcher })));

type ExplainCtx = { command: string; output: string; exitCode: number | null };
type Setter<T> = React.Dispatch<React.SetStateAction<T>>;

export function DialogHost({
  aiEnabled,
  hasSeenWelcome,
  gitHistoryOpen,
  setGitHistoryOpen,
  shortcutsOpen,
  setShortcutsOpen,
  totpOpen,
  setTotpOpen,
  jobsOpen,
  setJobsOpen,
  suggestOpen,
  setSuggestOpen,
  explainCtx,
  setExplainCtx,
  dockerOpen,
  setDockerOpen,
  k8sOpen,
  setK8sOpen,
  terraformOpen,
  setTerraformOpen,
  githubOpen,
  setGithubOpen,
  cicdOpen,
  setCicdOpen,
  toolsOpen,
  setToolsOpen,
  diffOpen,
  setDiffOpen,
  diffPaths,
  previewOpen,
  setPreviewOpen,
  previewPath,
  cloudSyncOpen,
  setCloudSyncOpen,
  paletteOpen,
  setPaletteOpen,
  paletteInput,
  setPaletteInput,
  commands,
  clipboardOpen,
  setClipboardOpen,
  switcherOpen,
  setSwitcherOpen,
  term,
  openFiles,
  active,
  settingsOpen,
  onInspectK8sResource,
  selectTerm,
  selectFile,
  openSettings,
}: {
  aiEnabled: boolean;
  hasSeenWelcome: boolean;
  gitHistoryOpen: boolean;
  setGitHistoryOpen: Setter<boolean>;
  shortcutsOpen: boolean;
  setShortcutsOpen: Setter<boolean>;
  totpOpen: boolean;
  setTotpOpen: Setter<boolean>;
  jobsOpen: boolean;
  setJobsOpen: Setter<boolean>;
  suggestOpen: boolean;
  setSuggestOpen: Setter<boolean>;
  explainCtx: ExplainCtx | null;
  setExplainCtx: Setter<ExplainCtx | null>;
  dockerOpen: boolean;
  setDockerOpen: Setter<boolean>;
  k8sOpen: boolean;
  setK8sOpen: Setter<boolean>;
  terraformOpen: boolean;
  setTerraformOpen: Setter<boolean>;
  githubOpen: boolean;
  setGithubOpen: Setter<boolean>;
  cicdOpen: boolean;
  setCicdOpen: Setter<boolean>;
  toolsOpen: boolean;
  setToolsOpen: Setter<boolean>;
  diffOpen: boolean;
  setDiffOpen: Setter<boolean>;
  diffPaths: { left: string; right: string } | null;
  previewOpen: boolean;
  setPreviewOpen: Setter<boolean>;
  previewPath?: string;
  cloudSyncOpen: boolean;
  setCloudSyncOpen: Setter<boolean>;
  paletteOpen: boolean;
  setPaletteOpen: Setter<boolean>;
  paletteInput: string;
  setPaletteInput: Setter<string>;
  commands: Command[];
  clipboardOpen: boolean;
  setClipboardOpen: Setter<boolean>;
  switcherOpen: boolean;
  setSwitcherOpen: Setter<boolean>;
  term: TerminalTabsApi;
  openFiles: OpenFile[];
  active: ActiveTab;
  settingsOpen: boolean;
  onInspectK8sResource: (sel: K8sResourceSelection | null) => void;
  selectTerm: (id: number) => void;
  selectFile: (path: string) => void;
  openSettings: () => void;
}) {
  return (
    <>
      <DialogLayer open={gitHistoryOpen}>
        {lazyPanel(<GitHistoryDialog onClose={() => setGitHistoryOpen(false)} />, "Git History")}
      </DialogLayer>
      <DialogLayer open={shortcutsOpen}>
        {lazyPanel(<ShortcutsDialog onClose={() => setShortcutsOpen(false)} />, "Shortcuts")}
      </DialogLayer>
      {/* Centred, not "dropdown". The dropdown variant is hardcoded to
          `fixed top-10 right-2` — it only looked deliberate while a title-bar
          icon happened to sit in that corner. With no trigger to hang off, a
          panel flying to a corner reads as a bug; this is a managed list, so it
          gets a real dialog (movable, non-blocking, Esc to close). */}
      {totpOpen && lazyPanel(<TotpDialog onClose={() => setTotpOpen(false)} variant="modal" />, "Authenticator")}
      <DialogLayer open={jobsOpen}>
        {lazyPanel(<JobsDialog onClose={() => setJobsOpen(false)} />, "Jobs")}
      </DialogLayer>
      <DialogLayer open={aiEnabled && suggestOpen}>
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
        {lazyPanel(<DockerView onClose={() => setDockerOpen(false)} />, "Docker")}
      </DialogLayer>
      <DialogLayer open={k8sOpen}>
        {lazyPanel(<KubernetesView onClose={() => setK8sOpen(false)} onInspectResource={(sel) => onInspectK8sResource(sel)} />, "Kubernetes")}
      </DialogLayer>
      <DialogLayer open={terraformOpen}>
        {lazyPanel(<TerraformView onClose={() => setTerraformOpen(false)} />, "Terraform")}
      </DialogLayer>
      <DialogLayer open={githubOpen}>
        {lazyPanel(<GithubIssuesDialog onClose={() => setGithubOpen(false)} />, "GitHub Issues")}
      </DialogLayer>
      <DialogLayer open={cicdOpen}>
        {lazyPanel(<CiCdDialog onClose={() => setCicdOpen(false)} />, "CI/CD")}
      </DialogLayer>
      <DialogLayer open={toolsOpen}>
        {lazyPanel(<ToolsHubDialog onClose={() => setToolsOpen(false)} />, "Plugins")}
      </DialogLayer>
      <DialogLayer open={diffOpen}>
        {diffOpen && lazyPanel(
          <DiffDialog
            initialLeft={diffPaths?.left}
            initialRight={diffPaths?.right}
            onClose={() => setDiffOpen(false)}
          />,
          "Diff",
        )}
      </DialogLayer>
      <DialogLayer open={previewOpen}>
        {previewOpen && lazyPanel(
          <PreviewDialog initialPath={previewPath} onClose={() => setPreviewOpen(false)} />,
          "Preview",
        )}
      </DialogLayer>
      <DialogLayer open={cloudSyncOpen}>
        {cloudSyncOpen && lazyPanel(
          <CloudSyncDialog open={cloudSyncOpen} onClose={() => setCloudSyncOpen(false)} />,
          "Cloud Sync",
        )}
      </DialogLayer>
      {!hasSeenWelcome ? <WelcomeDialog /> : null}
      {paletteOpen && lazyPanel(
        <CommandPalette
          open
          commands={commands}
          inputValue={paletteInput}
          onInputChange={setPaletteInput}
          onClose={() => setPaletteOpen(false)}
        />,
        "Command Palette",
      )}
      {clipboardOpen && lazyPanel(
        /* No anchor any more — the clipboard icon it hung off is gone from the
           title bar. ClipboardPanel falls back to top-right, which is where that
           icon used to be, so the panel still appears where it always did. */
        <ClipboardPanel onClose={() => setClipboardOpen(false)} />,
        "Clipboard",
      )}
      <DialogLayer open={switcherOpen}>
        {switcherOpen && lazyPanel(
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
          />,
          "Quick Switcher",
        )}
      </DialogLayer>
    </>
  );
}
