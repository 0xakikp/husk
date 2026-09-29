import type { K8sConfigSource } from "./configSource";
import type { K8sResourceSelection } from "./KubernetesView";

export function K8sLastResource({ resource, selected, config, context, onReopen }: {
  resource: K8sResourceSelection | null;
  selected: K8sResourceSelection | null;
  config: K8sConfigSource;
  context: string;
  onReopen: (resource: K8sResourceSelection) => void;
}) {
  // Never offer an old cluster's resource as if it belonged to the current view.
  if (!resource || selected || !resource.config || resource.config.fingerprint !== config.fingerprint || resource.context !== context) return null;
  return <button type="button" className="k8s-last-resource" onClick={() => onReopen(resource)}
    title={`Fetch fresh details · ${resource.context} · ${resource.namespace} · ${resource.config.paths.join(", ")}`}>
    <span>Reopen last resource</span>
    <span className="k8s-meta">{resource.kind} · {resource.name} · {resource.namespace}</span>
  </button>;
}
