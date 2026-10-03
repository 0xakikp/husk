import { useEffect, useRef, useState } from "react";
import type { K8sReadScope } from "./configSource";
import { checkNamespaceAccess, type NamespaceAccessResult } from "./namespaceAccess";
import { boundedK8sDiagnostic } from "./commandErrors";

function AccessError({ result }: { result: NamespaceAccessResult }) {
  const message = result.error || "";
  const raw = result.diagnostics || (message.length > 240 || message.includes("\n") ? message : "");
  const firstLine = message.split(/\r?\n/, 1)[0];
  const summary = firstLine.length > 240 ? `${firstLine.slice(0, 240)}…` : firstLine;
  return <dd className="k8s-access-error">
    <p>{summary}</p>
    {result.errorHint && <p>{result.errorHint}</p>}
    {raw && <details className="k8s-access-diagnostics">
      <summary>Technical details</summary>
      <pre>{boundedK8sDiagnostic(raw)}</pre>
    </details>}
  </dd>;
}

export function K8sAccessCheck({ namespace, resources, scope }: { namespace: string; resources: readonly string[]; scope: K8sReadScope }) {
  const identity = JSON.stringify([scope, namespace, resources]);
  const latest = useRef(identity);
  latest.current = identity;
  const request = useRef(0);
  const [state, setState] = useState<{ identity: string; busy: boolean; results: NamespaceAccessResult[]; error: string } | null>(null);
  useEffect(() => () => { request.current++; }, [identity]);
  const visible = state?.identity === identity ? state : null;
  const check = async () => {
    const current = ++request.current;
    setState({ identity, busy: true, results: [], error: "" });
    try {
      const results = await checkNamespaceAccess(namespace, resources, scope);
      if (current === request.current && latest.current === identity) setState({ identity, busy: false, results, error: "" });
    } catch (error) {
      if (current === request.current && latest.current === identity) setState({ identity, busy: false, results: [], error: String(error) });
    }
  };
  return <div className="k8s-access-check">
    <button type="button" disabled={!namespace || visible?.busy} onClick={() => void check()}>{visible?.busy ? "Checking access…" : "Check access"}</button>
    {visible?.busy && <p className="k8s-meta" role="status">Checking list permissions for this selection…</p>}
    {visible && !visible.busy && <section className="k8s-access-results" aria-label="Access check results">
      <div className="k8s-access-heading"><span>Listing access · {namespace === "_all" ? "all namespaces" : namespace}</span><button type="button" onClick={() => setState(null)} aria-label="Dismiss access results">Dismiss</button></div>
      {visible.error && <p role="alert" className="k8s-source-error">{visible.error}</p>}
      <dl>{visible.results.map(result => <div key={result.resource}>
        <dt>list {result.resource}{result.resource === "namespaces" && " (cluster-wide)"}</dt>
        <dd data-access={result.allowed === null ? "unknown" : result.allowed ? "allowed" : "denied"}>{result.allowed === null ? "Unavailable" : result.allowed ? "Allowed" : "Not allowed"}</dd>
        {result.error && <AccessError result={result} />}
      </div>)}</dl>
      <p className="k8s-meta">Checks list permissions only—not resource existence, health or access to details/logs. No permissions are changed.</p>
      {visible.results.some(result => result.resource === "namespaces" && result.allowed === false) && <p className="k8s-meta">Namespace discovery is optional. Use Enter manually when cluster-wide namespace listing is denied.</p>}
      {visible.results.some(result => result.resource !== "namespaces" && result.allowed === false) && <p className="k8s-meta">For a denied resource check, ask your administrator for access in the intended namespace. Cluster-wide administrator access is not required.</p>}
    </section>}
  </div>;
}
