import { useId, useState } from "react";
import { isValidNamespace } from "./namespaceAccess";

export function K8sNamespacePicker({ namespace, namespaces, defaultNamespace, loadingDefault, defaultError, discoveryError, disabled, onChange }: {
  namespace: string;
  namespaces: string[];
  defaultNamespace: string;
  loadingDefault: boolean;
  defaultError: string;
  discoveryError: string | null;
  disabled: boolean;
  onChange: (namespace: string) => void;
}) {
  const id = useId();
  const [manual, setManual] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const options = [...new Set([namespace, defaultNamespace, ...namespaces].filter(isValidNamespace))].sort();
  const edit = () => { setDraft(namespace === "_all" ? "" : namespace); setError(""); setManual(true); };
  return <section className="k8s-namespace-picker" aria-label="Namespace selection">
    <label className="k8s-meta" htmlFor={id}>Namespace</label>
    <div className="k8s-namespace-controls">
      <select id={id} aria-label="Namespace" value={namespace} disabled={disabled} onChange={event => { onChange(event.target.value); setManual(false); }}>
        {!namespace && <option value="" disabled>{loadingDefault ? "Reading context default…" : "Choose a namespace…"}</option>}
        <option value="_all">All namespaces</option>
        {options.map(value => <option key={value} value={value}>{value}</option>)}
      </select>
      <button type="button" disabled={disabled} onClick={edit} title="Enter a namespace even if listing namespaces is unavailable">Enter manually</button>
    </div>
    {manual && <form className="k8s-namespace-manual" onSubmit={event => {
      event.preventDefault();
      const value = draft.trim();
      if (!isValidNamespace(value)) { setError("Use 1–63 lowercase letters, numbers or hyphens; start and end with a letter or number."); return; }
      onChange(value); setManual(false); setError("");
    }}>
      <label className="k8s-meta" htmlFor={`${id}-manual`}>Namespace name</label>
      <input id={`${id}-manual`} aria-label="Namespace name" autoFocus autoComplete="off" spellCheck={false} value={draft} disabled={disabled} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={event => { setDraft(event.target.value); setError(""); }} placeholder="team-a" />
      {error && <p id={`${id}-error`} role="alert" className="k8s-source-error">{error}</p>}
      <div className="k8s-config-actions">
        <button type="submit" disabled={disabled}>Use namespace</button>
        <button type="button" onClick={() => { setManual(false); setError(""); }}>Cancel</button>
      </div>
    </form>}
    {defaultNamespace && <span className="k8s-meta">Context default: {defaultNamespace}</span>}
    {defaultError && <p role="status" className="k8s-source-error">Context namespace unavailable: {defaultError} Enter a namespace manually.</p>}
    {discoveryError && <details className="k8s-secondary k8s-namespace-discovery">
      <summary>Namespace list unavailable</summary>
      <p className="k8s-meta">You may still have access to a specific namespace. Enter its name above; listing namespaces is a separate permission.</p>
      <p className="k8s-meta">{discoveryError}</p>
    </details>}
  </section>;
}
