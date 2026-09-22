import { CompactForm, CompactInput, CompactButton, CompactLabel } from "../components/compact-form";
import { useEffect, useState } from "react";
import { subscribeTerminalState } from "../ai/terminalContext";
import { compileWorkflow, getWorkflowInputs } from "./params";
import { captureWorkflowTarget, executeWorkflow, workflowTargetError } from "./execution";
import type { Workflow } from "./store";
import { WorkflowDialog } from "./WorkflowDialog";

export function WorkflowRunner({ workflow, onClose }: { workflow: Workflow; onClose: () => void }) {
  let inputError = ""; let inputs: ReturnType<typeof getWorkflowInputs> = [];
  try { inputs = getWorkflowInputs(workflow); } catch (reason) { inputError = String(reason); }
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map((input) => [input.name, input.defaultValue ?? ""])));
  const [target, setTarget] = useState(captureWorkflowTarget);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [showSecrets, setShowSecrets] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => subscribeTerminalState(() => { setConfirmed(false); setError(""); }), []);
  let compiled: ReturnType<typeof compileWorkflow> | null = null; let validation = inputError;
  try { if (!validation) compiled = compileWorkflow(workflow, values); } catch (reason) { validation = reason instanceof Error ? reason.message : String(reason); }
  const targetError = workflowTargetError(target);
  const hasSecret = inputs.some((input) => input.type === "secret" && values[input.name]);
  let displaySteps = compiled?.steps ?? workflow.steps;
  if (hasSecret && !showSecrets && compiled) {
    try { displaySteps = compileWorkflow(workflow, { ...values, ...Object.fromEntries(inputs.filter((input) => input.type === "secret").map((input) => [input.name, "[hidden secret]"])) }).steps; } catch { displaySteps = workflow.steps; }
  }
  return <WorkflowDialog title={"Review workflow · " + workflow.name} onClose={onClose} busy={busy}>
    <CompactForm className="wf-form">
      <section className="wf-scope"><h3>Target terminal</h3>
        <p>{target ? (target.scope.isRemote ? "SSH · " + target.scope.host : "Local shell") + " · terminal " + target.leafId : "No verified terminal"}</p>
        <code>{target?.scope.cwd || "Directory unknown"}</code>
        <CompactButton type="button" disabled={busy} onClick={() => { setTarget(captureWorkflowTarget()); setConfirmed(false); setError(""); }}>Refresh target</CompactButton>
        {targetError && <p className="compact-help wf-warning" role="status">{targetError}</p>}
      </section>
      {inputs.length > 0 && <section><h3>Runtime inputs</h3><div className="wf-input-grid">{inputs.map((input) => <CompactLabel key={input.name} className="compact-field wf-field"><span>{input.label}{input.required ? " *" : " (optional)"}</span>
        <CompactInput type={input.type === "secret" ? "password" : "text"} inputMode={input.type === "number" ? "decimal" : undefined} value={values[input.name] ?? ""} autoComplete="off" spellCheck={false} disabled={busy}
          onChange={(event) => { setValues((current) => ({ ...current, [input.name]: event.target.value })); setConfirmed(false); setError(""); }} />
      </CompactLabel>)}</div></section>}
      <section><h3>{compiled ? "Expanded steps" : "Steps · complete inputs to preview"}</h3>
        <p className="compact-help wf-help">Runs in one POSIX sh process on the target. Directory/environment changes carry between steps, not back to your prompt. {workflow.stopOnError === false ? "Continues after a failed step." : "Stops when a step returns a nonzero exit status."} Each card’s final status determines success.</p>
        {hasSecret && <><p className="compact-help wf-warning">Secret values are not saved in Husk workflow definitions, but the submitted command can appear in shell history, process arguments, and terminal output.</p><CompactLabel className="compact-check wf-check"><input type="checkbox" checked={showSecrets} onChange={(event) => setShowSecrets(event.target.checked)} />Reveal secrets in preview</CompactLabel></>}
        {displaySteps.map((step, index) => <article className="wf-step" key={index}><strong>{index + 1}. {workflow.stepTitles?.[index] || "Command"}</strong><pre>{step}</pre></article>)}
        {compiled && <details><summary>Exact submitted command{hasSecret && !showSecrets ? " (hidden until secrets are revealed)" : ""}</summary>{(!hasSecret || showSecrets) && <pre>{compiled.command}</pre>}</details>}
      </section>
      {validation && <p role="alert" className="compact-error wf-error">{validation}</p>}{error && <p role="alert" className="compact-error wf-error">{error}</p>}
      <CompactLabel className="compact-check wf-check"><input type="checkbox" checked={confirmed} disabled={busy || !compiled} onChange={(event) => setConfirmed(event.target.checked)} />I reviewed these commands and the target. Run only workflows I trust.</CompactLabel>
      <div className="compact-actions wf-actions"><CompactButton type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</CompactButton><CompactButton type="button" variant="primary" disabled={busy || !compiled || !target || !!targetError || !confirmed} onClick={() => {
        if (!compiled) return; const command = compiled.command;
        setBusy(true); setError("");
        void executeWorkflow(workflow, values, target, command).then(onClose).catch((reason) => { setError(reason instanceof Error ? reason.message : String(reason)); setConfirmed(false); }).finally(() => setBusy(false));
      }}>{busy ? "Submitting…" : "Run reviewed workflow"}</CompactButton></div>
    </CompactForm>
  </WorkflowDialog>;
}
