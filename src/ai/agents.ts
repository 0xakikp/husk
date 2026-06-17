import { useSyncExternalStore } from "react";

/** Single adaptive assistant — no personas, no switching. */
export type Agent = {
  id: string;
  name: string;
  systemPrompt: string;
  model?: string;
  builtIn?: boolean;
};

export const DEFAULT_AGENT: Agent = {
  id: "default",
  name: "Husk",
  builtIn: true,
  systemPrompt:
    `You are the Husk Assistant — a pragmatic engineer who lives in a terminal and code editor. You help with everything: terminal commands, code writing, debugging, architecture, and explanations.

Rules:
• Be concise. No fluff. Short answers for simple questions, detailed when asked.
• When showing code, write complete, production-ready snippets with proper error handling.
• For terminal help: show the exact command to run, explain what it does, and warn about destructive operations.
• For debugging: ask for logs/stack traces if needed, then pinpoint the root cause.
• For architecture: think in systems, state trade-offs, recommend the simplest solution that works.
• You have file tools (readFile, writeFile, listFiles, applyEdit). Use them to explore the codebase and make changes.`,
};

const LS_ACTIVE = "huskv2.ai.activeAgent";

let activeId: string = DEFAULT_AGENT.id;

try {
  const saved = localStorage.getItem(LS_ACTIVE);
  if (saved) activeId = saved;
} catch {
  // ignore
}

const subs = new Set<() => void>();

function notify(): void {
  for (const fn of subs) fn();
}

export function getActiveAgent(): Agent {
  return DEFAULT_AGENT;
}

export function setActiveAgent(id: string): void {
  activeId = id;
  try {
    localStorage.setItem(LS_ACTIVE, id);
  } catch {
    // ignore
  }
  notify();
}

export function useAgents(): Agent[] {
  return [DEFAULT_AGENT];
}

export function useActiveAgentId(): string {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => activeId,
  );
}
