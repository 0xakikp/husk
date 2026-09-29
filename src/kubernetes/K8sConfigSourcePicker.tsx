import { useEffect, useId, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { configSourceName, resolveK8sConfig, type K8sConfigSource } from "./configSource";

export function K8sConfigSourcePicker({ source, onChange }: {
  source: K8sConfigSource | null;
  onChange: (source: K8sConfigSource) => void;
}) {
  const [pending, setPending] = useState<K8sConfigSource | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef(0);
  const sourceId = useId();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const current = ++request.current;
    setPending(null);
    if (source) {
      setBusy(false);
      return () => { request.current++; };
    }
    setBusy(true);
    void resolveK8sConfig({ kind: "app" }).then((value) => {
      if (current === request.current) { setBusy(false); setError(""); onChangeRef.current(value); }
    }).catch((failure) => {
      if (current === request.current) setError(String(failure));
    }).finally(() => {
      if (current === request.current) setBusy(false);
    });
    return () => { request.current++; };
  }, [source]);
  useEffect(() => () => { request.current++; }, []);

  const choose = async (kind: K8sConfigSource["kind"]) => {
    const current = ++request.current;
    setBusy(true);
    setError("");
    setPending(null);
    try {
      let next: K8sConfigSource;
      if (kind === "file") {
        const path = await open({ title: "Choose a trusted kubeconfig file", multiple: false, directory: false });
        if (current !== request.current || typeof path !== "string") return;
        next = await resolveK8sConfig({ kind: "file", path });
      } else if (kind === "terminal") {
        const { getActiveTerminalKubeconfigSnapshot } = await import("../terminal/registry");
        if (current !== request.current) return;
        const snapshot = getActiveTerminalKubeconfigSnapshot();
        if (!snapshot.available) throw new Error(snapshot.reason);
        const kubeconfig = snapshot.kubeconfig ?? snapshot.defaultKubeconfigPath;
        if (!kubeconfig) throw new Error("The terminal has not reported its config path. Open a new local terminal or choose a file instead.");
        next = await resolveK8sConfig({ kind: "terminal", kubeconfig, cwd: snapshot.cwd });
      } else {
        next = await resolveK8sConfig({ kind: "app" });
      }
      if (current === request.current) setPending(next);
    } catch (failure) {
      if (current === request.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (current === request.current) setBusy(false);
    }
  };

  return <section className="k8s-config-source" aria-label="Kubernetes config source">
    <label className="k8s-meta" htmlFor={sourceId}>Config source</label>
    <div className="k8s-config-controls">
      <select id={sourceId} aria-label="Config source" value={source?.kind || "app"} disabled={busy} onChange={(event) => void choose(event.target.value as K8sConfigSource["kind"])}>
        <option value="app">App default</option>
        <option value="file">Choose kubeconfig file…</option>
        <option value="terminal">Use active terminal config</option>
      </select>
      <button type="button" disabled={busy} onClick={() => void choose(source?.kind || "app")}>{source?.kind === "file" ? "Choose…" : source?.kind === "terminal" ? "Capture again" : "Reload"}</button>
    </div>
    {source && <div className="k8s-config-paths" aria-label="Selected kubeconfig files">
      {source.paths.map((path) => <span key={path} title={path}>{path}</span>)}
      <span className="k8s-meta">Pinned source · terminal tab changes do not switch it.</span>
      {source.missingPaths.length > 0 && <p role="status" className="k8s-meta">Missing when selected: {source.missingPaths.join(", ")}. Choose a config file or create the default config, then Reload this source and confirm.</p>}
    </div>}
    {busy && <p role="status" className="k8s-meta">Reading config source…</p>}
    {error && <p role="alert" className="k8s-source-error">{error}{source && " Current source is unchanged."}</p>}
    {pending && <div className="k8s-config-preview">
      <strong>{configSourceName(pending)}</strong>
      {pending.paths.map((path) => <code key={path}>{path}</code>)}
      <p>Only use trusted kubeconfigs: authentication plugins can run local programs. Files are used in place, not copied or sent to AI.</p>
      {pending.kind === "terminal" && <p>This captures kubeconfig paths only, not other terminal environment variables or SSH credentials.</p>}
      {pending.missingPaths.length > 0 && <p>Missing files: {pending.missingPaths.join(", ")}</p>}
      <div className="k8s-config-actions">
        <button type="button" onClick={() => { onChange(pending); setPending(null); }}>Use config</button>
        <button type="button" onClick={() => setPending(null)}>Cancel</button>
      </div>
    </div>}
  </section>;
}
