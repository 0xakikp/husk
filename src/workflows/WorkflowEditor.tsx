import { CompactForm, CompactInput, CompactTextarea, CompactSelect, CompactButton, CompactLabel } from "../components/compact-form";
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { newWorkflowId, type Workflow, type WorkflowInput } from "./store";
import { validateWorkflow } from "./schema";
import { extractParams, getWorkflowInputs } from "./params";
import { assertShareableWorkflows } from "./transfer";
import type { WorkflowDraft } from "./draftStore";
import { usePrefs } from "../settings/preferences";
import { refineWorkflowDraft } from "../ai/assist";

type Row = { key: string; command: string; title: string };
type Props = {
  initial: Workflow | null;
  draft?: WorkflowDraft | null;
  value?: Workflow;
  onChange?: (workflow: Workflow) => void;
  onSave: (workflow: Workflow) => Promise<void>;
  onCancel: () => void;
  onDiscard?: () => void;
  footerNote?: ReactNode;
  busy?: boolean;
};
function initialValue(initial: Workflow | null, draft?: WorkflowDraft | null): Workflow {
  const steps = draft?.steps ?? initial?.steps ?? [""];
  let inputs: WorkflowInput[];
  try { inputs = getWorkflowInputs({ steps, inputs: initial?.inputs }); } catch { inputs = initial?.inputs ?? []; }
  return { id: draft?.targetWorkflowId ?? initial?.id ?? newWorkflowId(), name: draft?.name ?? initial?.name ?? "", description: draft?.description ?? initial?.description ?? "", steps, stepTitles: steps.map((_, i) => draft ? "" : initial?.stepTitles?.[i] ?? ""), inputs, stopOnError: draft?.stopOnError ?? initial?.stopOnError ?? true };
}
const sourceDescriptions: Record<string, string> = {
  evolution: "Review the proposed update. Saving replaces this workflow’s steps; nothing runs.",
  "terminal-selection": "Collected from terminal text. Check that each step is a command, not output. Saving does not run it.",
  "ai-code": "Collected from AI code. Review every command; saving does not run it.",
  manual: "Collect commands here. Saving does not run them.",
  edit: "Review your workflow. Saving does not run it.",
};

export function WorkflowEditor({ initial, draft, value, onChange, onSave, onCancel, onDiscard, footerNote, busy = false }: Props) {
  const prefs = usePrefs();
  const fieldId = useId();
  const [internal, setInternal] = useState(() => initialValue(initial, draft));
  const controlled = value !== undefined && onChange !== undefined;
  const workflow = controlled ? value : internal;
  const { name, description = "", steps, inputs = [], stopOnError = true } = workflow;
  const [descriptionOpen, setDescriptionOpen] = useState(() => !!description);
  const keys = useRef<string[]>([]);
  // Keys stay stable while typing. Reorder/duplicate/delete carry them explicitly;
  // externally collected commands get keys without replacing existing fields.
  keys.current = steps.map((_, index) => keys.current[index] ?? crypto.randomUUID());
  const rows: Row[] = steps.map((command, index) => ({ key: keys.current[index], command, title: workflow.stepTitles?.[index] ?? "" }));
  const [revealedTitles, setRevealedTitles] = useState(() => new Set<string>());
  const [savePending, setSaving] = useState(false); const [refining, setRefining] = useState(false);
  // The session can still be saving after its sidebar was unmounted/reopened.
  // Keep all existing edit/action guards active until both owners are idle.
  const saving = savePending || busy;
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const editRevision = useRef(0); const alive = useRef(true);
  const currentSnapshot = useRef("");
  currentSnapshot.current = JSON.stringify(workflow);
  const textAreas = useRef(new Map<string, HTMLTextAreaElement>());
  const cursor = useRef(new Map<string, number>());
  const change = (next: Workflow) => {
    editRevision.current++; setTouched(true); setNotice(""); setError("");
    if (controlled) onChange(next); else setInternal(next);
  };
  const changeRows = (next: Row[]) => {
    keys.current = next.map((item) => item.key);
    change({ ...workflow, steps: next.map((item) => item.command), stepTitles: next.map((item) => item.title) });
  };
  const inferred = extractParams(steps);
  const missing = inferred.filter((param) => !inputs.some((input) => input.name === param.name));
  // The draft retains raw fields (including blank steps). Only the saved value is
  // normalized, so collapsing or collecting another command cannot lose edits.
  const candidate = useMemo(() => ({ ...workflow, name: name.trim() }), [workflow, name]);
  let validation = "";
  try { validateWorkflow(candidate); assertShareableWorkflows([candidate]); } catch (reason) { validation = reason instanceof Error ? reason.message : String(reason); }
  const showValidation = touched || !!name.trim() || steps.some((step) => !!step.trim()) || inputs.length > 0;
  const move = (index: number, offset: number) => {
    const next = [...rows]; [next[index], next[index + offset]] = [next[index + offset], next[index]]; changeRows(next);
  };
  const insert = (item: Row, inputName: string) => {
    if (!inputName) return;
    const field = textAreas.current.get(item.key); const position = cursor.current.get(item.key) ?? item.command.length;
    const token = "{{" + inputName + "}}";
    changeRows(rows.map((entry) => entry.key === item.key ? { ...entry, command: entry.command.slice(0, position) + token + entry.command.slice(position) } : entry));
    requestAnimationFrame(() => { field?.focus(); field?.setSelectionRange(position + token.length, position + token.length); });
  };
  const updateInput = (index: number, patch: Partial<WorkflowInput>) => change({ ...workflow, inputs: inputs.map((input, i) => i === index ? { ...input, ...patch } : input) });
  return <CompactForm className="wf-form" ref={(element) => { alive.current = element !== null; }}>
    {draft && <details className="wf-disclosure"><summary>About this draft</summary><p className="compact-help wf-help">{sourceDescriptions[draft.source] ?? "Draft from local command history. Review every command; saving does not run it."}</p>
      {draft.originalSteps && <details><summary>Previously saved steps</summary><pre>{draft.originalSteps.join("\n")}</pre></details>}
      {prefs.aiEnabled && <CompactButton type="button" disabled={refining || saving || !!validation} onClick={() => {
        const revision = editRevision.current; const snapshot = currentSnapshot.current; setRefining(true); setError("");
        void refineWorkflowDraft(name, description, candidate.steps).then((refined) => {
          if (!alive.current) return;
          if (editRevision.current !== revision || currentSnapshot.current !== snapshot) { setNotice("AI result discarded because the draft changed. Your changes were kept."); return; }
          keys.current = refined.steps.map(() => crypto.randomUUID());
          change({ ...workflow, name: refined.name, description: refined.description, steps: refined.steps, stepTitles: refined.steps.map(() => "") });
          setNotice("AI refined the draft. Review every step and input before saving.");
        }).catch((reason) => { if (alive.current) setError(String(reason)); }).finally(() => { if (alive.current) setRefining(false); });
      }}>{refining ? "Refining…" : "Refine visible steps with AI"}</CompactButton>}
    </details>}
    <div className="compact-field">
      <CompactLabel htmlFor={fieldId + "-name"}>Name</CompactLabel>
      <CompactInput id={fieldId + "-name"} aria-label="Workflow name" disabled={saving} value={name} placeholder="Review recent commits" onChange={(event) => change({ ...workflow, name: event.target.value })} />
    </div>
    <details className="wf-disclosure" open={descriptionOpen} onToggle={(event) => setDescriptionOpen(event.currentTarget.open)}><summary>Description (optional)</summary>
      <div className="compact-field"><CompactLabel htmlFor={fieldId + "-description"}>Description</CompactLabel><CompactInput id={fieldId + "-description"} disabled={saving} value={description} placeholder="What this workflow does" onChange={(event) => change({ ...workflow, description: event.target.value })} /></div>
    </details>
    <fieldset className="compact-section" disabled={saving}><legend className="compact-label">Steps</legend>
      {rows.map((item, index) => <article className="wf-step" key={item.key}>
        <div className="wf-step-head"><span className="compact-label">Step {index + 1}</span><span className="wf-step-actions">
          <CompactButton type="button" compact icon variant="ghost" aria-label={"Move step " + (index + 1) + " up"} disabled={index === 0} onClick={() => move(index, -1)}>↑</CompactButton>
          <CompactButton type="button" compact icon variant="ghost" aria-label={"Move step " + (index + 1) + " down"} disabled={index === rows.length - 1} onClick={() => move(index, 1)}>↓</CompactButton>
          <CompactButton type="button" compact disabled={rows.length >= 100} aria-label={"Duplicate step " + (index + 1)} onClick={() => changeRows([...rows.slice(0, index + 1), { ...item, key: crypto.randomUUID() }, ...rows.slice(index + 1)])}>Duplicate</CompactButton>
          <CompactButton type="button" compact variant="danger" disabled={rows.length === 1} aria-label={"Delete step " + (index + 1)} onClick={() => changeRows(rows.filter((entry) => entry.key !== item.key))}>Delete</CompactButton>
        </span></div>
        {item.title || revealedTitles.has(item.key) ? <CompactInput aria-label={"Step " + (index + 1) + " title"} placeholder="Step title (optional)" value={item.title} onChange={(event) => changeRows(rows.map((entry) => entry.key === item.key ? { ...entry, title: event.target.value } : entry))} /> : <CompactButton className="wf-step-title-toggle" type="button" compact variant="ghost" aria-label={"Add title to step " + (index + 1)} onClick={() => setRevealedTitles((current) => new Set([...current, item.key]))}>Add title</CompactButton>}
        <CompactTextarea aria-label={"Step " + (index + 1) + " command"} rows={2} value={item.command} spellCheck={false} placeholder="git log -n {{count}} --oneline"
          ref={(element) => { if (element) textAreas.current.set(item.key, element); else textAreas.current.delete(item.key); }}
          onSelect={(event) => cursor.current.set(item.key, event.currentTarget.selectionStart)}
          onChange={(event) => changeRows(rows.map((entry) => entry.key === item.key ? { ...entry, command: event.target.value } : entry))} />
        {inputs.length > 0 && <CompactSelect aria-label={"Insert input in step " + (index + 1)} value="" onChange={(event) => insert(item, event.target.value)}><option value="">Insert input…</option>{inputs.filter((input) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(input.name)).map((input, i) => <option key={i} value={input.name}>{input.label || input.name}</option>)}</CompactSelect>}
      </article>)}
      <CompactButton type="button" disabled={rows.length >= 100} onClick={() => changeRows([...rows, { key: crypto.randomUUID(), command: "", title: "" }])}>+ Add step</CompactButton>
    </fieldset>
    <details className="wf-disclosure"><summary>Inputs{inputs.length > 0 ? ` · ${inputs.length}` : " (optional)"}{missing.length > 0 ? ` · ${missing.length} detected` : ""}</summary>
    <fieldset className="compact-section" disabled={saving}><legend className="compact-label">Reusable values</legend><p className="compact-help wf-help">Define labels and validation, then use Insert input in a command. Renaming an input does not rewrite its placeholders. Runtime values are never saved.</p>
      {missing.length > 0 && <div className="wf-scope">Detected placeholders: {missing.map((param) => param.name).join(", ")} <CompactButton type="button" onClick={() => change({ ...workflow, inputs: [...inputs, ...missing.map((param): WorkflowInput => ({ name: param.name, label: param.name, type: "text", required: param.default === null, defaultValue: param.default ?? undefined }))] })}>Configure detected inputs</CompactButton></div>}
      {inputs.map((input, index) => <article className="wf-input-card" key={index}>
        {input.name && !inferred.some((param) => param.name === input.name) && <p className="compact-help wf-help">Not used in a step yet. Insert this input into a command, or remove it.</p>}
        <div className="wf-input-grid">
        <div className="compact-field"><CompactLabel htmlFor={fieldId + "-input-name-" + index}>Input name</CompactLabel><CompactInput id={fieldId + "-input-name-" + index} value={input.name} placeholder="count" onChange={(event) => updateInput(index, { name: event.target.value })} /></div>
        <div className="compact-field"><CompactLabel htmlFor={fieldId + "-input-label-" + index}>Label</CompactLabel><CompactInput id={fieldId + "-input-label-" + index} value={input.label} placeholder="Number of commits" onChange={(event) => updateInput(index, { label: event.target.value })} /></div>
        <div className="compact-field"><CompactLabel htmlFor={fieldId + "-input-type-" + index}>Type</CompactLabel><CompactSelect id={fieldId + "-input-type-" + index} value={input.type} onChange={(event) => updateInput(index, { type: event.target.value as WorkflowInput["type"], ...(event.target.value === "secret" ? { defaultValue: undefined } : {}) })}>{["text", "number", "path", "secret"].map((type) => <option key={type}>{type}</option>)}</CompactSelect></div>
        {input.type !== "secret" ? <div className="compact-field"><CompactLabel htmlFor={fieldId + "-input-default-" + index}>Default (optional)</CompactLabel><CompactInput id={fieldId + "-input-default-" + index} value={input.defaultValue ?? ""} onChange={(event) => updateInput(index, { defaultValue: event.target.value })} /></div> : <p className="compact-help wf-help">Secrets are entered only at run time; no saved default.</p>}
      </div><div className="wf-step-head"><CompactLabel className="compact-check wf-check"><input type="checkbox" checked={input.required} onChange={(event) => updateInput(index, { required: event.target.checked })} />Required</CompactLabel><CompactButton type="button" compact variant="danger" onClick={() => change({ ...workflow, inputs: inputs.filter((_, i) => i !== index) })}>Remove input</CompactButton></div></article>)}
      <CompactButton type="button" disabled={inputs.length >= 32} onClick={() => change({ ...workflow, inputs: [...inputs, { name: "", label: "", type: "text", required: true }] })}>+ Add input</CompactButton>
    </fieldset></details>
    <details className="wf-disclosure"><summary>Execution options</summary><fieldset className="compact-section" disabled={saving}>
      <p className="compact-help wf-help">One command line per card. Input values are literal arguments. Steps share a POSIX child shell; directory changes and variables do not change your interactive terminal.</p>
      <CompactLabel className="compact-check wf-check"><input type="checkbox" checked={stopOnError} onChange={(event) => change({ ...workflow, stopOnError: event.target.checked })} />Stop when a step fails</CompactLabel>
    </fieldset></details>
    {showValidation && validation && <p className="compact-help wf-warning" role="status">{validation}</p>}{error && <p className="compact-error wf-error" role="alert">{error}</p>}{notice && <p className="compact-help wf-help" role="status">{notice}</p>}
    <div className="compact-actions wf-actions">
      {onDiscard && <CompactButton type="button" variant="danger" className="compact-action-start" disabled={saving || refining} onClick={onDiscard}>Discard draft</CompactButton>}
      <div className="compact-actions-main"><CompactButton type="button" variant="ghost" disabled={saving} onClick={onCancel}>Collapse</CompactButton><CompactButton type="button" variant="primary" disabled={saving || refining || !!validation} onClick={() => {
      setSaving(true); setError(""); void onSave(validateWorkflow(candidate)).catch((reason) => { if (alive.current) setError(String(reason)); }).finally(() => { if (alive.current) setSaving(false); });
    }}>{saving ? "Saving…" : draft?.source === "evolution" ? "Save update" : "Save workflow"}</CompactButton></div></div>
    {footerNote != null && <div className="compact-help">{footerNote}</div>}
  </CompactForm>;
}
