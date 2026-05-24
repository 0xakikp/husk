import { useEffect, useMemo, useState } from "react";
import { loadWorkflows, saveWorkflows, newWorkflowId, type Workflow } from "./store";
import { composeCommand, extractParams } from "./params";
import { runInActiveTerminal } from "../ai/terminalContext";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; wf: Workflow | null }
  | { kind: "run"; wf: Workflow };

export function RunbooksDialog({ onClose }: { onClose: () => void }) {
  const [workflows, setWorkflows] = useState<Workflow[]>(() => loadWorkflows());
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  useEffect(() => saveWorkflows(workflows), [workflows]);

  const run = (wf: Workflow, values: Record<string, string>) => {
    const cmd = composeCommand(wf.steps, values, { stopOnError: wf.stopOnError !== false });
    if (cmd && runInActiveTerminal(cmd)) onClose();
  };

  const startRun = (wf: Workflow) => {
    if (extractParams(wf.steps).length > 0) setMode({ kind: "run", wf });
    else run(wf, {});
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-label="Runbooks"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>Runbooks</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        {mode.kind === "list" ? (
          <RunbookList
            workflows={workflows}
            onNew={() => setMode({ kind: "edit", wf: null })}
            onEdit={(wf) => setMode({ kind: "edit", wf })}
            onDelete={(id) => setWorkflows((prev) => prev.filter((w) => w.id !== id))}
            onRun={startRun}
          />
        ) : mode.kind === "edit" ? (
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
        ) : (
          <RunbookRunner wf={mode.wf} onCancel={() => setMode({ kind: "list" })} onRun={run} />
        )}
      </div>
    </div>
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
        <p className="rb-empty">
          No runbooks yet. Create multi-step command sequences with
          {" {{parameters}} "}
          you fill in at run time.
        </p>
      ) : (
        <div className="rb-list">
          {workflows.map((wf) => (
            <div key={wf.id} className="rb-item">
              <button type="button" className="rb-run" title="Run" onClick={() => onRun(wf)}>
                ▶
              </button>
              <div className="rb-meta">
                <span className="rb-name">{wf.name}</span>
                <span className="rb-steps">
                  {wf.steps.length} step{wf.steps.length === 1 ? "" : "s"}
                </span>
              </div>
              <button type="button" className="ai-icon" onClick={() => onEdit(wf)}>
                ✎
              </button>
              <button type="button" className="ai-icon" onClick={() => onDelete(wf.id)}>
                🗑
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" className="rb-new" onClick={onNew}>
        + New runbook
      </button>
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
          <button type="button" onClick={() => setRows((r) => [...r, makeRow()])}>
            + step
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
            >
              ×
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
