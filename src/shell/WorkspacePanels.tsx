import { lazy } from "react";
import type * as React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { TerminalStack } from "../TerminalStack";
import { TerminalBottomBar } from "../terminal/TerminalBottomBar";
import { TerminalAiComposer, tabSessionId } from "../terminal/TerminalAiComposer";
import { runInActiveTerminal } from "../ai/terminalContext";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { toast } from "../toast";
import { lazyPanel } from "./lazy";
import type { Prefs } from "../settings/preferences";
import type { OpenFile } from "../editor/EditorArea";
import type { TerminalTabsApi } from "../useTerminalTabs";
import type { OpenPanelKind } from "../git/types";
import type { K8sResourceSelection } from "../kubernetes/KubernetesView";
import type { DockerResourceSelection } from "../docker/DockerDetailPanel";
import type { ActiveKind } from "./types";

const EditorArea = lazy(() => import("../editor/EditorArea").then((m) => ({ default: m.EditorArea })));
const SettingsPage = lazy(() => import("../settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const DockerDetailPanel = lazy(() => import("../docker/DockerDetailPanel").then((m) => ({ default: m.DockerDetailPanel })));
const PodDetailPanel = lazy(() => import("../kubernetes/PodDetailPanel").then((m) => ({ default: m.PodDetailPanel })));
const ServiceDetailPanel = lazy(() => import("../kubernetes/ServiceDetailPanel").then((m) => ({ default: m.ServiceDetailPanel })));
const DeploymentDetailPanel = lazy(() => import("../kubernetes/DeploymentDetailPanel").then((m) => ({ default: m.DeploymentDetailPanel })));
const IngressDetailPanel = lazy(() => import("../kubernetes/IngressDetailPanel").then((m) => ({ default: m.IngressDetailPanel })));
const ConfigMapDetailPanel = lazy(() => import("../kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.ConfigMapDetailPanel })));
const SecretDetailPanel = lazy(() => import("../kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.SecretDetailPanel })));
const PvcDetailPanel = lazy(() => import("../kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.PvcDetailPanel })));
const QuotaDetailPanel = lazy(() => import("../kubernetes/ConfigAndStoragePanels").then((m) => ({ default: m.QuotaDetailPanel })));
const JobDetailPanel = lazy(() => import("../kubernetes/JobDetailPanel").then((m) => ({ default: m.JobDetailPanel })));
const GitGraphPanel = lazy(() => import("../git/GitGraphPanel").then((m) => ({ default: m.GitGraphPanel })));
const IssuesPanel = lazy(() => import("../git/IssuesPanel").then((m) => ({ default: m.IssuesPanel })));
const SftpView = lazy(() => import("../remotes/SftpView").then((m) => ({ default: m.SftpView })));
const AiTabPanel = lazy(() => import("../ai/AiTabPanel").then((m) => ({ default: m.AiTabPanel })));
const BrowserPanel = lazy(() => import("../browser/BrowserPanel").then((m) => ({ default: m.BrowserPanel })));

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

export function WorkspacePanels({
  term,
  activeKind,
  setActiveKind,
  selectedK8sResource,
  setSelectedK8sResource,
  selectedDockerResource,
  setSelectedDockerResource,
  prefs,
  bgDataUrl,
  openFiles,
  activeFile,
  settingsOpen,
  openPanel,
  closeSettings,
  closeGitGraph,
  closeIssues,
  closeSftp,
  closeBrowser,
  chromeOccluded,
}: {
  term: TerminalTabsApi;
  activeKind: ActiveKind;
  setActiveKind: React.Dispatch<React.SetStateAction<ActiveKind>>;
  selectedK8sResource: K8sResourceSelection | null;
  setSelectedK8sResource: (sel: K8sResourceSelection | null) => void;
  selectedDockerResource: DockerResourceSelection | null;
  setSelectedDockerResource: (sel: DockerResourceSelection | null) => void;
  prefs: Prefs;
  bgDataUrl: string | null;
  openFiles: OpenFile[];
  activeFile: string | null;
  settingsOpen: boolean;
  openPanel: OpenPanelKind;
  closeSettings: () => void;
  closeGitGraph: () => void;
  closeIssues: () => void;
  closeSftp: () => void;
  closeBrowser: () => void;
  /** True when a React surface (palette, switcher, settings, detail panels)
      can cover the browser — the native webview must be parked. */
  chromeOccluded: boolean;
}) {
  return (
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
        /* No top gap: the breadcrumb panel directly above supplies the
           separation, and doubling it would leave a wide band of wallpaper. */
        marginTop: undefined,
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
          /* Gap on the column, not as a margin on either child, so the two cannot
             stack into a double-width band. */
          style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
          aria-hidden={activeKind !== "term" || selectedK8sResource != null || selectedDockerResource != null}
        >
          {/* AI chat is right-dock only: fixed flex-row, no bottom-mode gap spacer. */}
          {/* The border is what makes the radius visible. The terminal itself is
              transparent, so the wallpaper shows both inside and outside this
              panel — without an edge there is nothing for a rounded corner to be
              seen against, which is why it read as square. Every other panel has
              one. */}
          {/* The border, radius and clip belong to the terminal alone, not to a
              box wrapping both it and the AI dock. While they shared one, the
              parent's overflow-hidden cut the dock's bottom corner off and its
              own radius could only ever show on the left two corners. They are
              two panels now, separated by the panel gap. */}
          <div
            className="relative flex min-h-0 flex-1 flex-row"
            style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
          >
            <div className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--border)]",
              prefs.panelShadows && "panel-shadow",
            )}>
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
            <TerminalAiComposer
              sessionId={tabSessionId(term.activeId)}
              onOpenInAiTab={() => setActiveKind("ai")}
              registerSend={true}
              dock="right"
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

        {/* Editor + AI pane row — AI panel overlays editor so nothing resizes when the panel toggles. */}
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
          {openFiles.length > 0 ? (
            /* Row, matching the terminal view. The composer defaults to
               dock="bottom", so leaving it in a flex-col put the AI panel under
               the editor here while the terminal had it on the right — the same
               panel in two places depending on which tab you were on. */
            <div
              className="flex h-full w-full flex-row"
              style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
            >
              <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background", prefs.neonBorderGlow && activeKind === "file" && "neon-glow", prefs.panelShadows && "panel-shadow", prefs.activePanelGlow && activeKind === "file" && "active-panel-glow active")}>
                <div className="flex-1 overflow-hidden">
                  {lazyPanel(<EditorArea files={openFiles} activePath={activeFile} />, "Editor")}
                </div>
              </div>
              <TerminalAiComposer
                sessionId={tabSessionId(term.activeId)}
                onOpenInAiTab={() => setActiveKind("ai")}
                dock="right"
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

        {/* Browser layer — native child webview parked over the placeholder.
            The panel itself decides visibility: active tab AND nothing
            covering it (settings, palette, detail panels). */}
        {openPanel === "web" && (
          <div
            className={cn(
              "absolute inset-0",
              activeKind !== "web" && "invisible pointer-events-none",
              prefs.neonBorderGlow && activeKind === "web" && "neon-glow",
            )}
            aria-hidden={activeKind !== "web"}
          >
            <ErrorBoundary>
              {lazyPanel(
                <BrowserPanel
                  visible={
                    activeKind === "web" &&
                    !chromeOccluded &&
                    !settingsOpen &&
                    !selectedK8sResource &&
                    !selectedDockerResource
                  }
                  onClose={closeBrowser}
                />,
                "Browser",
              )}
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
  );
}
