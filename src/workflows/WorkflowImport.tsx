import { CompactForm, CompactTextarea, CompactSelect, CompactButton, CompactLabel } from "../components/compact-form";
import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { dirname } from "@tauri-apps/api/path";
import { readFileScoped } from "../fs";
import { loadWorkflows, saveWorkflows, type Workflow } from "./store";
import { getWorkflowImportConflicts, mergeWorkflowImport, parseWorkflowImport, type WorkflowImportChoice } from "./transfer";
import { MAX_WORKFLOW_BYTES } from "./schema";
import { WorkflowDialog } from "./WorkflowDialog";

export function WorkflowImport({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState(""); const [incoming, setIncoming] = useState<Workflow[] | null>(null);
  const [existing, setExisting] = useState<Workflow[]>([]); const [choices, setChoices] = useState<Record<number, WorkflowImportChoice>>({});
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const alive = useRef(true); const revision = useRef(0);
  const conflicts = incoming ? getWorkflowImportConflicts(existing, incoming) : [];
  let preview: Workflow[] | null = null; let previewError = "";
  try { if (incoming) preview = mergeWorkflowImport(existing, incoming, choices); } catch (reason) { previewError = String(reason); }
  const loadFile = async () => {
    const version = ++revision.current; setBusy(true); setError("");
    try {
      const path = await open({ multiple: false, filters: [{ name: "Workflow JSON", extensions: ["json"] }] });
      if (typeof path !== "string") return;
      const data = await readFileScoped(path, await dirname(path), MAX_WORKFLOW_BYTES);
      if (alive.current && revision.current === version) { setText(data); setIncoming(null); }
    } catch (reason) { if (alive.current) setError(String(reason)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <WorkflowDialog title="Import workflows" onClose={onClose} busy={busy}><CompactForm className="wf-form" ref={(element) => { alive.current = !!element; }}>
    <p className="compact-help wf-help">Choose a JSON file or paste a definition. Import only saves reviewed workflows; it never runs commands. Only import workflows from authors you trust.</p>
    <CompactButton type="button" disabled={busy} onClick={() => void loadFile()}>Choose JSON file…</CompactButton>
    <CompactLabel className="compact-field wf-field"><span>Workflow JSON (up to 1 MiB)</span><CompactTextarea rows={8} value={text} disabled={busy} spellCheck={false} placeholder='{"format":"husk-workflows","version":1,"workflows":[…]}' onChange={(event) => { revision.current++; setText(event.target.value); setIncoming(null); setError(""); }} /></CompactLabel>
    <CompactButton type="button" disabled={busy || !text.trim()} onClick={() => {
      try { const parsed = parseWorkflowImport(text); setIncoming(parsed); setExisting(structuredClone(loadWorkflows())); setChoices({}); setError(""); } catch (reason) { setIncoming(null); setError(String(reason)); }
    }}>Preview import</CompactButton>
    {incoming && <section><h3>{incoming.length} workflow{incoming.length === 1 ? "" : "s"} to review</h3>{conflicts.map(({ index, incoming: workflow, matches }) => <article key={index} className="wf-step">
      <strong>{workflow.name}</strong><p className="compact-help wf-help">{workflow.steps.length} steps · {workflow.inputs?.length ?? 0} declared inputs · {workflow.stopOnError === false ? "continue after failures" : "stop on failed step"}</p>
      <ol>{workflow.steps.map((step, i) => <li key={i}>{workflow.stepTitles?.[i] && <strong>{workflow.stepTitles[i]}</strong>}<pre>{step}</pre></li>)}</ol>
      {workflow.description && <p>{workflow.description}</p>}
      {matches.map((saved) => <details key={saved.id}><summary>Existing: {saved.name} · {saved.id}</summary><p className="compact-help wf-help">Replace overwrites these saved steps:</p>{saved.steps.map((step, i) => <pre key={i}>{i + 1}. {step}</pre>)}</details>)}
      {(workflow.inputs?.length ?? 0) > 0 && <details><summary>Input definitions</summary>{workflow.inputs!.map((input) => <p key={input.name}>{input.label} · {input.name} · {input.type} · {input.required ? "required" : "optional"}{input.defaultValue !== undefined ? " · default: " + input.defaultValue : ""}</p>)}</details>}
      <CompactLabel className="compact-field wf-field"><span>{matches.length ? "Conflicts with " + matches.map((item) => item.name).join(", ") : "Import action"}</span>
        <CompactSelect aria-label={"Import action for " + workflow.name} value={choices[index]?.action === "replace" ? "replace:" + (choices[index] as { target: Workflow }).target.id : choices[index]?.action ?? (matches.length ? "" : "keep-both")} onChange={(event) => {
          const value = event.target.value;
          setChoices((current) => ({ ...current, [index]: value.startsWith("replace:") ? { action: "replace", target: structuredClone(matches.find((item) => item.id === value.slice(8))!) } : { action: value as "keep-both" | "skip" } }));
        }}><option value="" disabled>Choose an action…</option><option value="keep-both">{matches.length ? "Keep both (rename incoming)" : "Add workflow"}</option>{matches.map((item) => <option key={item.id} value={"replace:" + item.id}>Replace {item.name} · {item.id}</option>)}<option value="skip">Skip</option></CompactSelect>
      </CompactLabel>
    </article>)}</section>}
    {preview && <details><summary>Result: {preview.length} saved workflows</summary><ul>{preview.map((wf) => <li key={wf.id}>{wf.name}</li>)}</ul></details>}
    {(error || previewError) && <p className="compact-error wf-error" role="alert">{error || previewError}</p>}
    <div className="compact-actions wf-actions"><CompactButton type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</CompactButton><CompactButton type="button" disabled={busy || !incoming || !preview || Object.values(choices).filter((choice) => choice.action === "skip").length === incoming.length} variant="primary" onClick={() => {
      if (!incoming) return; setBusy(true); setError("");
      try {
        const latest = loadWorkflows();
        if (JSON.stringify(latest) !== JSON.stringify(existing)) throw new Error("Saved workflows changed. Preview the import again before applying it.");
        const merged = mergeWorkflowImport(latest, incoming, choices);
        void saveWorkflows(merged).then(onClose).catch((reason) => { if (alive.current) setError(String(reason)); }).finally(() => { if (alive.current) setBusy(false); });
      } catch (reason) { setError(String(reason)); setBusy(false); }
    }}>{busy ? "Working…" : "Import reviewed workflows"}</CompactButton></div>
  </CompactForm></WorkflowDialog>;
}
