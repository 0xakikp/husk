import { lazy, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FileExplorer } from "../explorer/FileExplorer";
import { SidebarRail, type SidebarViewId } from "../sidebar/SidebarRail";
import { stageLocalToolCommandWithNotice } from "../tools-hub/stageLocalToolCommand";
import { shq } from "../lib/shellQuote";
import { lazyPanel } from "./lazy";
import { SHEET_HOST_ID, SidebarSheetContext } from "../components/sheetHost";
import type { Prefs } from "../settings/preferences";
import type { K8sResourceSelection } from "../kubernetes/KubernetesView";
import type { K8sBrowseRequest } from "../kubernetes/useK8sNavigation";
import type { DockerResourceSelection } from "../docker/DockerDetailPanel";

const SourceControlPanel = lazy(() => import("../git/SourceControlPanel").then((m) => ({ default: m.SourceControlPanel })));
const RemotesView = lazy(() => import("../remotes/RemotesView").then((m) => ({ default: m.RemotesView })));
const RunbooksDialog = lazy(() => import("../workflows/RunbooksDialog").then((m) => ({ default: m.RunbooksDialog })));
const ToolsHubView = lazy(() => import("../tools-hub/ToolsHubView").then((m) => ({ default: m.ToolsHubView })));
const KubernetesView = lazy(() => import("../kubernetes/KubernetesView").then((m) => ({ default: m.KubernetesView })));
const DockerView = lazy(() => import("../docker/DockerView").then((m) => ({ default: m.DockerView })));
const TailscaleView = lazy(() => import("../tailscale/TailscaleView").then((m) => ({ default: m.TailscaleView })));
const NotesView = lazy(() => import("../notes/NotesView").then((m) => ({ default: m.NotesView })));
const TimelineView = lazy(() => import("../timeline/TimelineView").then((m) => ({ default: m.TimelineView })));

/** Every view the rail can select, in a stable order. */
const VIEW_IDS: SidebarViewId[] = [
  "explorer",
  "source-control",
  "remotes",
  "workflows",
  "tools-hub",
  "kubernetes",
  "docker",
  "tailscale",
  "vault",
  "timeline",
];

export function SidebarHost({
  explorerOpen,
  explorerWidth,
  sidebarView,
  prefs,
  bgDataUrl,
  activeFile,
  remoteHost,
  openFile,
  openLocalFile,
  openGitGraph,
  openIssues,
  openSftp,
  openTotp,
  openBrowser,
  setSelectedK8sResource,
  selectedK8sResource = null,
  lastK8sResource = null,
  k8sBrowseRequest = null,
  onK8sBrowseSelectionChange,
  setSelectedDockerResource,
  persistSidebarView,
  cycleSidebarView,
  setExplorerWidth,
  persistSidebarWidth,
  sidebarMinWidth,
  sidebarMaxWidth,
}: {
  explorerOpen: boolean;
  explorerWidth: number;
  sidebarView: SidebarViewId;
  prefs: Prefs;
  bgDataUrl: string | null;
  activeFile: string | null;
  remoteHost: string | null;
  openFile: (path: string, name: string) => void;
  openLocalFile?: (path: string, name: string) => void;
  openGitGraph: () => void;
  openIssues: () => void;
  openSftp: (host: string) => void;
  openTotp: () => void;
  openBrowser: (url: string) => void;
  setSelectedK8sResource: (sel: K8sResourceSelection | null) => void;
  selectedK8sResource?: K8sResourceSelection | null;
  lastK8sResource?: K8sResourceSelection | null;
  k8sBrowseRequest?: K8sBrowseRequest | null;
  onK8sBrowseSelectionChange?: () => void;
  setSelectedDockerResource: (sel: DockerResourceSelection | null) => void;
  persistSidebarView: (view: SidebarViewId) => void;
  cycleSidebarView: (view: SidebarViewId) => void;
  setExplorerWidth: (width: number) => void;
  persistSidebarWidth: (width: number) => void;
  sidebarMinWidth: number;
  sidebarMaxWidth: number;
  typeInActiveTerminal: (text: string) => boolean;
}) {
  /* Retain only views that have actually been opened. In particular, restoring
     a closed sidebar must not start tools in its remembered view. */
  const [visited, setVisited] = useState<Set<SidebarViewId>>(() => new Set(explorerOpen ? [sidebarView] : []));
  useEffect(() => {
    if (!explorerOpen) return;
    setVisited((prev) => (prev.has(sidebarView) ? prev : new Set(prev).add(sidebarView)));
  }, [explorerOpen, sidebarView]);

  return (
    <>
      <div
        /* Positioned + identified so sidebar-launched forms can portal in here
           and fill the panel instead of floating over the app — see
           components/sheetHost. */
        id={SHEET_HOST_ID}
        className={cn(
          "relative flex flex-col border-r border-[var(--border)] overflow-hidden rounded-lg",
          prefs.frostedGlass && bgDataUrl
            ? "bg-background/50 backdrop-blur-md"
            : "bg-background/95",
          prefs.animationsEnabled && "animate-sidebar-enter",
          prefs.neonBorderGlow && "neon-glow",
          prefs.panelShadows && "panel-shadow",
        )}
        style={{
          display: explorerOpen ? undefined : "none",
          width: explorerWidth,
          minWidth: sidebarMinWidth,
          maxWidth: sidebarMaxWidth,
          margin: prefs.panelGaps > 0 ? `var(--panel-gaps) 0 var(--panel-gaps) var(--panel-gaps)` : undefined,
        }}
      >
        {/* Everything in here is "inside the sidebar", so any Modal a view
            opens renders as a panel sheet rather than a centred dialog. */}
        <SidebarSheetContext.Provider value={true}>
        {/* Every visited view stays mounted and is hidden with display:none when
            another is selected or the entire sidebar is collapsed.

            This was a single ternary, so only the active view existed — clicking
            Notes did not hide Kubernetes, it destroyed it. Coming back re-ran
            every kubectl and threw away the context, namespace, tab and scroll
            position you had. TerminalStack already solves this one layer up for
            terminal tabs ("so its PTYs and scrollback survive switching"); the
            sidebar simply never got the same treatment.

            Mounted on first visit rather than all at once, so opening Husk does
            not shell out to Docker or Kubernetes before you ask for them. */}
        <div className="min-h-0 flex-1 overflow-hidden">
          {VIEW_IDS.filter((id) => visited.has(id)).map((id) => (
            <div
              key={id}
              className="h-full"
              /* display:none, not `invisible`: hidden views must not take
                 layout, and their state has to survive untouched. */
              style={id === sidebarView ? undefined : { display: "none" }}
            >
              {id === "explorer" ? (
                <div className="h-full overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <FileExplorer onOpenFile={openFile} activeFile={activeFile} remoteHost={remoteHost} />
                </div>
              ) : id === "source-control" ? (
                lazyPanel(<SourceControlPanel inline onOpenGitGraph={openGitGraph} onOpenIssues={openIssues} />, "Source Control")
              ) : id === "remotes" ? (
                lazyPanel(<RemotesView inline onSftp={(h) => openSftp(h)} />, "Remotes")
              ) : id === "workflows" ? (
                lazyPanel(<RunbooksDialog inline active={explorerOpen && sidebarView === "workflows"} onOpenScript={openLocalFile} />, "Workflows")
              ) : id === "tools-hub" ? (
                lazyPanel(
                  <ToolsHubView
                    active={explorerOpen && sidebarView === "tools-hub"}
                    onSelectView={(v) => persistSidebarView(v)}
                    onTypeCommand={(cmd) => { void stageLocalToolCommandWithNotice(cmd); }}
                    onOpenTotp={openTotp}
                    onOpenBrowser={openBrowser}
                  />,
                  "Tools",
                )
              ) : id === "kubernetes" ? (
                lazyPanel(
                  <KubernetesView
                    inline
                    onBack={() => persistSidebarView("tools-hub")}
                    onInspectResource={setSelectedK8sResource}
                    selectedResource={selectedK8sResource}
                    lastResource={lastK8sResource}
                    browseRequest={k8sBrowseRequest}
                    onBrowseSelectionChange={onK8sBrowseSelectionChange}
                  />,
                  "Kubernetes",
                )
              ) : id === "docker" ? (
                lazyPanel(
                  <DockerView
                    inline
                    onBack={() => persistSidebarView("tools-hub")}
                    /* The only view with a timer. Kept mounted it would poll
                       `docker ps` every 5s while you were reading Notes. */
                    active={explorerOpen && sidebarView === "docker"}
                    onInspectResource={(sel) => setSelectedDockerResource(sel)}
                  />,
                  "Docker",
                )
              ) : id === "tailscale" ? (
                lazyPanel(
                  <TailscaleView
                    inline
                    onBack={() => persistSidebarView("tools-hub")}
                    onConnect={(device) => {
                      const sshUser = device.user || "root";
                      void stageLocalToolCommandWithNotice(`ssh -l ${shq(sshUser)} -- ${shq(device.ipv4)}`);
                    }}
                  />,
                  "Tailscale",
                )
              ) : id === "vault" ? (
                lazyPanel(<NotesView inline onOpenFile={(path, name) => openFile(path, name)} />, "Notes")
              ) : id === "timeline" ? (
                lazyPanel(<TimelineView inline />, "Timeline")
              ) : null}
            </div>
          ))}
        </div>
        </SidebarSheetContext.Provider>
        <SidebarRail
          view={sidebarView}
          onSelectView={(v) => cycleSidebarView(v)}
        />
      </div>
      {/* Sidebar resize handle */}
      {explorerOpen && <div
        className={cn(
          /* The visible divider stays slim; the pseudo-element supplies a
             forgiving hit target so resizing does not require finding 1px. */
          "husk-resize-seam husk-resize-seam-vertical relative flex shrink-0 cursor-col-resize items-center justify-center bg-border/60 hover:bg-border",
          prefs.panelGaps > 0 ? "w-2" : "w-px",
        )}
        role="separator"
        tabIndex={0}
        aria-label="Resize sidebar"
        aria-orientation="vertical"
        aria-valuemin={sidebarMinWidth}
        aria-valuemax={sidebarMaxWidth}
        aria-valuenow={explorerWidth}
        title="Drag or use arrow keys to resize sidebar"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const next = event.key === "Home" ? sidebarMinWidth : event.key === "End" ? sidebarMaxWidth
            : Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, explorerWidth + (event.key === "ArrowRight" ? 24 : -24)));
          setExplorerWidth(next); persistSidebarWidth(next);
        }}
        onMouseDown={(e) => {
          e.preventDefault();
          const startX = e.clientX;
          const startW = explorerWidth;
          let final = startW;
          const onMove = (ev: globalThis.MouseEvent) => {
            final = Math.min(sidebarMaxWidth, Math.max(sidebarMinWidth, startW + (ev.clientX - startX)));
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
      />}
    </>
  );
}
