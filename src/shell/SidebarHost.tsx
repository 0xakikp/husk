import { lazy, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { FileExplorer } from "../explorer/FileExplorer";
import { SidebarRail, type SidebarViewId } from "../sidebar/SidebarRail";
import { runInActiveTerminal } from "../ai/terminalContext";
import { lazyPanel } from "./lazy";
import { SHEET_HOST_ID, SidebarSheetContext } from "../components/sheetHost";
import type { Prefs } from "../settings/preferences";
import type { K8sResourceSelection } from "../kubernetes/KubernetesView";
import type { DockerResourceSelection } from "../docker/DockerDetailPanel";

const SourceControlPanel = lazy(() => import("../git/SourceControlPanel").then((m) => ({ default: m.SourceControlPanel })));
const RemotesView = lazy(() => import("../remotes/RemotesView").then((m) => ({ default: m.RemotesView })));
const RunbooksDialog = lazy(() => import("../workflows/RunbooksDialog").then((m) => ({ default: m.RunbooksDialog })));
const ToolsHubView = lazy(() => import("../tools-hub/ToolsHubView").then((m) => ({ default: m.ToolsHubView })));
const KubernetesView = lazy(() => import("../kubernetes/KubernetesView").then((m) => ({ default: m.KubernetesView })));
const CiCdDialog = lazy(() => import("../ci-cd/CiCdDialog").then((m) => ({ default: m.CiCdDialog })));
const TerraformView = lazy(() => import("../terraform/TerraformView").then((m) => ({ default: m.TerraformView })));
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
  "ci-cd",
  "terraform",
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
  openGitGraph,
  openIssues,
  openSftp,
  openTotp,
  setSelectedK8sResource,
  setSelectedDockerResource,
  persistSidebarView,
  cycleSidebarView,
  setExplorerWidth,
  persistSidebarWidth,
  sidebarMinWidth,
  sidebarMaxWidth,
  typeInActiveTerminal,
}: {
  explorerOpen: boolean;
  explorerWidth: number;
  sidebarView: SidebarViewId;
  prefs: Prefs;
  bgDataUrl: string | null;
  activeFile: string | null;
  remoteHost: string | null;
  openFile: (path: string, name: string) => void;
  openGitGraph: () => void;
  openIssues: () => void;
  openSftp: (host: string) => void;
  openTotp: () => void;
  setSelectedK8sResource: (sel: K8sResourceSelection | null) => void;
  setSelectedDockerResource: (sel: DockerResourceSelection | null) => void;
  persistSidebarView: (view: SidebarViewId) => void;
  cycleSidebarView: (view: SidebarViewId) => void;
  setExplorerWidth: (width: number) => void;
  persistSidebarWidth: (width: number) => void;
  sidebarMinWidth: number;
  sidebarMaxWidth: number;
  typeInActiveTerminal: (text: string) => boolean;
}) {
  /* Grows as you visit views and never shrinks, so returning to one is instant.
     Seeded with the current view so the first render mounts exactly one. */
  const [visited, setVisited] = useState<Set<SidebarViewId>>(() => new Set([sidebarView]));
  useEffect(() => {
    setVisited((prev) => (prev.has(sidebarView) ? prev : new Set(prev).add(sidebarView)));
  }, [sidebarView]);

  /* Must come after the hooks above: an early return before them would change
     the hook order between renders. */
  if (!explorerOpen) return null;

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
            another is selected.

            This was a single ternary, so only the active view existed — clicking
            Notes did not hide Kubernetes, it destroyed it. Coming back re-ran
            every kubectl and threw away the context, namespace, tab and scroll
            position you had. TerminalStack already solves this one layer up for
            terminal tabs ("so its PTYs and scrollback survive switching"); the
            sidebar simply never got the same treatment.

            Mounted on first visit rather than all at once, so opening Husk does
            not shell out to docker, kubectl and terraform before you ask for
            them. */}
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
                lazyPanel(<RunbooksDialog inline />, "Workflows")
              ) : id === "tools-hub" ? (
                lazyPanel(
                  <ToolsHubView
                    onSelectView={(v) => persistSidebarView(v)}
                    onTypeCommand={(cmd) => typeInActiveTerminal(cmd)}
                    onRunCommand={(cmd) => runInActiveTerminal(cmd)}
                    onOpenTotp={openTotp}
                  />,
                  "Plugins",
                )
              ) : id === "kubernetes" ? (
                lazyPanel(
                  <KubernetesView inline onInspectResource={(sel) => setSelectedK8sResource(sel)} />,
                  "Kubernetes",
                )
              ) : id === "ci-cd" ? (
                lazyPanel(<CiCdDialog inline />, "CI/CD")
              ) : id === "terraform" ? (
                lazyPanel(<TerraformView inline />, "Terraform")
              ) : id === "docker" ? (
                lazyPanel(
                  <DockerView
                    inline
                    /* The only view with a timer. Kept mounted it would poll
                       `docker ps` every 5s while you were reading Notes. */
                    active={sidebarView === "docker"}
                    onInspectResource={(sel) => setSelectedDockerResource(sel)}
                  />,
                  "Docker",
                )
              ) : id === "tailscale" ? (
                lazyPanel(
                  <TailscaleView
                    inline
                    onConnect={(device) => {
                      const sshUser = device.user || "root";
                      typeInActiveTerminal(`ssh ${sshUser}@${device.ipv4}`);
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
      <div
        className={cn(
          /* The visible divider stays slim; the pseudo-element supplies a
             forgiving hit target so resizing does not require finding 1px. */
          "relative flex shrink-0 cursor-col-resize items-center justify-center bg-border/60 before:absolute before:inset-y-0 before:-inset-x-[4px] before:content-[''] hover:bg-border",
          prefs.panelGaps > 0 ? "w-2" : "w-px",
        )}
        title="Drag to resize sidebar"
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
      />
    </>
  );
}
