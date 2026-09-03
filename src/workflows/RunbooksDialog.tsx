import { useEffect, useMemo, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { loadWorkflows, saveWorkflows, newWorkflowId, type Workflow } from "./store";
import { composeCommand, extractParams } from "./params";
import {
  clearWorkflowDraft,
  stageWorkflowDraft,
  useWorkflowDraft,
  workflowDraftFromSuggestion,
  type WorkflowDraft,
} from "./draftStore";
import {
  dismissWorkflowSuggestionFingerprint,
  useWorkflowSuggestions,
  type WorkflowSuggestion,
} from "./suggestions";
import { refineWorkflowDraft } from "../ai/assist";
import { scanForSecrets } from "../ai/contextItems";
import { runInActiveTerminal } from "../ai/terminalContext";
import { Modal } from "../components/Modal";
import { usePrefs } from "../settings/preferences";
import { toast } from "../toast";
import { useWorkspaceRoot } from "../workspace/store";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  Edit02Icon,
  Delete02Icon,
  Add01Icon,
  InformationCircleIcon,
  WorkflowCircle01Icon,
  SparklesIcon,
  Copy01Icon,
  RepeatIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  HuskContextMenu,
  HuskContextMenuContent,
  HuskContextMenuItem,
  HuskContextMenuSeparator,
  HuskContextMenuTrigger,
} from "../components/HuskContextMenu";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; wf: Workflow | null }
  | { kind: "run"; wf: Workflow };

export function RunbooksDialog({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [workflows, setWorkflows] = useState<Workflow[]>(() => loadWorkflows());
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const draft = useWorkflowDraft();
  const workspaceRoot = useWorkspaceRoot();
  const suggestions = useWorkflowSuggestions().filter((suggestion) => suggestion.workspaceRoot === workspaceRoot);
  const editing = mode.kind === "edit" && !!inline;

  useEffect(() => {
    if (draft) {
      const target = draft.targetWorkflowId
        ? workflows.find((workflow) => workflow.id === draft.targetWorkflowId) ?? null
        : null;
      setMode({ kind: "edit", wf: target });
    }
  }, [draft, workflows]);

  const editorTitle = draft?.source === "evolution"
    ? "Review Workflow Update"
    : mode.kind === "edit" && mode.wf
      ? "Edit Workflow"
      : draft
        ? "Review Workflow"
        : "New Workflow";

  const saveWorkflow = (wf: Workflow) => {
    setWorkflows((prev) => {
      const i = prev.findIndex((w) => w.id === wf.id);
      if (i === -1) return [...prev, wf];
      const next = [...prev];
      next[i] = wf;
      return next;
    });
    if (draft?.fingerprint) dismissWorkflowSuggestionFingerprint(draft.fingerprint);
    clearWorkflowDraft();
    setMode({ kind: "list" });
  };

  const cancelEdit = () => {
    clearWorkflowDraft();
    setMode({ kind: "list" });
  };

  useEffect(() => saveWorkflows(workflows), [workflows]);

  const run = (wf: Workflow, values: Record<string, string>) => {
    const cmd = composeCommand(wf.steps, values, { stopOnError: wf.stopOnError !== false });
    if (cmd && runInActiveTerminal(cmd)) onClose?.();
  };

  const startRun = (wf: Workflow) => {
    if (extractParams(wf.steps).length > 0) setMode({ kind: "run", wf });
    else run(wf, {});
  };

  const duplicateWorkflow = (workflow: Workflow) => {
    setWorkflows((current) => {
      const base = `${workflow.name} copy`;
      let name = base;
      let copyNumber = 2;
      const names = new Set(current.map((item) => item.name.toLocaleLowerCase()));
      while (names.has(name.toLocaleLowerCase())) name = `${base} ${copyNumber++}`;
      return [...current, { ...workflow, id: newWorkflowId(), name }];
    });
    toast({ title: `Duplicated ${workflow.name}`, variant: "success" });
  };

  const copyWorkflowCommands = async (workflow: Workflow) => {
    const separator = workflow.stopOnError === false ? "; \\\n  " : " && \\\n  ";
    try {
      await writeText(workflow.steps.join(separator));
      toast({ title: "Workflow commands copied", variant: "success" });
    } catch (error) {
      toast({ title: "Could not copy commands", message: String(error), variant: "error" });
    }
  };

  const copyWorkflowJson = async (workflow: Workflow) => {
    try {
      await writeText(JSON.stringify(workflow, null, 2));
      toast({ title: "Workflow JSON copied", message: "Ready to paste into a file or share.", variant: "success" });
    } catch (error) {
      toast({ title: "Could not copy workflow", message: String(error), variant: "error" });
    }
  };

  const deleteWorkflow = (workflow: Workflow) => {
    if (!confirm(`Delete workflow “${workflow.name}”?`)) return;
    setWorkflows((current) => current.filter((item) => item.id !== workflow.id));
    toast({ title: `Deleted ${workflow.name}`, variant: "success" });
  };

  const listHeaderActions = (
    <button
      type="button"
      aria-label="New workflow"
      title="New workflow"
      onClick={() => setMode({ kind: "edit", wf: null })}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Add01Icon} size={14} strokeWidth={1.5} />
    </button>
  );

  return (
    <>
      <TooltipProvider delayDuration={200}>
        <Modal
          icon={WorkflowCircle01Icon}
          context={editing ? undefined : `${workflows.length} saved`}
          title={
            editing ? (
              editorTitle
            ) : (
            <div className="flex items-center gap-1.5">
              <span>Workflows</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="What is this?"
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} size={13} strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  align="start"
                  sideOffset={6}
                  className="max-w-[260px] border border-border/60 bg-zinc-950 text-zinc-100 text-[10.5px] p-2.5 shadow-lg"
                >
                  <div className="flex flex-col gap-1.5">
                    <p className="font-medium text-foreground">Workflows</p>
                    <p>Save multi-step shell commands and run them instantly from any terminal. Husk can notice repeated safe routines, offer a reviewable draft, and suggest updating a workflow when you consistently add steps.</p>
                    <div className="rounded bg-muted/40 px-1.5 py-1 font-mono text-[10px]">
                      {"cd ~/{{service}} && git pull && make deploy"}
                    </div>
                    <p>Inject values at runtime with {"{{"}param{"}}"} or {"{{"}param=default{"}}"}.</p>
                    <p className="text-muted-foreground">Tip: chain commands with && or ; and each workflow will stop on error unless configured otherwise.</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </div>
            )
          }
          onClose={onClose}
          inline={inline}
          headerActions={mode.kind === "list" ? listHeaderActions : undefined}
        >
          {mode.kind === "list" ? (
            <RunbookList
              workflows={workflows}
              suggestions={suggestions}
              onReviewSuggestion={(suggestion) => stageWorkflowDraft(workflowDraftFromSuggestion(suggestion))}
              onIgnoreSuggestion={(suggestion) => dismissWorkflowSuggestionFingerprint(suggestion.fingerprint, true)}
              onNew={() => setMode({ kind: "edit", wf: null })}
              onEdit={(wf) => setMode({ kind: "edit", wf })}
              onDuplicate={duplicateWorkflow}
              onCopyCommands={(workflow) => void copyWorkflowCommands(workflow)}
              onCopyJson={(workflow) => void copyWorkflowJson(workflow)}
              onDelete={deleteWorkflow}
              onRun={startRun}
            />
          ) : mode.kind === "run" ? (
            <RunbookRunner wf={mode.wf} onCancel={() => setMode({ kind: "list" })} onRun={run} />
          ) : editing ? (
            /* In the sidebar the editor fills the panel, the same way the runner
               above already does. It used to open as a centred popup while the
               panel sat behind showing "Opening editor…", which is two surfaces
               for one action. Outside the sidebar there is no panel to fill, so
               the popup below still handles it. */
            <RunbookEditor
              key={draft?.fingerprint ?? mode.wf?.id ?? "new-workflow"}
              initial={mode.wf}
              draft={draft}
              onCancel={cancelEdit}
              onSave={saveWorkflow}
            />
          ) : (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <p className="text-[12px] text-muted-foreground">Opening editor…</p>
            </div>
          )}
        </Modal>
      </TooltipProvider>

      {/* Non-inline only: in the sidebar this renders in the panel above. */}
      {mode.kind === "edit" && !inline && (
        <Modal
          title={editorTitle}
          onClose={cancelEdit}
          inline={false}
        >
          <RunbookEditor
            key={draft?.fingerprint ?? mode.wf?.id ?? "new-workflow"}
            initial={mode.wf}
            draft={draft}
            onCancel={cancelEdit}
            onSave={(wf) => {
              setWorkflows((prev) => {
                const i = prev.findIndex((w) => w.id === wf.id);
                if (i === -1) return [...prev, wf];
                const next = [...prev];
                next[i] = wf;
                return next;
              });
              setMode({ kind: "list" });
              if (draft?.fingerprint) dismissWorkflowSuggestionFingerprint(draft.fingerprint);
              clearWorkflowDraft();
            }}
          />
        </Modal>
      )}
    </>
  );
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
                      <button type="button" className="rb-run" title="Run" onClick={() => onRun(wf)}>
                        <HugeiconsIcon icon={PlayIcon} size={11} strokeWidth={2} />
                      </button>
                      <div className="rb-meta">
                        <span className="rb-name">{wf.name}</span>
                        <span className="rb-steps">
                          {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <button type="button" className="ai-icon" onClick={() => onEdit(wf)} title="Edit">
                        <HugeiconsIcon icon={Edit02Icon} size={11} strokeWidth={2} />
                      </button>
                      <button type="button" className="ai-icon" onClick={() => onDelete(wf)} title="Delete">
                        <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
                      </button>
                    </div>
                  </HuskContextMenuTrigger>
                  <HuskContextMenuContent title={wf.name}>
                    <HuskContextMenuItem icon={PlayIcon} onSelect={() => onRun(wf)}>
                      {hasParameters ? "Fill values & run…" : "Run workflow"}
                    </HuskContextMenuItem>
                    <HuskContextMenuItem icon={Edit02Icon} onSelect={() => onEdit(wf)}>Edit workflow…</HuskContextMenuItem>
                    <HuskContextMenuItem icon={RepeatIcon} onSelect={() => onDuplicate(wf)}>Duplicate</HuskContextMenuItem>
                    <HuskContextMenuSeparator />
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => onCopyCommands(wf)}>Copy commands</HuskContextMenuItem>
                    <HuskContextMenuItem icon={Copy01Icon} onSelect={() => onCopyJson(wf)}>Copy workflow JSON</HuskContextMenuItem>
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

type Row = { id: string; value: string };
const makeRow = (value = ""): Row => ({
  id: Math.random().toString(36).slice(2, 9),
  value,
});

function addedWorkflowSteps(original: string[], proposed: string[]): string[] {
  const remaining = [...original];
  return proposed.filter((step) => {
    const index = remaining.indexOf(step);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
}

function RunbookEditor({
  initial,
  draft,
  onSave,
  onCancel,
}: {
  initial: Workflow | null;
  draft?: WorkflowDraft | null;
  onSave: (wf: Workflow) => void;
  onCancel: () => void;
}) {
  const prefs = usePrefs();
  const [name, setName] = useState(draft?.name ?? initial?.name ?? "");
  const [description, setDescription] = useState(draft?.description ?? initial?.description ?? "");
  const [rows, setRows] = useState<Row[]>(
    draft?.steps.length
      ? draft.steps.map((s) => makeRow(s))
      : initial?.steps.length
        ? initial.steps.map((s) => makeRow(s))
        : [makeRow()],
  );
  const [stopOnError, setStopOnError] = useState(draft?.stopOnError ?? initial?.stopOnError ?? true);
  const [refining, setRefining] = useState(false);

  const cleaned = rows.map((r) => r.value.trim()).filter((s) => s.length > 0);
  const params = useMemo(() => extractParams(rows.map((r) => r.value)), [rows]);
  const sensitiveReasons = useMemo(
    () => scanForSecrets("workflow steps", rows.map((row) => row.value).join("\n")),
    [rows],
  );
  const addedSteps = useMemo(
    () => draft?.source === "evolution"
      ? addedWorkflowSteps(draft.originalSteps ?? [], cleaned)
      : [],
    [cleaned, draft],
  );
  const valid = name.trim().length > 0 && cleaned.length > 0 && sensitiveReasons.length === 0;

  return (
    <div className="modal-body">
      <label className="rb-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploy API" />
      </label>

      <label className="rb-field">
        <span>Description <small className="text-muted-foreground/60">optional</small></span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this workflow does" />
      </label>

      {draft ? (
        <div className="rounded-md border border-primary/20 bg-primary/[0.05] px-2 py-1.5 text-[9.5px] leading-relaxed text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1">
              {draft.source === "evolution"
                ? `Husk noticed that you repeatedly extended this workflow. Saving replaces its ${draft.originalSteps?.length ?? 0} steps with the reviewed ${cleaned.length}-step version; nothing runs now.`
                : "Husk prepared this from local command history. Review every step; nothing runs when you save it."}
            </span>
            {prefs.aiEnabled ? (
              <button
                type="button"
                disabled={refining}
                className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
                title="Send only these visible, redacted steps to the selected model for a clearer name and optional parameters"
                onClick={() => {
                  if (refining || cleaned.length < 1) return;
                  setRefining(true);
                  void refineWorkflowDraft(name, description, cleaned)
                    .then((refined) => {
                      setName(refined.name);
                      setDescription(refined.description);
                      setRows(refined.steps.map((step) => makeRow(step)));
                      toast({ title: "Workflow refined", message: "Review the updated name, parameters, and every command before saving.", variant: "success" });
                    })
                    .catch((error) => toast({ title: "Could not refine workflow", message: error instanceof Error ? error.message : String(error), variant: "error" }))
                    .finally(() => setRefining(false));
                }}
              >
                <HugeiconsIcon icon={SparklesIcon} size={10} strokeWidth={1.75} />
                {refining ? "refining…" : "refine with AI"}
              </button>
            ) : null}
          </div>
          {draft.source === "evolution" ? (
            <div className="mt-1.5 border-t border-primary/15 pt-1.5">
              <div className="mb-1 flex items-center gap-1.5 uppercase tracking-[0.12em] text-muted-foreground/65">
                <span>{draft.originalSteps?.length ?? 0} saved</span>
                <span className="text-primary">→</span>
                <span>{cleaned.length} proposed</span>
              </div>
              {addedSteps.length > 0 ? (
                <div className="flex flex-col gap-0.5">
                  {addedSteps.map((step, index) => (
                    <div key={`${step}:${index}`} className="flex min-w-0 items-baseline gap-1.5">
                      <span className="shrink-0 font-semibold text-primary">+</span>
                      <code className="min-w-0 truncate text-foreground/80" title={step}>{step}</code>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rb-field">
        <div className="rb-steps-head">
          <span>Steps</span>
          <button
            type="button"
            onClick={() => setRows((r) => [...r, makeRow()])}
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <HugeiconsIcon icon={Add01Icon} size={10} strokeWidth={2} />
            step
          </button>
        </div>
        {rows.map((row, i) => (
          <div key={row.id} className="rb-step">
            <span className="rb-step-n">{i + 1}</span>
            <textarea
              value={row.value}
              rows={1}
              placeholder={i === 0 ? "cd ~/{{service}} && git pull" : "docker compose up -d"}
              onChange={(e) =>
                setRows((r) => r.map((x) => (x.id === row.id ? { ...x, value: e.target.value } : x)))
              }
            />
            <button
              type="button"
              className="ai-icon"
              disabled={rows.length === 1}
              onClick={() => setRows((r) => (r.length === 1 ? r : r.filter((x) => x.id !== row.id)))}
              title="Remove step"
            >
              <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
            </button>
          </div>
        ))}
        <p className="rb-hint">
          {sensitiveReasons.length > 0
            ? `Possible ${sensitiveReasons.join(", ")} detected. Replace credentials with a runtime parameter before saving.`
            : params.length > 0
            ? `Parameters: ${params.map((p) => p.name).join(", ")}`
            : "Use {{name}} or {{name=default}} to prompt at run time."}
        </p>
      </div>

      <label className="rb-check">
        <input
          type="checkbox"
          checked={stopOnError}
          onChange={(e) => setStopOnError(e.target.checked)}
        />
        <span>Stop on first failure (chain with &&)</span>
      </label>

      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="primary"
          disabled={!valid}
          onClick={() =>
            onSave({
              id: draft?.targetWorkflowId ?? initial?.id ?? newWorkflowId(),
              name: name.trim(),
              description: description.trim() || undefined,
              steps: cleaned,
              stopOnError,
            })
          }
        >
          {draft?.source === "evolution" ? "Save update" : "Save"}
        </button>
      </div>
    </div>
  );
}

function RunbookRunner({
  wf,
  onRun,
  onCancel,
}: {
  wf: Workflow;
  onRun: (wf: Workflow, values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const params = useMemo(() => extractParams(wf.steps), [wf]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const p of params) seed[p.name] = p.default ?? "";
    return seed;
  });

  const preview = composeCommand(wf.steps, values, { stopOnError: wf.stopOnError !== false });

  return (
    <div className="modal-body">
      <p className="rb-run-title">Run: {wf.name}</p>
      {params.map((p) => (
        <label key={p.name} className="rb-field">
          <span className="rb-param">{p.name}</span>
          <input
            value={values[p.name] ?? ""}
            placeholder={p.default ?? `value for ${p.name}`}
            onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))}
          />
        </label>
      ))}
      <div className="rb-field">
        <span>Preview</span>
        <code className="rb-preview">{preview || "—"}</code>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Back
        </button>
        <button
          type="button"
          className="primary"
          disabled={!preview}
          onClick={() => onRun(wf, values)}
        >
          ▶ Run
        </button>
      </div>
    </div>
  );
}
