import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * Probe an OpenAI-compatible `/models` endpoint and return the available model
 * ids. Used to detect a running local server (LM Studio, Ollama, vLLM, …) and
 * let the user pick from the models it actually serves. Routed through Tauri's
 * HTTP so localhost / private-network endpoints aren't blocked by the webview.
 */
export async function listModels(baseURL: string, apiKey?: string): Promise<string[]> {
  const base = baseURL.trim().replace(/\/+$/, "");
  if (!base) throw new Error("no base URL");
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await tauriFetch(`${base}/models`, { method: "GET", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as { data?: { id?: string }[] };
  return (json.data ?? []).map((m) => m.id ?? "").filter(Boolean);
}
