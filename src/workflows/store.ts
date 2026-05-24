export type Workflow = {
  id: string;
  name: string;
  steps: string[];
  description?: string;
  stopOnError?: boolean;
};

const LS_KEY = "huskv2.runbooks";

export function loadWorkflows(): Workflow[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Workflow[]) : [];
  } catch {
    return [];
  }
}

export function saveWorkflows(list: Workflow[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(list));
  } catch {
    // storage unavailable — keep in memory only
  }
}

export function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
