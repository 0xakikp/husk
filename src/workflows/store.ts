import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { validateWorkflowList, type Workflow } from "./schema";
export type { Workflow, WorkflowInput } from "./schema";
const LS_KEY = "huskv2.runbooks";
let cache: Workflow[] | null = null;
let revision = 0;
let loadError: string | null = null;
let saveQueue: Promise<void> = Promise.resolve();
const subscribers = new Set<() => void>();
function publish(list: Workflow[]) { cache = list; revision++; subscribers.forEach((fn) => fn()); }
function legacyWorkflows(): Workflow[] {
  try { const raw = localStorage.getItem(LS_KEY); return raw ? validateWorkflowList(JSON.parse(raw)) : []; }
  catch (error) { loadError = "Could not read saved workflows. Original data was kept; repair or restore it before saving new workflows."; console.warn("[workflows] could not read legacy workflows:", error); return []; }
}
export function getWorkflowLoadError(): string | null { return loadError; }
export function loadWorkflows(): Workflow[] { cache ??= legacyWorkflows(); return cache; }
export function useWorkflows(): Workflow[] {
  return useSyncExternalStore((fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; }, loadWorkflows, loadWorkflows);
}
/** Publish only after durable native save; reject stale concurrent editors. */
export function saveWorkflows(list: Workflow[]): Promise<void> {
  if (loadError) return Promise.reject(new Error(loadError));
  const next = validateWorkflowList(list);
  const expected = revision;
  const saving = saveQueue.then(async () => {
    if (expected !== revision) throw new Error("Workflows changed while saving. Review your changes and retry.");
    await invoke("workflow_state_save", { valueJson: JSON.stringify({ items: next, dismissed: [] }) });
    publish(next);
    try { localStorage.setItem(LS_KEY, JSON.stringify(next)); } catch { /* Native SQLite is authoritative. */ }
  });
  saveQueue = saving.catch(() => {});
  return saving;
}
export async function initialiseWorkflowStore(): Promise<void> {
  const legacy = legacyWorkflows();
  try {
    const raw = await invoke<string | null>("workflow_state_load");
    if (raw) { const list = validateWorkflowList((JSON.parse(raw) as { items: unknown }).items); loadError = null; publish(list); }
    else {
      if (loadError) throw new Error(loadError);
      await invoke("workflow_state_save", { valueJson: JSON.stringify({ items: legacy, dismissed: [] }) });
      publish(legacy);
    }
    try { localStorage.setItem(LS_KEY, JSON.stringify(loadWorkflows())); } catch { /* Native copy remains authoritative. */ }
  } catch (error) { loadError = "Durable workflow state could not be loaded. Showing the browser fallback read-only; restart after checking storage access."; publish(legacy); console.warn("[workflows] using browser fallback:", error); }
}
export function newWorkflowId(): string { return "wf_" + crypto.randomUUID(); }
