import { useEffect, useState } from "react";
import { useK8sInspector } from "./K8sInspectorContext";
import type { K8sReadScope } from "./configSource";

/** Bind every result to the exact inspector identity; old requests cannot replace it. */
export function useK8sDetail<T>(
  namespace: string,
  name: string,
  load: (namespace: string, name: string, context?: K8sReadScope) => Promise<T>,
) {
  const { readScope, revision } = useK8sInspector();
  const identity = JSON.stringify([readScope, namespace, name, revision]);
  const [state, setState] = useState<{
    identity: string; data: T | null; error: string | null; loading: boolean;
  }>({ identity, data: null, error: null, loading: true });

  useEffect(() => {
    let active = true;
    setState({ identity, data: null, error: null, loading: true });
    load(namespace, name, readScope).then(
      (data) => {
        if (active) setState({ identity, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (active) setState({ identity, data: null, error: error instanceof Error ? error.message : String(error), loading: false });
      },
    );
    return () => { active = false; };
  }, [readScope, namespace, name, identity, load]);

  return state.identity === identity ? state : { identity, data: null, error: null, loading: true };
}
