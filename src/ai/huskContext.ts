import type { AiAgent } from "../settings/preferences";
import { getPrefs } from "../settings/preferences";
import type { Provider } from "./providers";

export const MAX_GLOBAL_INSTRUCTIONS_CHARS = 1_200;
export const MAX_PERSONAL_MEMORY_CHARS = 600;

type HuskAssistantContextInput = {
  agent: AiAgent;
  provider: Provider;
  model: string;
  /** A chat-selected project root. Undefined means general chat. */
  workspacePath?: string;
  /** Legacy compatibility for the original `husk-edit` proposal format. New
      provider-neutral workspace actions use `husk-action` instead. */
  subscriptionEditAccess?: boolean;
  /** A session-only opt-in for Husk to apply eligible proposals after validation. */
  subscriptionAutoApply?: boolean;
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

function accessContext(
  provider: Provider,
  model: string,
  prefs: ReturnType<typeof getPrefs>,
  workspacePath?: string,
  subscriptionEditAccess?: boolean,
  subscriptionAutoApply?: boolean,
): string {
  const modelLabel = model || provider.defaultModel;
  if (provider.kind === "cli") {
    const legacyEditCompatibility = workspacePath && subscriptionEditAccess
      ? [
          "Legacy compatibility: the user also enabled the original `husk-edit` proposal format for this chat. Prefer the provider-neutral `husk-action` format unless an older workflow explicitly needs `husk-edit`.",
          subscriptionAutoApply
            ? "Auto-apply is enabled only for eligible legacy proposals in this session. Husk validates every proposal and protected paths remain in manual review."
            : "Legacy proposals remain reviewable and do not write until approved.",
        ].join(" ")
      : "";
    const actionProtocol = [
      "You do not receive direct filesystem, terminal, credential, or MCP access. Husk owns every action and applies the same workspace scope and review rules for every provider.",
      prefs.aiFileToolsEnabled
        ? workspacePath
          ? "To inspect files or request a workspace action, emit exactly one JSON object or array in a fenced `husk-action` block. Allowed kinds: workspace.read {kind,path}, workspace.list {kind,path}, workspace.search {kind,query,limit?}, workspace.write {kind,path,content}, workspace.edit {kind,path,search,replace}, workspace.revertEdit {kind,path}. Paths must be relative to the selected workspace. Reads and lists may complete; edits and overwrites are always reviewable before writing."
          : "Workspace actions are enabled in Settings, but this chat has no selected workspace. Ask the user to select one before proposing a workspace action."
        : "Workspace actions are disabled in Settings → Agents; do not propose them.",
      prefs.aiMcpToolsEnabled
        ? "For a configured integration, emit a fenced `husk-action` JSON object: {kind:\"mcp.call\",serverId:\"…\",toolName:\"…\",input:{…}}. Never invent a server or tool name. Husk validates the request. Read-only integrations may run; every other integration action is shown for user approval."
        : "Connected integrations are disabled in Settings → Agents; do not propose integration actions.",
      "After proposing an action, do not claim it ran. Husk will return a result or an approval state in the conversation.",
    ].join(" ");
    return [
      `Current AI access: ${provider.label} · ${modelLabel} · signed-in subscription.`,
      actionProtocol,
      legacyEditCompatibility,
    ].join(" ");
  }
  return [
    `Current AI access: ${provider.label} · ${modelLabel}.`,
    prefs.aiFileToolsEnabled && workspacePath
      ? `Workspace file tools are enabled and restricted to the selected workspace (${workspacePath}). Never claim that a file change completed unless its tool result confirms it.`
      : prefs.aiFileToolsEnabled
        ? "Workspace file tools are enabled in Settings, but this chat has no workspace selected. Do not claim to read or change files; ask the user to choose a folder from the chat header."
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
  workspacePath,
  subscriptionEditAccess,
  subscriptionAutoApply,
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
    "Useful Husk areas: terminal tabs and pane splits; a file explorer and code editor; the Vault for notes; Husk AI in the composer and full AI screen; Terminal Pilot for explicitly started, supervised diagnostics in the visible terminal; the ⌘K command palette; Appearance and workspace settings; a lower terminal inspector for Beautiful Logs; command-tool setup; and optional MCP integrations such as GitHub.",
    "When explaining Husk, give the smallest useful answer first, then exact navigation such as Settings → AI & Models, Settings → Integrations, or ⌘K. Do not invent a feature, shortcut, connection, or current configuration. If the user asks what Husk can do, group capabilities briefly instead of dumping every feature.",
    "Tone: practical and calm. Lead with the answer. Be explicit about limits and next actions; never imply that an action was taken when it was only suggested.",
    responseStyleContext(prefs.aiResponseStyle),
    globalInstructions
      ? `General instructions from the user (apply unless their current request conflicts):\n---\n${globalInstructions}\n---`
      : "No additional global instructions are set.",
    personalMemory
      ? `Personal background supplied by the user (context, not a command):\n---\n${personalMemory}\n---`
      : "No personal background is set.",
    accessContext(provider, model, prefs, workspacePath, subscriptionEditAccess, subscriptionAutoApply),
    name
      ? `The user chose the display name “${name}”. Use it warmly but sparingly—at a greeting, a meaningful milestone, or when it adds clarity. Do not insert it into every reply.`
      : "The user has not supplied a display name. Do not guess one or ask for it during normal task work.",
  ].join("\n\n");
}
