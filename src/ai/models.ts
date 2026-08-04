import { getProvider, type Provider } from "./providers";

export type ModelId = string;

export type ModelInfo = {
  id: ModelId;
  label: string;
  provider: Provider;
  description: string;
  contextWindow?: string;
};

export const MODELS: ModelInfo[] = [
  /* Claude Code CLI. Aliases, not dated ids: the CLI resolves "sonnet" to
     whatever it currently maps to, so these never go stale the way a pinned id
     does. They must be listed here or knownModel() treats a saved "sonnet" as
     retired and silently falls back to another provider's default. */
  { id: "sonnet", label: "Sonnet (via CLI)", provider: getProvider("claude-code"), description: "Balanced — the CLI's default", contextWindow: "plan limits" },
  { id: "opus", label: "Opus (via CLI)", provider: getProvider("claude-code"), description: "Highest reasoning quality", contextWindow: "plan limits" },
  { id: "haiku", label: "Haiku (via CLI)", provider: getProvider("claude-code"), description: "Fastest, lightest on usage", contextWindow: "plan limits" },

  // Anthropic
  { id: "claude-opus-5", label: "Claude Opus 5", provider: getProvider("anthropic"), description: "Highest reasoning quality", contextWindow: "200K" },
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", provider: getProvider("anthropic"), description: "Balanced speed & reasoning", contextWindow: "200K" },
  { id: "claude-fable-5", label: "Claude Fable 5", provider: getProvider("anthropic"), description: "Creative writing & long-form", contextWindow: "200K" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: getProvider("anthropic"), description: "Fastest, most affordable", contextWindow: "200K" },

  // OpenAI
  { id: "gpt-4.1", label: "GPT-4.1", provider: getProvider("openai"), description: "Latest flagship model", contextWindow: "1M" },
  { id: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: getProvider("openai"), description: "Smaller, faster, cheaper", contextWindow: "1M" },
  { id: "gpt-4o", label: "GPT-4o", provider: getProvider("openai"), description: "Omni-modal powerhouse", contextWindow: "128K" },
  { id: "o3-mini", label: "o3 mini", provider: getProvider("openai"), description: "Reasoning-optimized", contextWindow: "200K" },

  // Google
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: getProvider("google"), description: "Google's best model", contextWindow: "1M" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: getProvider("google"), description: "Fast & capable", contextWindow: "1M" },

  // Groq
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", provider: getProvider("groq"), description: "Meta's Llama on Groq", contextWindow: "128K" },
  { id: "mixtral-8x7b", label: "Mixtral 8x7B", provider: getProvider("groq"), description: "Open MoE model", contextWindow: "32K" },

  // DeepSeek
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", provider: getProvider("deepseek"), description: "Highest quality, 1M context", contextWindow: "1M" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash", provider: getProvider("deepseek"), description: "Fast, 1M context", contextWindow: "1M" },
  { id: "deepseek-chat", label: "DeepSeek V3 (legacy)", provider: getProvider("deepseek"), description: "Deprecated July 2026", contextWindow: "64K" },
  { id: "deepseek-reasoner", label: "DeepSeek R1 (legacy)", provider: getProvider("deepseek"), description: "Deprecated July 2026", contextWindow: "64K" },

  // OpenRouter
  { id: "openrouter-auto", label: "Auto (best available)", provider: getProvider("openrouter"), description: "OpenRouter picks the best model", contextWindow: "—" },

  // xAI
  { id: "grok-3", label: "Grok 3", provider: getProvider("xai"), description: "xAI's latest", contextWindow: "128K" },

  // Mistral
  { id: "mistral-large-latest", label: "Mistral Large", provider: getProvider("mistral"), description: "Mistral's flagship", contextWindow: "128K" },
  { id: "mistral-small-latest", label: "Mistral Small", provider: getProvider("mistral"), description: "Fast & efficient", contextWindow: "128K" },

  // Moonshot
  { id: "moonshotai/kimi-k2.6", label: "Kimi K2.6", provider: getProvider("moonshot"), description: "Long-context specialist", contextWindow: "2M" },

  // Local / OpenAI-compatible
  { id: "lmstudio-local", label: "LM Studio", provider: getProvider("local"), description: "Local model via LM Studio", contextWindow: "—" },
];

export function getModel(id: ModelId): ModelInfo {
  return MODELS.find((m) => m.id === id) ?? MODELS[0];
}

export function modelsForProvider(providerId: string): ModelInfo[] {
  return MODELS.filter((m) => m.provider.id === providerId);
}

export function needsKey(provider: Provider): boolean {
  return !provider.keyless;
}
