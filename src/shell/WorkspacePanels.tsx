import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { PencilEdit02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { TerminalStack } from "../TerminalStack";
import { TerminalBottomBar } from "../terminal/TerminalBottomBar";
import { FailureStrip } from "../terminal/FailureStrip";
import type { FailureExplainRequest } from "../terminal/FailureStrip";
import { NextStepStrip } from "../terminal/NextStepStrip";
import { RunComparisonStrip } from "../terminal/runComparisonStrip";
import { RememberFixStrip } from "../terminal/RememberFixStrip";
import { PortDetectedStrip } from "../terminal/PortDetectedStrip";
import { GitActivityStrip } from "../terminal/GitActivityStrip";
import { SensitiveOutputStrip } from "../terminal/SensitiveOutputStrip";
import { EnvironmentWarningStrip } from "../terminal/EnvironmentWarningStrip";
import { WorkflowSuggestionStrip } from "../workflows/WorkflowSuggestionStrip";
import { tabSessionId, type AiSession } from "../ai/sessionStore";
import { focusActiveTerminal, getActiveTerminalPtyId, runInActiveTerminal } from "../ai/terminalContext";
import { getSessionHandle } from "../terminal/registry";
import { TerminalLogs } from "../terminal/TerminalLogs";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { toast } from "../toast";
import { lazyPanel } from "./lazy";
import { WorkspaceDock } from "./WorkspaceDock";
import { PersistentEditor } from "./PersistentEditor";
import { NotesEditorControls, NotesOpenTabs } from "../notes/NotesEditorChrome";
import { getFileState } from "../editor/dirtyStore";
import type { NotesDockApi, NotesOpeningMode } from "../notes/useNotesDock";
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
const K8sResourceDetailPanel = lazy(() => import("../kubernetes/K8sResourceDetailPanel"));
const GitGraphPanel = lazy(() => import("../git/GitGraphPanel").then((m) => ({ default: m.GitGraphPanel })));
const IssuesPanel = lazy(() => import("../git/IssuesPanel").then((m) => ({ default: m.IssuesPanel })));
const SftpView = lazy(() => import("../remotes/SftpView").then((m) => ({ default: m.SftpView })));
const AiTabPanel = lazy(() => import("../ai/AiTabPanel").then((m) => ({ default: m.AiTabPanel })));
const BrowserPanel = lazy(() => import("../browser/BrowserPanel").then((m) => ({ default: m.BrowserPanel })));
const TerminalAiComposer = lazy(() => import("../terminal/TerminalAiComposer").then((m) => ({ default: m.TerminalAiComposer })));

export function WorkspacePanels({
  term,
  activeKind,
  selectedK8sResource,
  setSelectedK8sResource,
  selectedDockerResource,
  setSelectedDockerResource,
  prefs,
  bgDataUrl,
  openFiles,
  activeFile,
  notesDock,
  onOpenNote,
  settingsOpen,
  openPanel,
  closeSettings,
  closeGitGraph,
  closeIssues,
  closeSftp,
  closeBrowser,
  onOpenBrowser,
  onOpenSourceControl,
  onExplainFailure,
  onOpenAi,
  onReturnFromAi,
  onCloseAi,
  chromeOccluded,
}: {
  term: TerminalTabsApi;
  activeKind: ActiveKind;
  selectedK8sResource: K8sResourceSelection | null;
  setSelectedK8sResource: (sel: K8sResourceSelection | null) => void;
  selectedDockerResource: DockerResourceSelection | null;
  setSelectedDockerResource: (sel: DockerResourceSelection | null) => void;
  prefs: Prefs;
  bgDataUrl: string | null;
  openFiles: OpenFile[];
  activeFile: string | null;
  notesDock: NotesDockApi;
  onOpenNote: (path: string, name: string, line?: number, mode?: NotesOpeningMode) => void;
  settingsOpen: boolean;
  openPanel: OpenPanelKind;
  closeSettings: () => void;
  closeGitGraph: () => void;
  closeIssues: () => void;
  closeSftp: () => void;
  closeBrowser: () => void;
  onOpenBrowser: (url: string) => void;
  onOpenSourceControl: () => void;
  onExplainFailure?: (request: FailureExplainRequest) => void;
  onOpenAi: () => void;
  onReturnFromAi: (session: AiSession) => void;
  onCloseAi: () => void;
  /** True when a React surface (palette, switcher, settings, detail panels)
      can cover the browser — the native webview must be parked. */
  chromeOccluded: boolean;
}) {
  const aiLeft = prefs.aiPanelDock === "left";
  const [logsLeafId, setLogsLeafId] = useState<number | null>(null);
  const [dockTab, setDockTab] = useState<"notes" | "logs" | "details">("notes");
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockExpanded, setDockExpanded] = useState(false);
  const terminalColumnRef = useRef<HTMLDivElement>(null);
  const fileColumnRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const terminalDockRef = useRef<HTMLDivElement>(null);
  const fileDockRef = useRef<HTMLDivElement>(null);
  const otherDockRef = useRef<HTMLDivElement>(null);
  const parkingRef = useRef<HTMLDivElement>(null);
  const noteEditorRef = useRef<HTMLDivElement>(null);
  const fullEditorRef = useRef<HTMLDivElement>(null);
  const activeRoot = term.tabs.find((tab) => tab.id === term.activeId)?.root;
  const fileRoot = useMemo(() => ({ kind: "leaf" as const, id: -1 }), []);
  const editorFiles = useMemo(() => {
    const files = [...openFiles];
    for (const file of notesDock.files) if (!files.some((item) => item.path === file.path)) files.push(file);
    return files;
  }, [openFiles, notesDock.files]);
  // Let empty-files cleanup run on last close so no global Monaco model is orphaned.
  const editorStarted = useRef(false);
  if (editorFiles.length > 0) editorStarted.current = true;
  const hasDetails = !!(selectedK8sResource || selectedDockerResource);
  const hasDock = (!!notesDock.activePath && notesDock.panelRequestId > 0) || logsLeafId !== null || hasDetails;
  // A closed tool falls back to another retained tool without clearing notes.
  const activeDockTab = dockTab === "notes" && notesDock.activePath ? "notes"
    : dockTab === "logs" && logsLeafId !== null ? "logs"
      : dockTab === "details" && hasDetails ? "details"
        : notesDock.activePath ? "notes" : logsLeafId !== null ? "logs" : "details";
  const showDock = hasDock && (activeKind === "term" || activeDockTab !== "notes");
  const dockContainerRef = activeKind === "term" ? terminalColumnRef : activeKind === "file" && openFiles.length ? fileColumnRef : workspaceRef;
  const dockTargetRef = !showDock ? parkingRef : activeKind === "term" ? terminalDockRef : activeKind === "file" && openFiles.length ? fileDockRef : otherDockRef;
  const editorVisible = activeKind === "file" || (hasDock && activeKind === "term" && activeDockTab === "notes" && dockExpanded && !dockCollapsed);
  const editorPath = activeKind === "file" ? activeFile : notesDock.activePath;
  const fullTabNote = activeKind === "file" ? notesDock.files.find((file) => file.path === activeFile) : undefined;

  /* One shared dock: switching tools never stacks panels or discards drafts. */
  useEffect(() => {
    if (selectedK8sResource || selectedDockerResource) {
      setDockTab("details");
      setDockCollapsed(false);
    }
  }, [selectedK8sResource, selectedDockerResource]);

  const openLogs = useCallback((leafId: number) => {
    setLogsLeafId(leafId);
    setDockTab("logs");
    setDockCollapsed(false);
  }, []);

  useEffect(() => {
    if (notesDock.panelRequestId === 0) return;
    setDockTab("notes");
    setDockCollapsed(false);
  }, [notesDock.panelRequestId]);

  useEffect(() => {
    // A full-tab note should not also spring open below the terminal on return.
    // The explicit "Move note below terminal" action issues a new panel request.
    if (fullTabNote && activeDockTab === "notes") setDockCollapsed(true);
  }, [fullTabNote?.path, activeDockTab]);

  const selectDockTab = (tab: typeof dockTab) => {
    if (tab === "notes" && notesDock.activePath) {
      const file = notesDock.files.find((item) => item.path === notesDock.activePath)!;
      onOpenNote(file.path, file.name, undefined, "panel");
    }
    setDockTab(tab);
    setDockCollapsed(false);
  };

  const closeDockNote = (path: string) => {
    if (getFileState(path) !== "clean") {
      toast({ title: "This note has unsaved changes", message: "Save it with Cmd+S / Ctrl+S before closing. Collapsing the panel keeps your draft.", variant: "info" });
      return;
    }
    notesDock.deletePath(path); // Removes the panel tab only; never deletes a file.
  };

  const activeLeafId = term.tabs.find((tab) => tab.id === term.activeId)?.focused ?? null;

  /* Single inspector slot. The two selections used to render as two independent
     overlays at the same z-index, so both could stack on top of each other; one
     slot removes that by construction.
     Content only — each panel brings its own header, title and close. */
  const inspected = selectedK8sResource
    ? lazyPanel(
        <K8sResourceDetailPanel
          selection={selectedK8sResource}
          onNavigate={setSelectedK8sResource}
          onClose={() => setSelectedK8sResource(null)}
        />,
        "Kubernetes",
      )
    : selectedDockerResource
      ? lazyPanel(
          <DockerDetailPanel
            selection={selectedDockerResource}
            onClose={() => setSelectedDockerResource(null)}
            /* Preserved verbatim from the layer this replaces — the panel
               reports its own actions and expects the toast from here. */
            onAction={async (fn, label) => {
              await fn();
              toast({ title: label, variant: "success" });
            }}
          />,
          "Docker",
        )
      : null;

  return (
    <div
      ref={workspaceRef}
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg",
        prefs.panelShadows && "panel-shadow",
        prefs.activePanelGlow && activeKind === "term" && "active-panel-glow active",
      )}
      style={{
        marginRight: prefs.panelGaps > 0 ? `var(--panel-gaps)` : '8px',
        marginBottom: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
        marginLeft: prefs.panelGaps > 0 ? '0' : undefined,
        /* Full-page AI and Settings views intentionally hide the workspace
           breadcrumb. Give either self-contained panel the same quiet top
           margin as its bottom edge, without bringing back a redundant path bar. */
        marginTop: (activeKind === "settings" || activeKind === "ai") && prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined,
      }}
    >
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {/* Terminal layer */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col",
            /* Only the active tab decides this now. It used to also hide when a
               k8s or docker resource was selected, because detail rendered as a
               full-workspace overlay — so opening a pod hid the shell you wanted
               to run commands in. Detail lives in the inspector below instead. */
            activeKind !== "term" && "invisible pointer-events-none",
            prefs.neonBorderGlow && activeKind === "term" && "neon-glow",
          )}
          /* Gap on the column, not as a margin on either child, so the two cannot
             stack into a double-width band. */
          style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : undefined }}
          aria-hidden={activeKind !== "term"}
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
            {/* Order follows the setting: a left dock has to come first in the
                row, not just carry dock="left". */}
            {aiLeft && (
              <Suspense fallback={null}>
                <TerminalAiComposer
                  sessionId={tabSessionId(term.activeId)}
                  onOpenInAiTab={onOpenAi}
                  registerSend={true}
                  dock="left"
                />
              </Suspense>
            )}
            <div ref={terminalColumnRef} className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : "6px" }}>
            <div className={cn(
              "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              /* Split leaves own their frames. An outer frame would join them
                 back into one box and double the border on the outer edges. */
              activeRoot?.kind !== "split" && "rounded-lg border border-[var(--border)]",
              prefs.panelShadows && activeRoot?.kind !== "split" && "panel-shadow",
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
                <TerminalStack term={term} viewActive={activeKind === "term"} onOpenLogs={openLogs} />
              </ErrorBoundary>
            </div>
            <div ref={terminalDockRef} style={{ display: "contents" }} />
            </div>
            {!aiLeft && (
              <Suspense fallback={null}>
                <TerminalAiComposer
                  sessionId={tabSessionId(term.activeId)}
                  onOpenInAiTab={onOpenAi}
                  registerSend={true}
                  dock="right"
                />
              </Suspense>
            )}
          </div>
          <FailureStrip
            leafId={activeLeafId}
            onExplain={onExplainFailure}
          />
          <EnvironmentWarningStrip leafId={activeLeafId} />
          {activeKind === "term" && activeLeafId != null && <RememberFixStrip leafId={activeLeafId} onClose={() => {
            const handle = getSessionHandle(activeLeafId);
            if (handle && handle.getPtyId() != null && handle.getPtyId() === getActiveTerminalPtyId()) handle.focus();
          }} />}
          {activeLeafId != null && <RunComparisonStrip leafId={activeLeafId} aiEnabled={prefs.aiEnabled} />}
          <SensitiveOutputStrip leafId={activeLeafId} />
          <PortDetectedStrip leafId={activeLeafId} onOpenBrowser={onOpenBrowser} />
          <GitActivityStrip leafId={activeLeafId} onOpenSourceControl={onOpenSourceControl} />
          {prefs.workflowSuggestionsEnabled ? <WorkflowSuggestionStrip leafId={activeLeafId} /> : null}
          <NextStepStrip
            leafId={activeLeafId}
            aiEnabled={prefs.aiEnabled}
          />
          <TerminalBottomBar
            onSendToTerminal={(text: string) => runInActiveTerminal(text)}
            onOpenSourceControl={onOpenSourceControl}
          />
        </div>

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
              {aiLeft && (
                <Suspense fallback={null}>
                  <TerminalAiComposer
                    sessionId={tabSessionId(term.activeId)}
                    onOpenInAiTab={onOpenAi}
                    dock="left"
                  />
                </Suspense>
              )}
              <div ref={fileColumnRef} className="flex min-h-0 min-w-0 flex-1 flex-col" style={{ gap: prefs.panelGaps > 0 ? `var(--panel-gaps)` : "6px" }}>
                <div className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-background", prefs.neonBorderGlow && activeKind === "file" && "neon-glow", prefs.panelShadows && "panel-shadow", prefs.activePanelGlow && activeKind === "file" && "active-panel-glow active")}>
                  {fullTabNote && <div className="notes-full-tab-header"><NotesEditorControls notes={notesDock} path={fullTabNote.path} fullTab onMove={() => onOpenNote(fullTabNote.path, fullTabNote.name, undefined, "panel")} /></div>}
                  <div ref={fullEditorRef} className="min-h-0 flex-1 overflow-hidden" />
                </div>
                <div ref={fileDockRef} style={{ display: "contents" }} />
              </div>
              {!aiLeft && (
                <Suspense fallback={null}>
                  <TerminalAiComposer
                    sessionId={tabSessionId(term.activeId)}
                    onOpenInAiTab={onOpenAi}
                    dock="right"
                  />
                </Suspense>
              )}
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
              {lazyPanel(
                <AiTabPanel onReturnToTerminal={onReturnFromAi} onClose={onCloseAi} />,
                "Husk",
              )}
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
                {lazyPanel(<SftpView key={tab.sftpHost!} host={tab.sftpHost!} active={term.activeId === tab.id && activeKind === "sftp" && !!tab.sftpOpen} onClose={closeSftp} />, "SFTP")}
              </ErrorBoundary>
            </div>
          ) : null
        )}
      </div>

      <div ref={otherDockRef} style={{ display: "contents" }} />
      <div ref={parkingRef} hidden inert />
      {hasDock && <PersistentEditor targetRef={dockTargetRef} layout="contents">
        <WorkspaceDock containerRef={dockContainerRef} terminalRoot={activeKind === "term" ? activeRoot ?? fileRoot : fileRoot} collapsed={dockCollapsed} onCollapsedChange={setDockCollapsed} onExpandedChange={setDockExpanded} onUserCollapse={() => { if (activeKind === "term") focusActiveTerminal(); }} header={({ cramped }) => <>
          <div className="workspace-tool-tabs" data-with-note={activeDockTab === "notes"} role="group" aria-label="Workspace tools">
          {notesDock.activePath && <button type="button" className="workspace-tool-tab" aria-pressed={activeDockTab === "notes"} onClick={() => selectDockTab("notes")}>Notes</button>}
          {logsLeafId !== null && <button type="button" className="workspace-tool-tab" aria-pressed={activeDockTab === "logs"} onClick={() => selectDockTab("logs")}>Logs</button>}
          {hasDetails && <button type="button" className="workspace-tool-tab" aria-pressed={activeDockTab === "details"} onClick={() => selectDockTab("details")}>{selectedK8sResource ? "Kubernetes" : "Docker"}</button>}
          </div>
          {activeDockTab === "notes" && notesDock.activePath && <NotesEditorControls notes={notesDock} path={notesDock.activePath} cramped={cramped} onClose={() => closeDockNote(notesDock.activePath!)} onMove={() => {
            const file = notesDock.files.find((item) => item.path === notesDock.activePath)!;
            onOpenNote(file.path, file.name, undefined, "tab");
          }} />}
        </>}>
          <div className="workspace-dock-page" hidden={activeDockTab !== "notes"} inert={activeDockTab !== "notes"}>
            <NotesOpenTabs notes={notesDock} onSelect={(path, name) => onOpenNote(path, name, undefined, "panel")} onClose={closeDockNote} />
            <div ref={noteEditorRef} className="min-h-0 flex-1 overflow-hidden" />
          </div>
          <div className="workspace-dock-page" hidden={activeDockTab !== "logs"} inert={activeDockTab !== "logs"}>
            {logsLeafId !== null && <ErrorBoundary><TerminalLogs leafId={logsLeafId} onClose={() => { setLogsLeafId(null); focusActiveTerminal(); }} /></ErrorBoundary>}
          </div>
          <div className="workspace-dock-page" hidden={activeDockTab !== "details"} inert={activeDockTab !== "details"}><ErrorBoundary>{inspected}</ErrorBoundary></div>
        </WorkspaceDock>
      </PersistentEditor>}
      {editorStarted.current && <PersistentEditor targetRef={activeKind === "file" && openFiles.length ? fullEditorRef : hasDock ? noteEditorRef : parkingRef}>
        {lazyPanel(<EditorArea files={editorFiles} activePath={editorPath} visible={editorVisible} revealTarget={notesDock.revealTarget} placementKey={activeKind === "file" ? "full-tab" : "panel"} />, "Editor")}
      </PersistentEditor>}
    </div>
  );
}
