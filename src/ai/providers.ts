/** `cli` drives a signed-in local coding CLI instead of an HTTP API — no key. */
export type ProviderKind = "anthropic" | "openai" | "google" | "openai-compatible" | "cli";
export type CliProviderId = "claude" | "codex";

export type Provider = {
  id: string;
  label: string;
  kind: ProviderKind;
  /** Base URL for openai-compatible providers. */
  baseURL?: string;
  /** Suggested default model id (editable by the user). */
  defaultModel: string;
  /** Local/self-hosted endpoints that may not need a key. */
  keyless?: boolean;
  /** User supplies the base URL (custom / local gateways). */
  configurableBaseURL?: boolean;
  /** Which local CLI backs a keyless subscription provider. */
  cli?: CliProviderId;
};

/** Copy shared anywhere Husk presents a signed-in CLI subscription provider.
    It describes Husk's integration boundary, not a limitation of Codex or
    Claude themselves. */
export const CLI_SUBSCRIPTION_MODE = {
  title: "Subscription mode — read-only",
  summary: "Uses your signed-in plan without an API key. Husk cannot run actions on your behalf in this mode.",
  works: "Chat, code questions, terminal help, command suggestions, and commit messages.",
  unavailable: "File edits and review, connected MCP tools, and other Husk actions that need tool access.",
  unlock: "To use full Husk, configure an API provider. You can keep this mode and switch any time.",
} as const;

/**
 * The provider list users pick from. OpenAI-compatible entries cover a long
 * tail of services (Groq, DeepSeek, OpenRouter, xAI, Mistral, local servers)
 * with just a base URL, so the list is easy to extend.
 */
export const PROVIDERS: Provider[] = [
  {
    /* Runs the `claude` CLI the user is already logged into, so a Pro/Max/
       Enterprise subscriber does not have to pay a second time through the API.
       keyless because there is genuinely nothing to enter; the settings page
       hides it unless the binary is on PATH. */
    id: "claude-code",
    label: "Claude Code (my subscription)",
    kind: "cli",
    cli: "claude",
    defaultModel: "sonnet",
    keyless: true,
  },
  {
    /* Like Claude Code, Codex owns its own ChatGPT/Codex sign-in. Running the
       locally logged-in CLI keeps that credential out of Husk and charges the
       account's Codex allowance rather than a separately supplied API key. */
    id: "codex",
    label: "Codex (my subscription)",
    kind: "cli",
    cli: "codex",
    // "codex" is Husk's alias for "let the signed-in CLI choose its default".
    // It is deliberately not passed as --model, because plan defaults evolve.
    defaultModel: "codex",
    keyless: true,
  },
  { id: "anthropic", label: "Anthropic (Claude)", kind: "anthropic", defaultModel: "claude-sonnet-5" },
  { id: "openai", label: "OpenAI (GPT)", kind: "openai", defaultModel: "gpt-4.1" },
  { id: "google", label: "Google (Gemini)", kind: "google", defaultModel: "gemini-2.0-flash" },
  {
    id: "groq",
    label: "Groq",
    kind: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-pro",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter-auto",
  },
  {
    id: "xai",
    label: "xAI (Grok)",
    kind: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    defaultModel: "grok-3",
  },
  {
    id: "mistral",
    label: "Mistral",
    kind: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    defaultModel: "mistral-large-latest",
  },
  {
    id: "moonshot",
    label: "Moonshot",
    kind: "openai-compatible",
    baseURL: "https://api.moonshot.ai/v1",
    defaultModel: "moonshotai/kimi-k2.6",
  },
  {
    id: "local",
    label: "Local / OpenAI-compatible",
    kind: "openai-compatible",
    baseURL: "http://localhost:1234/v1",
    defaultModel: "lmstudio-local",
    keyless: true,
    configurableBaseURL: true,
  },
];

export function getProvider(id: string): Provider {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}
