import { useCallback, useEffect, useRef, useState } from "react";
import { resolveK8sConfig, type K8sConfigSource } from "./configSource";
import type { K8sResourceSelection } from "./KubernetesView";

export type K8sBrowseRequest = { context: string; config: K8sConfigSource };

/** Explicit allowlist: retain navigation identity, never resource/Secret contents. */
export function resourceIdentity(resource: K8sResourceSelection): K8sResourceSelection {
  const source = resource.config;
  return {
    context: resource.context, namespace: resource.namespace, kind: resource.kind, name: resource.name,
    ...(source ? { config: {
      kind: source.kind, paths: [...source.paths], cwd: source.cwd, fingerprint: source.fingerprint,
      label: source.label, missingPaths: [...source.missingPaths], pathSeparator: source.pathSeparator,
    } } : {}),
  };
}

/** Window-local navigation only. Closing an inspector discards its fetched data. */
export function useK8sNavigation() {
  const [selectedResource, setSelectedResource] = useState<K8sResourceSelection | null>(null);
  const [lastResource, setLastResource] = useState<K8sResourceSelection | null>(null);
  const [browseRequest, setBrowseRequest] = useState<K8sBrowseRequest | null>(null);
  const request = useRef(0);
  useEffect(() => () => { request.current++; }, []);
  const cancelBrowseRequest = useCallback(() => { request.current++; }, []);

  const selectResource = useCallback((resource: K8sResourceSelection | null) => {
    const identity = resource ? resourceIdentity(resource) : null;
    setSelectedResource(identity);
    if (identity) setLastResource(resourceIdentity(identity));
  }, []);

  const browseContext = useCallback(async (context: string) => {
    const current = ++request.current;
    // Launcher contexts come from App default, not the browser's potentially
    // unrelated custom file. Pin that source without changing kubectl's defaults.
    try {
      const config = await resolveK8sConfig({ kind: "app" });
      if (current !== request.current) return false;
      setBrowseRequest({ context, config });
      return true;
    } catch (error) {
      if (current !== request.current) return false;
      throw error;
    }
  }, []);

  return { selectedResource, lastResource, selectResource, browseRequest, browseContext, cancelBrowseRequest };
}
