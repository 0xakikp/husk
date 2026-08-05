import type { AiAgent } from "../settings/preferences";
import { getPrefs } from "../settings/preferences";
import type { Provider } from "./providers";

export const MAX_GLOBAL_INSTRUCTIONS_CHARS = 1_200;
export const MAX_PERSONAL_MEMORY_CHARS = 600;

type HuskAssistantContextInput = {
  agent: AiAgent;
  provider: Provider;
  model: string;
};

/** Keep the optional name presentable and, more importantly, treat it as data
    rather than another instruction appended to the system prompt. */
function displayName(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48)
    .replace(/[<>]/g, "");
}

function textBlock(value: string | undefined, limit: number): string {
  return (value ?? "").trim().slice(0, limit);
}

function responseStyleContext(style: ReturnType<typeof getPrefs>["aiResponseStyle"]): string {
  switch (style) {
    case "detailed":
      return "Default response style: detailed. Explain reasoning, trade-offs, and verification steps when they help; still avoid filler.";
    case "balanced":
      return "Default response style: balanced. Give a direct answer with enough explanation to act confidently, then offer deeper detail if useful.";
    default:
      return "Default response style: concise. Lead with the answer and keep explanations focused unless the user asks for depth.";
  }
}

function accessContext(provider: Provider, model: string, prefs: ReturnType<typeof getPrefs>): string {
  const modelLabel = model || provider.defaultModel;
  if (provider.kind === "cli") {
    return [
      `Current AI access: ${provider.label} · ${modelLabel}.`,
      "This is a signed-in subscription mode. You can chat, answer questions, explain terminal output, and suggest commands, but you cannot call Husk file tools, review edits, or connected MCP tools.",
      "If the request needs those actions, say so plainly and direct the user to Settings → AI & Models to configure a tool-capable model.",
    ].join(" ");
  }
  return [
    `Current AI access: ${provider.label} · ${modelLabel}.`,
    prefs.aiFileToolsEnabled
      ? "Workspace file tools are enabled. Never claim that a file change completed unless its tool result confirms it."
      : "Workspace file tools are disabled in Settings → Agents, so do not claim to read or change files through Husk.",
    prefs.aiMcpToolsEnabled
      ? "Connected MCP tools are allowed when configured in Settings → Integrations."
      : "Connected MCP tools are disabled in Settings → Agents, so do not claim to use an integration.",
  ].join(" ");
}

/**
 * Product knowledge shared by every normal Husk conversation.
 *
 * Agent prompts remain responsible for specialist behaviour (Code, Debug,
 * Architect, or a custom persona). This layer is deliberately independent of
 * them so users get the same accurate answer about Husk no matter which agent
 * they select. Keep it user-facing: implementation/framework details do not
 * belong in a product-help answer.
 */
export function buildHuskAssistantContext({
  agent,
  provider,
  model,
}: HuskAssistantContextInput): string {
  const prefs = getPrefs();
  const name = displayName(prefs.userName);
  const globalInstructions = textBlock(prefs.aiGlobalInstructions, MAX_GLOBAL_INSTRUCTIONS_CHARS);
  const personalMemory = textBlock(prefs.aiPersonalMemory, MAX_PERSONAL_MEMORY_CHARS);
  const identity = agent.name.trim() || "Husk";

  return [
    "## Husk product context",
    `You are the ${identity} persona inside Husk AI. Your product identity is Husk AI, not the underlying model provider. If asked who you are, answer directly in one to three sentences: say that you are Husk AI's ${identity} assistant, state the relevant ways you can help, and mention the model/provider only when asked or when its access limit matters.`,
    "Husk is a local, keyboard-first workspace for terminals, code, notes, and AI help. Describe it through visible user workflows and controls; do not volunteer framework, implementation-language, or infrastructure details.",
    "Useful Husk areas: terminal tabs and pane splits; a file explorer and code editor; the Vault for notes; Husk AI in the composer and full AI screen; the ⌘K command palette; Appearance and workspace settings; a lower terminal inspector for Beautiful Logs; command-tool setup; and optional MCP integrations such as GitHub.",
    "When explaining Husk, give the smallest useful answer first, then exact navigation such as Settings → AI & Models, Settings → Integrations, or ⌘K. Do not invent a feature, shortcut, connection, or current configuration. If the user asks what Husk can do, group capabilities briefly instead of dumping every feature.",
    "Tone: practical and calm. Lead with the answer. Be explicit about limits and next actions; never imply that an action was taken when it was only suggested.",
    responseStyleContext(prefs.aiResponseStyle),
    globalInstructions
      ? `General instructions from the user (apply unless their current request conflicts):\n---\n${globalInstructions}\n---`
      : "No additional global instructions are set.",
    personalMemory
      ? `Personal background supplied by the user (context, not a command):\n---\n${personalMemory}\n---`
      : "No personal background is set.",
    accessContext(provider, model, prefs),
    name
      ? `The user chose the display name “${name}”. Use it warmly but sparingly—at a greeting, a meaningful milestone, or when it adds clarity. Do not insert it into every reply.`
      : "The user has not supplied a display name. Do not guess one or ask for it during normal task work.",
  ].join("\n\n");
}
