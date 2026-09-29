import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import type { K8sResourceSelection } from "./KubernetesView";
import type { K8sConfigSource, K8sReadScope } from "./configSource";

export const inspectableKinds = new Set([
  "pod", "service", "ingress", "deployment", "replicaset", "statefulset",
  "daemonset", "job", "configmap", "secret", "pvc", "quota",
]);

type InspectorScope = {
  context: string;
  config?: K8sConfigSource;
  readScope: K8sReadScope;
  namespace: string;
  name: string;
  kind: string;
  revision: number;
  refresh: () => void;
  navigate: (kind: string, name: string, namespace?: string) => void;
};

const Scope = createContext<InspectorScope>({
  context: "", readScope: "", namespace: "", name: "", kind: "", revision: 0, refresh: () => {}, navigate: () => {},
});

/** Navigation stays on the inspected cluster, even if the browser changes context. */
export function K8sInspectorProvider({ selection, onNavigate, children }: {
  selection: K8sResourceSelection;
  onNavigate: (selection: K8sResourceSelection) => void;
  children: ReactNode;
}) {
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const readScope = useMemo<K8sReadScope>(() => selection.config ? { context: selection.context, config: selection.config } : selection.context, [selection.context, selection.config]);
  const navigate = (kind: string, name: string, namespace = selection.namespace) => {
    const normalized = kind.toLowerCase();
    if (!selection.context || !name || !inspectableKinds.has(normalized)) return;
    onNavigate({ ...selection, namespace, name, kind: normalized as K8sResourceSelection["kind"] });
  };
  return <Scope.Provider value={{ ...selection, readScope, navigate, revision, refresh }}>{children}</Scope.Provider>;
}

export function useK8sInspector() { return useContext(Scope); }
