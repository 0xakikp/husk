import { lazy } from "react";
import { cn } from "@/lib/utils";
import { FileExplorer } from "../explorer/FileExplorer";
import { SidebarRail, type SidebarViewId } from "../sidebar/SidebarRail";
import { lazyPanel } from "./lazy";
import { SHEET_HOST_ID } from "../components/sheetHost";
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
const BookmarksView = lazy(() => import("../bookmarks/BookmarksView").then((m) => ({ default: m.BookmarksView })));

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
  setSelectedK8sResource,
  setSelectedDockerResource,
  persistSidebarView,
  cycleSidebarView,
  setPaletteOpen,
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
  setSelectedK8sResource: (sel: K8sResourceSelection | null) => void;
  setSelectedDockerResource: (sel: DockerResourceSelection | null) => void;
  persistSidebarView: (view: SidebarViewId) => void;
  cycleSidebarView: (view: SidebarViewId) => void;
  setPaletteOpen: (open: boolean) => void;
  setExplorerWidth: (width: number) => void;
  persistSidebarWidth: (width: number) => void;
  sidebarMinWidth: number;
  sidebarMaxWidth: number;
  typeInActiveTerminal: (text: string) => boolean;
}) {
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
