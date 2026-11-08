import { useEffect, useRef, useState } from "react";

/** Keep reads attached to the folder that requested them, including refreshes. */
export function useGitWorkspaceQuery<T>(workspace: string, load: (cwd: string, signal: AbortSignal) => Promise<T>) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    workspace: string; load: typeof load; revision: number;
    data: T | null; error: string | null; loading: boolean;
  } | null>(null);
  const generation = useRef(0);

  useEffect(() => {
    const request = ++generation.current;
    let cancelled = false;
    const controller = new AbortController();
    const base = { workspace, load, revision };
    if (!workspace) {
      setState({ ...base, data: null, error: "Choose a local project folder to view Git information.", loading: false });
      return;
    }
    setState({ ...base, data: null, error: null, loading: true });
    void load(workspace, controller.signal).then(
      (data) => {
        if (!cancelled && generation.current === request) setState({ ...base, data, error: null, loading: false });
      },
      (error: unknown) => {
        if (!cancelled && generation.current === request) setState({ ...base, data: null, error: error instanceof Error ? error.message : String(error), loading: false });
      },
    );
    return () => { cancelled = true; controller.abort(); };
  }, [workspace, load, revision]);

  const current = state?.workspace === workspace && state.load === load && state.revision === revision ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    loading: current?.loading ?? true,
    refresh: () => setRevision((value) => value + 1),
  };
}
