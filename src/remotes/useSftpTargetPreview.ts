import { useEffect, useState } from "react";
import { sftpPreviewTarget, type SftpTargetPreview } from "../remote/sftpApi";
import type { SftpTarget } from "./sftpTarget";

/** Preview public metadata only. Never let an old alias's reply label a new
 * destination, or retain an approval while the local configuration refreshes. */
export function useSftpTargetPreview(target: SftpTarget | null, active = true) {
  const [revision, setRevision] = useState(0);
  const targetJson = target ? JSON.stringify(target) : null;
  const key = active && targetJson ? `${revision}:${targetJson}` : null;
  const [state, setState] = useState<{ key: string | null; preview: SftpTargetPreview | null; loading: boolean; error: string }>({ key: null, preview: null, loading: false, error: "" });
  useEffect(() => {
    if (!key || !targetJson) {
      setState(previous => previous.key === null ? previous : { key: null, preview: null, loading: false, error: "" });
      return;
    }
    let alive = true;
    setState({ key, preview: null, loading: true, error: "" });
    void sftpPreviewTarget(JSON.parse(targetJson) as SftpTarget).then(preview => {
      if (alive) setState({ key, preview, loading: false, error: "" });
    }).catch(reason => {
      if (alive) setState({ key, preview: null, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
    });
    return () => { alive = false; };
  }, [key, targetJson]);
  const current = key && state.key === key ? state : { preview: null, loading: !!key, error: "" };
  return { preview: current.preview, loading: current.loading, error: current.error, refresh: () => setRevision(value => value + 1) };
}
