import { invoke } from "@tauri-apps/api/core";

export type Workflow = {
  id: string;
  name: string;
  steps: string[];
  description?: string;
  stopOnError?: boolean;
};

const LS_KEY = "huskv2.runbooks";
let cache: Workflow[] | null = null;

function normalizeWorkflows(value: unknown): Workflow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Workflow[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<Workflow>;
    const steps = Array.isArray(candidate.steps)
      ? candidate.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).slice(0, 100)
      : [];
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || !candidate.name.trim() || !steps.length) return [];
    return [{
      id: candidate.id.slice(0, 120),
      name: candidate.name.trim().slice(0, 160),
      steps: steps.map((step) => step.slice(0, 8_000)),
      description: typeof candidate.description === "string" ? candidate.description.slice(0, 2_000) : undefined,
      stopOnError: candidate.stopOnError !== false,
    }];
  }).slice(0, 500);
}

function legacyWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? normalizeWorkflows(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

export function loadWorkflows(): Workflow[] {
  cache ??= legacyWorkflows();
  return cache;
}

export function saveWorkflows(list: Workflow[]): void {
  cache = normalizeWorkflows(list);
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(cache));
  } catch {
    // storage unavailable — keep in memory only
  }
  void invoke("workflow_state_save", {
    valueJson: JSON.stringify({ items: cache, dismissed: [] }),
  }).catch((error) => console.warn("[workflows] durable save failed:", error));
}

/** Hydrate before React mounts. On the first native-enabled launch, migrate the
 * existing browser copy into ~/.husk/state.sqlite without deleting the fallback. */
export async function initialiseWorkflowStore(): Promise<void> {
  const legacy = legacyWorkflows();
  try {
    const raw = await invoke<string | null>("workflow_state_load");
    if (raw) {
      const parsed = JSON.parse(raw) as { items?: unknown };
      cache = normalizeWorkflows(parsed.items);
    } else {
      cache = legacy;
      await invoke("workflow_state_save", {
        valueJson: JSON.stringify({ items: cache, dismissed: [] }),
      });
    }
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch {
      // SQLite remains authoritative for the next launch.
    }
  } catch (error) {
    cache = legacy;
    console.warn("[workflows] using browser fallback:", error);
  }
}

export function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
