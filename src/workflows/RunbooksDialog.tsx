import { lazy, Suspense, useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "../fs";
import { loadWorkflows, useWorkflows, saveWorkflows, newWorkflowId, getWorkflowLoadError, type Workflow } from "./store";
import { extractParams } from "./params";
import { exportWorkflowJson } from "./transfer";
import { stageWorkflowDraft, workflowDraftFromSuggestion } from "./draftStore";
import { dismissWorkflowSuggestionFingerprint, useWorkflowSuggestions, type WorkflowSuggestion } from "./suggestions";
import { useWorkflowRunRequest, clearWorkflowRunRequest } from "./runRequest";
import { openWorkflowEditor } from "./editorActions";
import { collapseWorkflowEditor, getWorkflowEditorSession, resumeWorkflowEditor, useWorkflowEditorSession } from "./editorSession";
import { WorkflowRunner } from "./WorkflowRunner";
import { WorkflowImport } from "./WorkflowImport";
import { Modal } from "../components/Modal";
import { toast } from "../toast";
import { useWorkspaceRoot } from "../workspace/store";
import { HugeiconsIcon } from "@hugeicons/react";
import { PlayIcon, Edit02Icon, Delete02Icon, Add01Icon, WorkflowCircle01Icon, Copy01Icon, RepeatIcon, MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HuskContextMenu, HuskContextMenuContent, HuskContextMenuItem, HuskContextMenuSeparator, HuskContextMenuTrigger } from "../components/HuskContextMenu";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

type Mode = { kind: "list" } | { kind: "run"; wf: Workflow } | { kind: "import" };
const WorkflowSidebarEditor = lazy(() => import("./WorkflowSidebarEditor").then((module) => ({ default: module.WorkflowSidebarEditor })));

export function RunbooksDialog({ onClose, inline, active = true }: { onClose?: () => void; inline?: boolean; active?: boolean }) {
  const workflows = useWorkflows();
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
  };
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
        <button type="button" aria-label="New workflow" title="New workflow" disabled={busy || mode.kind !== "list" || editorSession?.busy} onClick={() => editWorkflow(null)} className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"><HugeiconsIcon icon={Add01Icon} size={14} /></button>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="Workflow options" className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted"><HugeiconsIcon icon={MoreHorizontalIcon} size={14} /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border border-border"><DropdownMenuItem className={menuItemClass} disabled={busy || mode.kind !== "list"} onSelect={() => setMode({ kind: "import" })}>Import JSON…</DropdownMenuItem><DropdownMenuItem className={menuItemClass} disabled={busy || mode.kind !== "list" || !workflows.length} onSelect={() => void exportFile(workflows)}>Export all workflows…</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </>}>
      {error && <p role="alert" className="compact-error">{error}</p>}
      {getWorkflowLoadError() && <p role="alert" className="compact-error">{getWorkflowLoadError()}</p>}
      {editorSession && <button type="button" className="workflow-sidebar-draft" onClick={resumeWorkflowEditor}>Resume draft <span>{editorSession.workflow.name || "Untitled workflow"}</span></button>}
      <div inert={busy || mode.kind !== "list" ? true : undefined}>
        <RunbookList workflows={workflows} suggestions={suggestions}
          onReviewSuggestion={(suggestion) => stageWorkflowDraft(workflowDraftFromSuggestion(suggestion))}
          onIgnoreSuggestion={(suggestion) => dismissWorkflowSuggestionFingerprint(suggestion.fingerprint, true)}
          onNew={() => editWorkflow(null)}
          onEdit={editWorkflow}
          onDuplicate={(wf) => void duplicate(wf).catch(report)}
          onCopyCommands={(wf) => void copy(wf.steps.join("\n")).catch(report)}
          onCopyJson={(wf) => void exportCopy(wf).catch(report)}
          onExport={(wf) => void exportFile([wf])}
          onDelete={(wf) => void remove(wf).catch(report)}
          onRun={(wf) => setMode({ kind: "run", wf: structuredClone(wf) })} />
      </div>
    </Modal>}
    {active && !editing && mode.kind === "run" && <WorkflowRunner key={mode.wf.id} workflow={mode.wf} onClose={() => setMode((current) => current.kind === "run" && current.wf === mode.wf ? { kind: "list" } : current)} />}
    {active && !editing && mode.kind === "import" && <WorkflowImport onClose={() => setMode({ kind: "list" })} />}
  </>;
}

function RunbookList({
  workflows,
  suggestions,
  onNew,
  onReviewSuggestion,
  onIgnoreSuggestion,
  onEdit,
  onDuplicate,
  onCopyCommands,
  onCopyJson,
  onExport,
  onDelete,
  onRun,
}: {
  workflows: Workflow[];
  suggestions: WorkflowSuggestion[];
  onNew: () => void;
  onReviewSuggestion: (suggestion: WorkflowSuggestion) => void;
  onIgnoreSuggestion: (suggestion: WorkflowSuggestion) => void;
  onEdit: (wf: Workflow) => void;
  onDuplicate: (wf: Workflow) => void;
  onCopyCommands: (wf: Workflow) => void;
  onCopyJson: (wf: Workflow) => void;
  onExport: (wf: Workflow) => void;
  onDelete: (wf: Workflow) => void;
  onRun: (wf: Workflow) => void;
}) {
  return (
    <HuskContextMenu>
      <HuskContextMenuTrigger asChild>
        <div className="modal-body min-h-full">
      {suggestions.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1.5">
          <div className="flex items-center justify-between px-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-primary/80">
            <span>Suggested</span>
            <span className="tabular-nums text-muted-foreground/60">local</span>
          </div>
          {suggestions.slice(0, 3).map((suggestion) => (
            <div key={suggestion.id} className="rounded-md border border-primary/25 bg-primary/[0.06] p-2">
              <div className="flex items-start gap-2">
                <HugeiconsIcon icon={WorkflowCircle01Icon} size={14} strokeWidth={1.7} className="mt-0.5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10.5px] text-foreground">
                    {suggestion.kind === "evolution" ? `Update ${suggestion.targetWorkflowName}` : "Repeated command routine"}
                  </p>
                  <p className="mt-0.5 truncate text-[9.5px] text-muted-foreground" title={suggestion.steps.join(" → ")}>
                    {suggestion.steps.join(" → ")}
                  </p>
                  <p className="mt-1 text-[9px] text-muted-foreground/65">
                    {suggestion.kind === "evolution"
                      ? `${suggestion.steps.length - suggestion.originalSteps.length} added step${suggestion.steps.length - suggestion.originalSteps.length === 1 ? "" : "s"} · seen ${suggestion.occurrences} times`
                      : `seen ${suggestion.occurrences} times across ${suggestion.sessionCount} terminals`}
                  </p>
                </div>
              </div>
              <div className="mt-1.5 flex justify-end gap-1">
                <button type="button" className="rounded px-1.5 py-0.5 text-[9.5px] text-muted-foreground hover:bg-muted/40 hover:text-foreground" onClick={() => onIgnoreSuggestion(suggestion)}>ignore</button>
                <button type="button" className="rounded bg-primary/12 px-1.5 py-0.5 text-[9.5px] text-primary hover:bg-primary/20" onClick={() => onReviewSuggestion(suggestion)}>
                  {suggestion.kind === "evolution" ? "review update" : "review"}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex size-10 items-center justify-center rounded-full bg-primary/10">
            <HugeiconsIcon icon={PlayIcon} size={20} className="text-primary" />
          </div>
          <p className="text-[12px] font-medium text-foreground">No workflows yet</p>
          <p className="max-w-[180px] text-[11px] text-muted-foreground">
            Create multi-step command sequences with {"{{parameters}}"} you fill in at run time.
          </p>
          <button
            type="button"
            onClick={onNew}
            className="h-7 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            New workflow
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="rb-list">
            {workflows.map((wf) => {
              const hasParameters = extractParams(wf.steps).length > 0;
              return (
                <HuskContextMenu key={wf.id}>
                  <HuskContextMenuTrigger asChild>
                    <div className="rb-item" onContextMenu={(event) => event.stopPropagation()}>
                      <button type="button" className="rb-run" title="Review & run" aria-label={"Review & run " + wf.name} onClick={() => onRun(wf)}>
                        <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
                      </button>
                      <div className="rb-meta">
                        <span className="rb-name">{wf.name}</span>
                        <span className="rb-steps">
                          {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <button type="button" className="ai-icon" onClick={() => onEdit(wf)} title="Edit" aria-label={"Edit " + wf.name}>
                        <HugeiconsIcon icon={Edit02Icon} size={11} strokeWidth={2} />
                      </button>
                      <button type="button" className="ai-icon" onClick={() => onDelete(wf)} title="Delete" aria-label={"Delete " + wf.name}>
                        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
                      </button>
                    </div>
                  </HuskContextMenuTrigger>
                  <HuskContextMenuContent title={wf.name}>
                    <HuskContextMenuItem icon={PlayIcon} onSelect={() => onRun(wf)}>
                      {hasParameters ? "Fill inputs & review…" : "Review & run…"}
                    </HuskContextMenuItem>
                    <HuskContextMenuItem icon={Edit02Icon} onSelect={() => onEdit(wf)}>Edit workflow…</HuskContextMenuItem>
                    <HuskContextMenuItem icon={RepeatIcon} onSelect={() => onDuplicate(wf)}>Duplicate</HuskContextMenuItem>
                    <HuskContextMenuSeparator />
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => onCopyCommands(wf)}>Copy step templates</HuskContextMenuItem>
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => onCopyJson(wf)}>Copy workflow JSON</HuskContextMenuItem>
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => onExport(wf)}>Export JSON…</HuskContextMenuItem>
                    <HuskContextMenuSeparator />
                    <HuskContextMenuItem icon={Delete02Icon} danger onSelect={() => onDelete(wf)}>Delete workflow…</HuskContextMenuItem>
                  </HuskContextMenuContent>
                </HuskContextMenu>
              );
            })}
          </div>
          <button type="button" className="rb-new" onClick={onNew}>
            + New workflow
          </button>
        </div>
      )}
        </div>
      </HuskContextMenuTrigger>
      <HuskContextMenuContent title="Workflows">
        <HuskContextMenuItem icon={Add01Icon} onSelect={onNew}>New workflow…</HuskContextMenuItem>
      </HuskContextMenuContent>
    </HuskContextMenu>
  );
}
