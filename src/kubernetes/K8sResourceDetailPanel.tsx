import { lazy } from "react";
import type { K8sResourceSelection } from "./KubernetesView";
import { K8sInspectorProvider } from "./K8sInspectorContext";

const Pod = lazy(() => import("./PodDetailPanel"));
const Service = lazy(() => import("./ServiceDetailPanel"));
const Deployment = lazy(() => import("./DeploymentDetailPanel"));
const Workload = lazy(() => import("./WorkloadDetailPanel"));
const Ingress = lazy(() => import("./IngressDetailPanel"));
const Job = lazy(() => import("./JobDetailPanel"));
const ConfigMap = lazy(() => import("./ConfigAndStoragePanels").then(m => ({ default: m.ConfigMapDetailPanel })));
const Secret = lazy(() => import("./ConfigAndStoragePanels").then(m => ({ default: m.SecretDetailPanel })));
const Pvc = lazy(() => import("./ConfigAndStoragePanels").then(m => ({ default: m.PvcDetailPanel })));
const Quota = lazy(() => import("./ConfigAndStoragePanels").then(m => ({ default: m.QuotaDetailPanel })));

export default function K8sResourceDetailPanel({ selection, onNavigate, onClose }: {
  selection: K8sResourceSelection;
  onNavigate: (selection: K8sResourceSelection) => void;
  onClose: () => void;
}) {
  const props = { namespace: selection.namespace, name: selection.name, onClose };
  const content = (() => {
    switch (selection.kind) {
      case "pod": return <Pod {...props} />;
      case "service": return <Service {...props} />;
      case "deployment": return <Deployment {...props} />;
      case "replicaset": case "statefulset": case "daemonset": return <Workload {...props} kind={selection.kind} />;
      case "ingress": return <Ingress {...props} />;
      case "job": return <Job {...props} />;
      case "configmap": return <ConfigMap {...props} />;
      case "secret": return <Secret {...props} />;
      case "pvc": return <Pvc {...props} />;
      case "quota": return <Quota {...props} />;
    }
  })();
  if (!selection.context) return <p role="alert">Choose a Kubernetes context before inspecting a resource.</p>;
  return <K8sInspectorProvider key={JSON.stringify([selection.config?.fingerprint, selection.context, selection.kind, selection.namespace, selection.name])} selection={selection} onNavigate={onNavigate}>
    {content}
  </K8sInspectorProvider>;
}
