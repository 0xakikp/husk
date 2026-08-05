import { invoke } from "@tauri-apps/api/core";
import { builtInAiAgents, type AiAgent } from "../settings/preferences";

type AgentLoad = {
  dir: string;
  agents: AiAgent[];
  errors: string[];
};

function sameOptional(left: string | undefined, right: string | undefined) {
  return (left ?? "") === (right ?? "");
}

function sameAgent(left: AiAgent, right: AiAgent) {
  return left.id === right.id
    && left.name === right.name
    && left.icon === right.icon
    && left.systemPrompt === right.systemPrompt
    && left.builtIn === right.builtIn
    && sameOptional(left.model, right.model)
    && sameOptional(left.color, right.color);
}

/** Merge user files over Husk's shipped agents. A file with a built-in id is a
 * deliberate local override; deleting it later simply restores the shipped
 * agent without ever editing application code. */
export function mergeAiAgents(fileAgents: AiAgent[]): AiAgent[] {
  const merged = new Map(builtInAiAgents().map((agent) => [agent.id, agent]));
  for (const agent of fileAgents) {
    const builtIn = merged.get(agent.id);
    merged.set(agent.id, builtIn ? { ...builtIn, ...agent, builtIn: true } : { ...agent, builtIn: false });
  }
  return [...merged.values()];
}

function agentOverrides(agents: AiAgent[]): AiAgent[] {
  const shipped = new Map(builtInAiAgents().map((agent) => [agent.id, agent]));
  return agents.filter((agent) => {
    const defaultAgent = shipped.get(agent.id);
    return !defaultAgent || !sameAgent(defaultAgent, agent);
  });
}

export async function loadAiAgentsFromFiles(): Promise<{ agents: AiAgent[]; dir: string; errors: string[] }> {
  const loaded = await invoke<AgentLoad>("agents_load");
  return { agents: mergeAiAgents(loaded.agents), dir: loaded.dir, errors: loaded.errors };
}

/** Reconcile Markdown files with the agent list edited in Settings. The saved
 * files contain only custom agents and explicit overrides, never the five
 * shipped defaults. */
export async function saveAiAgentsToFiles(agents: AiAgent[]): Promise<void> {
  const loaded = await invoke<AgentLoad>("agents_load");
  const desired = agentOverrides(agents);
  const desiredIds = new Set(desired.map((agent) => agent.id));

  for (const agent of desired) {
    await invoke("agent_write", { agent });
  }
  for (const agent of loaded.agents) {
    if (!desiredIds.has(agent.id)) {
      await invoke("agent_delete", { id: agent.id });
    }
  }
}

/** First-run migration from the old preferences blob. It is intentionally the
 * same reconciliation path used by Settings, so a custom agent cannot be
 * dropped due to a one-off migration implementation. */
export async function migrateLegacyAiAgents(agents: AiAgent[]): Promise<void> {
  const existing = await invoke<AgentLoad>("agents_load");
  // A person may already have written an agent file before a config.toml
  // exists. File content is deliberate, so let it win over the old browser
  // mirror rather than deleting it as part of the first migration.
  const merged = new Map(agents.map((agent) => [agent.id, agent]));
  for (const agent of existing.agents) merged.set(agent.id, agent);
  await saveAiAgentsToFiles([...merged.values()]);
}
