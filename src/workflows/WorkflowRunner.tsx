import { CompactForm, CompactInput, CompactButton, CompactLabel } from "../components/compact-form";
import { useRef, useState, useSyncExternalStore } from "react";
import { subscribeCommandState, subscribeTerminalState, subscribeTerminalTyping } from "../ai/terminalContext";
import { compileWorkflow, getWorkflowInputs } from "./params";
import { captureWorkflowTarget, executeWorkflow, workflowTargetError } from "./execution";
import type { Workflow } from "./store";
import { WorkflowDialog } from "./WorkflowDialog";

/** Refresh only this open preview. PTY identity and xterm prompt-buffer changes
 * don't all publish terminalContext events; the local fallback observes them
 * without running commands or making native requests. Snapshots are strings,
 * so unchanged readiness does not re-render the form. Execution rechecks again. */
function subscribeRunTarget(onChange: () => void): () => void {
  const unsubscribers = [subscribeTerminalState(onChange), subscribeCommandState(onChange), subscribeTerminalTyping(onChange)];
  const timer = setInterval(onChange, 500);
  return () => { unsubscribers.forEach((unsubscribe) => unsubscribe()); clearInterval(timer); };
}

export function WorkflowRunner({ workflow, onClose, scriptPath, onOpenScript }: { workflow: Workflow; onClose: () => void; scriptPath?: string; onOpenScript?: () => void }) {
  let inputError = ""; let inputs: ReturnType<typeof getWorkflowInputs> = [];
  try { inputs = getWorkflowInputs(workflow); } catch (reason) { inputError = String(reason); }
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(inputs.map((input) => [input.name, input.defaultValue ?? ""])));
  const [target, setTarget] = useState(captureWorkflowTarget);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [showSecrets, setShowSecrets] = useState(false);
  const submitting = useRef(false);
  const targetError = useSyncExternalStore(subscribeRunTarget, () => scriptPath && target?.scope.isRemote
    ? "This is a local script. Focus a local terminal, then refresh the target. It cannot run on an SSH host."
    : workflowTargetError(target), () => null);
  let compiled: ReturnType<typeof compileWorkflow> | null = null; let validation = inputError;
  try { if (!validation) compiled = compileWorkflow(workflow, values); } catch (reason) { validation = reason instanceof Error ? reason.message : String(reason); }
  const hasSecret = inputs.some((input) => input.type === "secret" && values[input.name]);
  let displaySteps = compiled?.steps ?? workflow.steps;
  if (hasSecret && !showSecrets && compiled) {
    try { displaySteps = compileWorkflow(workflow, { ...values, ...Object.fromEntries(inputs.filter((input) => input.type === "secret").map((input) => [input.name, "[hidden secret]"])) }).steps; } catch { displaySteps = workflow.steps; }
  }
  const runActions = <div className="compact-actions wf-run-actions">
    <span className="wf-run-footer-note">Runs in the target shown above</span>
    <div className="compact-actions-main">
      <CompactButton type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</CompactButton>
      <CompactButton type="button" variant="primary" disabled={busy || !compiled || !target || !!targetError} onClick={() => {
        if (submitting.current || !compiled || !target || targetError) return; const command = compiled.command;
        submitting.current = true;
        setBusy(true); setError("");
        const run = scriptPath ? executeWorkflow(workflow, values, target, command, { localOnly: true }) : executeWorkflow(workflow, values, target, command);
        void run.then(onClose).catch((reason) => { setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => { submitting.current = false; setBusy(false); });
      }}>{busy ? "Submitting…" : scriptPath ? "Run script" : "Run workflow"}</CompactButton>
    </div>
  </div>;
  return <WorkflowDialog title={(scriptPath ? "Run script · " : "Run workflow · ") + workflow.name} onClose={onClose} busy={busy} variant="run" footer={runActions}>
    <CompactForm className="wf-form wf-run-form">
      <section className="wf-run-target" aria-label="Target terminal">
        <div className="wf-run-target-row">
          <span className="wf-run-destination">{target ? (target.scope.isRemote ? "SSH · " + target.scope.host : "Local shell") + " · terminal " + target.leafId : "No verified terminal"}</span>
          <CompactButton type="button" variant="ghost" compact disabled={busy} onClick={() => { setTarget(captureWorkflowTarget()); setError(""); }}>Refresh target</CompactButton>
        </div>
        <code className="wf-run-directory">{target?.scope.cwd || "Directory unknown"}</code>
        {targetError && <p className="compact-help wf-warning" role="status">{targetError}</p>}
      </section>
      {scriptPath && <section className="wf-script-source" aria-label="Linked script">
        <h3>Linked local file</h3><code>{scriptPath}</code>
        <p className="compact-help">Runs the current file in the directory shown above. The file must be executable and use a valid shebang. Husk does not change permissions, copy its contents, or send it to AI.</p>
        {onOpenScript && <CompactButton compact disabled={busy} onClick={onOpenScript}>Open original file</CompactButton>}
      </section>}
      {inputs.length > 0 && <section><h3>Runtime inputs</h3><div className="wf-input-grid">{inputs.map((input) => <CompactLabel key={input.name} className="compact-field wf-field"><span>{input.label}{input.required ? " *" : " (optional)"}</span>
        <CompactInput type={input.type === "secret" ? "password" : "text"} inputMode={input.type === "number" ? "decimal" : undefined} value={values[input.name] ?? ""} autoComplete="off" spellCheck={false} disabled={busy}
          onChange={(event) => { setValues((current) => ({ ...current, [input.name]: event.target.value })); setError(""); }} />
      </CompactLabel>)}</div></section>}
      <section aria-label="Workflow commands">
        <div className="wf-run-command-heading">
          <h3>{compiled ? "Commands" : "Steps · complete inputs to preview"} <span className="wf-run-count">{displaySteps.length}</span></h3>
          <span className="wf-run-policy">{workflow.stopOnError === false ? "Continues on error" : "Stops on error"}</span>
        </div>
        {hasSecret && <><p className="compact-help wf-warning">Secret values are not saved in Husk workflow definitions, but the submitted command can appear in shell history, process arguments, and terminal output.</p><CompactLabel className="compact-check wf-check"><input type="checkbox" checked={showSecrets} onChange={(event) => setShowSecrets(event.target.checked)} />Reveal secrets in preview</CompactLabel></>}
        <ol className="wf-run-steps" role="list" aria-label="Steps in execution order">
          {displaySteps.map((step, index) => <li className="wf-run-step" key={index}>
            <span className="wf-run-step-number" aria-hidden="true">{index + 1}</span>
            <div className="wf-run-step-content">{workflow.stepTitles?.[index] && <strong>{workflow.stepTitles[index]}</strong>}<pre>{step}</pre></div>
          </li>)}
        </ol>
      </section>
      {validation && <p role="alert" className="compact-error wf-error">{validation}</p>}{error && <p role="alert" className="compact-error wf-error">{error}</p>}
      <details className="wf-run-details"><summary>Execution details</summary>
        <p className="compact-help">Runs in one POSIX sh process on the target. Directory/environment changes carry between steps, not back to your prompt. {workflow.stopOnError === false ? "Continues after a failed step." : "Stops when a step returns a nonzero exit status."} Each step’s final status determines success. Only run workflows you trust.</p>
        {compiled && <><h3>Exact submitted command{hasSecret && !showSecrets ? " (hidden until secrets are revealed)" : ""}</h3>{(!hasSecret || showSecrets) && <pre>{compiled.command}</pre>}</>}
      </details>
    </CompactForm>
  </WorkflowDialog>;
}
