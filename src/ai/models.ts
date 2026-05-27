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
  // Anthropic
  { id: "claude-sonnet-4", label: "Claude Sonnet 4", provider: getProvider("anthropic"), description: "Balanced speed & reasoning", contextWindow: "200K" },
  { id: "claude-opus-4", label: "Claude Opus 4", provider: getProvider("anthropic"), description: "Highest reasoning quality", contextWindow: "200K" },
  { id: "claude-haiku-4", label: "Claude Haiku 4", provider: getProvider("anthropic"), description: "Fastest, most affordable", contextWindow: "200K" },

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
  { id: "deepseek-chat", label: "DeepSeek V3", provider: getProvider("deepseek"), description: "General purpose chat", contextWindow: "64K" },
  { id: "deepseek-reasoner", label: "DeepSeek R1", provider: getProvider("deepseek"), description: "Reasoning specialist", contextWindow: "64K" },

  // OpenRouter
  { id: "openrouter-auto", label: "Auto (best available)", provider: getProvider("openrouter"), description: "OpenRouter picks the best model", contextWindow: "—" },

  // xAI
  { id: "grok-3", label: "Grok 3", provider: getProvider("xai"), description: "xAI's latest", contextWindow: "128K" },

  // Mistral
  { id: "mistral-large-latest", label: "Mistral Large", provider: getProvider("mistral"), description: "Mistral's flagship", contextWindow: "128K" },
  { id: "mistral-small-latest", label: "Mistral Small", provider: getProvider("mistral"), description: "Fast & efficient", contextWindow: "128K" },

  // Kimi
  { id: "kimi-k2.6", label: "Kimi K2.6", provider: getProvider("kimi"), description: "Long-context specialist", contextWindow: "2M" },

  // Moonshot
  { id: "moonshot-v1-128k", label: "Moonshot v1 128k", provider: getProvider("moonshot"), description: "Long-context specialist", contextWindow: "128K" },

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
