import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "../fs";
import { loadWorkflows, useWorkflows, saveWorkflows, newWorkflowId, getWorkflowLoadError, type Workflow } from "./store";
import { exportWorkflowJson } from "./transfer";
import { stageWorkflowDraft, workflowDraftFromSuggestion } from "./draftStore";
import { dismissWorkflowSuggestionFingerprint, useWorkflowSuggestions, type WorkflowSuggestion } from "./suggestions";
import { useWorkflowRunRequest, clearWorkflowRunRequest } from "./runRequest";
import { openWorkflowEditor } from "./editorActions";
import { collapseWorkflowEditor, getWorkflowEditorSession, resumeWorkflowEditor, useWorkflowEditorSession } from "./editorSession";
import { WorkflowRunner } from "./WorkflowRunner";
import { WorkflowImport } from "./WorkflowImport";
import { CompactInput } from "../components/compact-form";
import { useWorkflowLibrary, useWorkflowLibraryError, addLinkedScript, removeLinkedScript, setWorkflowPinned, setScriptPinned, removeWorkflowPin, type LinkedScript } from "./library";
import { useWorkflowRunStatuses, clearWorkflowRunStatus } from "./runStatus";
import { WorkflowLibraryItems } from "./WorkflowLibraryItems";
import { WorkflowRunOutput } from "./WorkflowRunOutput";
import { linkedScriptWorkflow } from "./linkedScripts";
import "./workflowLibrary.css";
import { Modal } from "../components/Modal";
import { toast } from "../toast";
import { useWorkspaceRoot } from "../workspace/store";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, Add01Icon, WorkflowCircle01Icon, MoreHorizontalIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { HuskContextMenu, HuskContextMenuContent, HuskContextMenuItem, HuskContextMenuTrigger } from "../components/HuskContextMenu";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

type Mode = { kind: "list" } | { kind: "run"; wf: Workflow; script?: LinkedScript } | { kind: "import" } | { kind: "output"; id: string; name: string };
const WorkflowSidebarEditor = lazy(() => import("./WorkflowSidebarEditor").then((module) => ({ default: module.WorkflowSidebarEditor })));

export function RunbooksDialog({ onClose, inline, active = true, onOpenScript }: { onClose?: () => void; inline?: boolean; active?: boolean; onOpenScript?: (path: string, name: string) => void }) {
  const workflows = useWorkflows();
  const library = useWorkflowLibrary(); const libraryError = useWorkflowLibraryError();
  const runs = useWorkflowRunStatuses();
  const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState("");
  const searchButton = useRef<HTMLButtonElement>(null); const linking = useRef(false);
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const editorSession = useWorkflowEditorSession(); const requested = useWorkflowRunRequest();
  const workspaceRoot = useWorkspaceRoot();
  const suggestions = useWorkflowSuggestions().filter((suggestion) => suggestion.workspaceRoot === workspaceRoot);
  const editing = !!editorSession && !editorSession.collapsed;
  useEffect(() => {
    if (editorSession && !editorSession.collapsed) setMode({ kind: "list" });
    // Explicit start/resume/capture only, never each draft keystroke.
  }, [editorSession?.key, editorSession?.revealRevision]);
  useEffect(() => {
    if (requested) {
      const current = getWorkflowEditorSession();
      if (current) collapseWorkflowEditor(current.key);
      setMode({ kind: "run", wf: requested }); clearWorkflowRunRequest();
    }
  }, [requested]);

  const report = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const editWorkflow = (workflow: Workflow | null) => { try { openWorkflowEditor(workflow); } catch (reason) { report(reason); } };
  const commit = async (list: Workflow[]) => {
    setBusy(true); setError("");
    try { await saveWorkflows(list); } finally { setBusy(false); }
  };
  const duplicate = async (wf: Workflow) => {
    const current = loadWorkflows(); let name = wf.name + " copy"; let suffix = 2;
    while (current.some((item) => item.name.toLowerCase() === name.toLowerCase())) name = wf.name + " copy " + suffix++;
    await commit([...current, { ...structuredClone(wf), id: newWorkflowId(), name }]);
  };
  const remove = async (wf: Workflow) => {
    if (!confirm("Delete workflow “" + wf.name + "”?")) return;
    await commit(loadWorkflows().filter((item) => item.id !== wf.id));
    clearWorkflowRunStatus(wf.id);
    try { removeWorkflowPin(wf.id); } catch (reason) { report(reason); }
  };
  const linkScript = async () => {
    if (linking.current) return;
    linking.current = true; setBusy(true); setError("");
    try {
      const path = await open({ title: "Link an existing script", multiple: false, directory: false });
      if (typeof path !== "string") return;
      addLinkedScript({ path, name: path.split(/[\\/]/).pop() || path });
      setQuery("");
    } catch (reason) { report(reason); }
    finally { linking.current = false; setBusy(false); }
  };
  const removeScript = (script: LinkedScript) => {
    if (!confirm(`Remove the link to “${script.name}”? The original file will not be deleted.`)) return;
    try { removeLinkedScript(script.id); clearWorkflowRunStatus(script.id, "script"); } catch (reason) { report(reason); }
  };
  const openScript = onOpenScript ? (script: LinkedScript) => { try { onOpenScript(script.path, script.name); } catch (reason) { report(reason); } } : undefined;
  const copy = async (value: string) => { await writeText(value); toast({ title: "Copied", variant: "success" }); };
  const exportFile = async (list: Workflow[]) => {
    setBusy(true); setError("");
    try {
      const json = exportWorkflowJson(list);
      const destination = await save({ title: "Export workflows", defaultPath: list.length === 1 ? "husk-workflow.json" : "husk-workflows.json", filters: [{ name: "Workflow JSON", extensions: ["json"] }] });
      if (!destination) return;
      await writeFile(destination, json);
      toast({ title: "Workflow JSON exported", message: destination, variant: "success" });
    } catch (reason) { report(reason); } finally { setBusy(false); }
  };
  const exportCopy = async (wf: Workflow) => { await copy(exportWorkflowJson([wf])); };
  const menuItemClass = "rounded-md px-2 py-1.5 text-[11px]";
  return <>
    {editing ? <Suspense fallback={<div className="compact-body compact-help" role="status">Opening workflow editor…</div>}><WorkflowSidebarEditor /></Suspense> : <Modal icon={WorkflowCircle01Icon} title="Workflows" context={workflows.length + " saved"} onClose={onClose} inline={inline}
      headerActions={<>
        <button ref={searchButton} type="button" aria-label="Search workflows and scripts" title="Search workflows and scripts" aria-expanded={searchOpen} disabled={mode.kind !== "list"} onClick={() => { setSearchOpen(!searchOpen); if (searchOpen) setQuery(""); }} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"><HugeiconsIcon icon={Search01Icon} size={14} /></button>
        <button type="button" aria-label="New workflow" title="New workflow" disabled={busy || mode.kind !== "list" || editorSession?.busy} onClick={() => editWorkflow(null)} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"><HugeiconsIcon icon={Add01Icon} size={14} /></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Workflow options" className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"><HugeiconsIcon icon={MoreHorizontalIcon} size={14} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border border-border"><DropdownMenuItem className={menuItemClass} disabled={busy || mode.kind !== "list" || !!libraryError} onSelect={() => void linkScript()}>Link script…</DropdownMenuItem><DropdownMenuItem className={menuItemClass} disabled={busy || mode.kind !== "list"} onSelect={() => setMode({ kind: "import" })}>Import JSON…</DropdownMenuItem><DropdownMenuItem className={menuItemClass} disabled={busy || mode.kind !== "list" || !workflows.length} onSelect={() => void exportFile(workflows)}>Export all workflows…</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </>}>
      {error && <p role="alert" className="compact-error">{error}</p>}
      {getWorkflowLoadError() && <p role="alert" className="compact-error">{getWorkflowLoadError()}</p>}
      {libraryError && <p role="alert" className="compact-error">{libraryError}</p>}
      {searchOpen && <div className="compact-form wf-library-search"><CompactInput autoFocus aria-label="Filter workflows and scripts" placeholder="Search workflows and scripts…" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setQuery(""); setSearchOpen(false); searchButton.current?.focus(); } }} /><button type="button" aria-label="Clear workflow search" onClick={() => setQuery("")} disabled={!query}>×</button></div>}
      {editorSession && <button type="button" className="workflow-sidebar-draft" onClick={resumeWorkflowEditor}>Resume draft <span>{editorSession.workflow.name || "Untitled workflow"}</span></button>}
      <div inert={busy || mode.kind !== "list" ? true : undefined}>
        <RunbookList suggestions={query.trim() ? [] : suggestions}
          onReviewSuggestion={(suggestion) => stageWorkflowDraft(workflowDraftFromSuggestion(suggestion))}
          onIgnoreSuggestion={(suggestion) => dismissWorkflowSuggestionFingerprint(suggestion.fingerprint, true)}
          onNew={() => editWorkflow(null)}
          onLinkScript={() => void linkScript()}
          libraryProps={{ workflows, library, query, runs, active,
            onEdit: editWorkflow,
            onDuplicate: (wf) => void duplicate(wf).catch(report),
            onCopyCommands: (wf) => void copy(wf.steps.join("\n")).catch(report),
            onCopyJson: (wf) => void exportCopy(wf).catch(report),
            onExport: (wf) => void exportFile([wf]),
            onDelete: (wf) => void remove(wf).catch(report),
            onRun: (wf) => setMode({ kind: "run", wf: structuredClone(wf) }),
            onPin: (kind, id, pinned) => { try { if (kind === "workflow") setWorkflowPinned(id, pinned); else setScriptPinned(id, pinned); } catch (reason) { report(reason); } },
            onOpenScript: openScript, onRemoveScript: removeScript,
            onRunScript: (script) => setMode({ kind: "run", wf: linkedScriptWorkflow(script), script }),
            onViewOutput: (id, name) => setMode({ kind: "output", id, name }),
          }} />
      </div>
    </Modal>}
    {active && !editing && mode.kind === "run" && <WorkflowRunner key={mode.wf.id} workflow={mode.wf} scriptPath={mode.script?.path} onOpenScript={mode.script && openScript ? () => openScript(mode.script!) : undefined} onClose={() => setMode((current) => current.kind === "run" && current.wf === mode.wf ? { kind: "list" } : current)} />}
    {active && !editing && mode.kind === "import" && <WorkflowImport onClose={() => setMode({ kind: "list" })} />}
    {active && !editing && mode.kind === "output" && <WorkflowRunOutput name={mode.name} run={runs.get(mode.id)} onClose={() => setMode({ kind: "list" })} />}
  </>;
}

function RunbookList({ suggestions, onNew, onLinkScript, onReviewSuggestion, onIgnoreSuggestion, libraryProps }: {
  suggestions: WorkflowSuggestion[];
  onNew: () => void; onLinkScript: () => void;
  onReviewSuggestion: (suggestion: WorkflowSuggestion) => void;
  onIgnoreSuggestion: (suggestion: WorkflowSuggestion) => void;
  libraryProps: ComponentProps<typeof WorkflowLibraryItems>;
}) {
  const empty = !libraryProps.workflows.length && !libraryProps.library.scripts.length && !libraryProps.query.trim();
  return <HuskContextMenu>
    <HuskContextMenuTrigger asChild><div className="wf-library-body">
      {suggestions.length > 0 && <div className="wf-library-suggestions">
        <h3 className="wf-library-heading">Suggested<span>local</span></h3>
        {suggestions.slice(0, 3).map((suggestion) => <div className="wf-library-suggestion" key={suggestion.id}>
          <strong>{suggestion.kind === "evolution" ? "Update " + suggestion.targetWorkflowName : "Repeated command routine"}</strong>
          <p title={suggestion.steps.join(" → ")}>{suggestion.steps.join(" → ")}</p>
          <small>Seen {suggestion.occurrences} times</small>
          <div><button type="button" onClick={() => onIgnoreSuggestion(suggestion)}>Ignore</button><button type="button" onClick={() => onReviewSuggestion(suggestion)}>Review</button></div>
        </div>)}
      </div>}
      {empty && <div className="wf-library-empty">
        <HugeiconsIcon icon={PlayIcon} size={22} />
        <strong>No workflows yet</strong>
        <p>Save repeatable commands or link an existing script. Nothing runs until you review it.</p>
      </div>}
      <WorkflowLibraryItems {...libraryProps} />
      <div className="wf-library-create">
        <button type="button" className="rb-new" onClick={onNew}>+ New workflow</button>
        <button type="button" className="rb-new" onClick={onLinkScript}>Link script…</button>
      </div>
    </div></HuskContextMenuTrigger>
    <HuskContextMenuContent title="Workflows">
      <HuskContextMenuItem icon={Add01Icon} onSelect={onNew}>New workflow…</HuskContextMenuItem>
      <HuskContextMenuItem icon={Add01Icon} onSelect={onLinkScript}>Link script…</HuskContextMenuItem>
    </HuskContextMenuContent>
  </HuskContextMenu>;
}
