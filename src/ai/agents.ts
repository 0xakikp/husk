import { useSyncExternalStore } from "react";

/** A named assistant persona: a system prompt and optional model override. */
export type Agent = {
  id: string;
  name: string;
  systemPrompt: string;
  /** Optional model id; when set, overrides the configured model. */
  model?: string;
  builtIn?: boolean;
};

export const BUILTIN_AGENTS: Agent[] = [
  {
    id: "assistant",
    name: "Terminal Assistant",
    builtIn: true,
    systemPrompt:
      'You are the huskv2 assistant, embedded in a developer terminal. Be concise and practical. When the user refers to "this error" or "the last command", treat the active terminal output provided below as ground truth.',
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    builtIn: true,
    systemPrompt:
      'You are a code-review assistant. Report only ACTIONABLE findings: correctness bugs, security risks, performance, architecture. Format each as "[MUST/SHOULD/NIT] issue → fix". Skip style nits. If nothing is wrong, say so.',
  },
  {
    id: "explainer",
    name: "Explainer",
    builtIn: true,
    systemPrompt:
      "You are a patient teacher. Explain commands, errors, and code clearly and concisely, with a short example when it helps. Assume a competent developer who is new to this specific tool.",
  },
  {
    id: "devops",
    name: "DevOps",
    builtIn: true,
    systemPrompt:
      "You are a DevOps assistant fluent in shell, Docker, Kubernetes, Terraform, git, and cloud CLIs. Prefer safe, idempotent commands; flag destructive ones before suggesting them.",
  },
];

const LS_CUSTOM = "huskv2.ai.agents";
const LS_ACTIVE = "huskv2.ai.activeAgent";

function loadCustom(): Agent[] {
  try {
    const raw = localStorage.getItem(LS_CUSTOM);
    return raw ? (JSON.parse(raw) as Agent[]) : [];
  } catch {
    return [];
  }
}

let custom: Agent[] = loadCustom();
let activeId: string = (() => {
  try {
    return localStorage.getItem(LS_ACTIVE) || BUILTIN_AGENTS[0].id;
  } catch {
    return BUILTIN_AGENTS[0].id;
  }
})();

// Cached snapshot so useSyncExternalStore sees a stable reference.
let allCache: Agent[] = [...BUILTIN_AGENTS, ...custom];
const subs = new Set<() => void>();

function rebuild(): void {
  allCache = [...BUILTIN_AGENTS, ...custom];
  for (const fn of subs) fn();
}

function persist(): void {
  try {
    localStorage.setItem(LS_CUSTOM, JSON.stringify(custom));
  } catch {
    // storage unavailable
  }
}

export function allAgents(): Agent[] {
  return allCache;
}

export function getActiveAgent(): Agent {
  return allCache.find((a) => a.id === activeId) ?? BUILTIN_AGENTS[0];
}

export function setActiveAgent(id: string): void {
  activeId = id;
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {
    // ignore
  }
  for (const fn of subs) fn();
}

export function upsertAgent(agent: Agent): void {
  if (agent.builtIn) return;
  const i = custom.findIndex((a) => a.id === agent.id);
  custom = i === -1 ? [...custom, agent] : custom.map((a) => (a.id === agent.id ? agent : a));
  persist();
  rebuild();
}

export function removeAgent(id: string): void {
  custom = custom.filter((a) => a.id !== id);
  persist();
  if (activeId === id) {
    activeId = BUILTIN_AGENTS[0].id;
    try {
      localStorage.setItem(LS_ACTIVE, activeId);
    } catch {
      // ignore
    }
  }
  rebuild();
}

export function newAgentId(): string {
  return `custom-${Date.now().toString(36)}`;
}

function subscribe(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function useAgents(): Agent[] {
  return useSyncExternalStore(subscribe, allAgents);
}

export function useActiveAgentId(): string {
  return useSyncExternalStore(subscribe, () => activeId);
}
