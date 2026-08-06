import { useEffect, useMemo, useState } from "react";
import { loadWorkflows, saveWorkflows, newWorkflowId, type Workflow } from "./store";
import { composeCommand, extractParams } from "./params";
import { runInActiveTerminal } from "../ai/terminalContext";
import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  PlayIcon,
  Edit02Icon,
  Delete02Icon,
  Add01Icon,
  InformationCircleIcon,
  WorkflowCircle01Icon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; wf: Workflow | null }
  | { kind: "run"; wf: Workflow };

export function RunbooksDialog({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [workflows, setWorkflows] = useState<Workflow[]>(() => loadWorkflows());
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const editing = mode.kind === "edit" && !!inline;

  const saveWorkflow = (wf: Workflow) => {
    setWorkflows((prev) => {
      const i = prev.findIndex((w) => w.id === wf.id);
      if (i === -1) return [...prev, wf];
      const next = [...prev];
      next[i] = wf;
      return next;
    });
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

  const listHeaderActions = (
    <button
      type="button"
      aria-label="New workflow"
      title="New workflow"
      onClick={() => setMode({ kind: "edit", wf: null })}
      className="inline-flex size-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <HugeiconsIcon icon={Add01Icon} size={16} strokeWidth={1.5} />
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
              mode.wf ? "Edit Workflow" : "New Workflow"
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
                    <p>Save multi-step shell commands and run them instantly from any terminal.</p>
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
              onNew={() => setMode({ kind: "edit", wf: null })}
              onEdit={(wf) => setMode({ kind: "edit", wf })}
              onDelete={(id) => setWorkflows((prev) => prev.filter((w) => w.id !== id))}
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
              initial={mode.wf}
              onCancel={() => setMode({ kind: "list" })}
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
          title={mode.wf ? "Edit Workflow" : "New Workflow"}
          onClose={() => setMode({ kind: "list" })}
          inline={false}
        >
          <RunbookEditor
            initial={mode.wf}
            onCancel={() => setMode({ kind: "list" })}
            onSave={(wf) => {
              setWorkflows((prev) => {
                const i = prev.findIndex((w) => w.id === wf.id);
                if (i === -1) return [...prev, wf];
                const next = [...prev];
                next[i] = wf;
                return next;
              });
              setMode({ kind: "list" });
            }}
          />
        </Modal>
      )}
    </>
  );
}

function RunbookList({
  workflows,
  onNew,
  onEdit,
  onDelete,
  onRun,
}: {
  workflows: Workflow[];
  onNew: () => void;
  onEdit: (wf: Workflow) => void;
  onDelete: (id: string) => void;
  onRun: (wf: Workflow) => void;
}) {
  return (
    <div className="modal-body">
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
            {workflows.map((wf) => (
              <div key={wf.id} className="rb-item">
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
                <button type="button" className="ai-icon" onClick={() => onDelete(wf.id)} title="Delete">
                  <HugeiconsIcon icon={Delete02Icon} size={11} strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
          <button type="button" className="rb-new" onClick={onNew}>
            + New workflow
          </button>
        </div>
      )}
    </div>
  );
}

type Row = { id: string; value: string };
const makeRow = (value = ""): Row => ({
  id: Math.random().toString(36).slice(2, 9),
  value,
});

function RunbookEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: Workflow | null;
  onSave: (wf: Workflow) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [rows, setRows] = useState<Row[]>(
    initial && initial.steps.length ? initial.steps.map((s) => makeRow(s)) : [makeRow()],
  );
  const [stopOnError, setStopOnError] = useState(initial?.stopOnError !== false);

  const cleaned = rows.map((r) => r.value.trim()).filter((s) => s.length > 0);
  const params = useMemo(() => extractParams(rows.map((r) => r.value)), [rows]);
  const valid = name.trim().length > 0 && cleaned.length > 0;

  return (
    <div className="modal-body">
      <label className="rb-field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Deploy API" />
      </label>

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
          {params.length > 0
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
              id: initial?.id ?? newWorkflowId(),
              name: name.trim(),
              steps: cleaned,
              stopOnError,
            })
          }
        >
          Save
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
