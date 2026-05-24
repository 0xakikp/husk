import { useState } from "react";
import { listModels } from "./localModels";
import { toast } from "../toast";

/**
 * "Detect models" affordance for OpenAI-compatible endpoints: probes
 * `<baseURL>/models` and lists the results as clickable chips that set the
 * model. Surfaces whether a local server (LM Studio / Ollama / vLLM) is up.
 */
export function ModelDetect({
  baseURL,
  apiKey,
  current,
  onPick,
}: {
  baseURL: string;
  apiKey: string;
  current: string;
  onPick: (model: string) => void;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const detect = async () => {
    setBusy(true);
    try {
      const list = await listModels(baseURL, apiKey);
      setModels(list);
      if (list.length === 0) toast({ title: "Endpoint reachable, but reported no models", variant: "info" });
    } catch (e) {
      toast({
        title: `Model probe failed: ${e instanceof Error ? e.message : String(e)}`,
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="model-detect">
      <button type="button" className="ai-detect" onClick={() => void detect()} disabled={busy}>
        {busy ? "Detecting…" : "Detect models"}
      </button>
      {models.length > 0 ? (
        <div className="ai-models-list">
          {models.map((m) => (
            <button
              key={m}
              type="button"
              className={`ai-model-chip${current === m ? " active" : ""}`}
              onClick={() => onPick(m)}
            >
              {m}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
