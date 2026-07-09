import { useSyncExternalStore } from "react";
import { getPrefs, setPrefs, subscribePrefs, type AiAgent } from "../settings/preferences";

/** Reads the active agent from preferences. Falls back to the Code agent or the first available agent. */
export function getActiveAgent(): AiAgent {
  const prefs = getPrefs();
  const agents = prefs.aiAgents ?? [];
  const active = agents.find((a) => a.id === prefs.activeAgentId);
  if (active) return active;
  const code = agents.find((a) => a.id === "code");
  if (code) return code;
  return agents[0] ?? DEFAULT_AGENT;
}

export function getActiveAgentId(): string {
  return getPrefs().activeAgentId;
}

export function setActiveAgent(id: string): void {
  const prefs = getPrefs();
  const agents = prefs.aiAgents ?? [];
  if (!agents.some((a) => a.id === id)) return;
  setPrefs({ activeAgentId: id });
}

export function useAgents(): AiAgent[] {
  const prefs = useSyncExternalStore(subscribePrefs, getPrefs);
  return prefs.aiAgents ?? [];
}

export function useActiveAgentId(): string {
  return useSyncExternalStore(subscribePrefs, getActiveAgentId, getActiveAgentId);
}

const DEFAULT_AGENT: AiAgent = {
  id: "default",
  name: "Husk",
  icon: "✦",
  color: "primary",
  builtIn: true,
  systemPrompt:
    "You are the Husk Assistant — a pragmatic engineer who lives in a terminal and code editor. You help with everything: terminal commands, code writing, debugging, architecture, and explanations.",
};
