import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { streamText, stepCountIs, type ModelMessage, type Tool } from "ai";
import type { Provider } from "./providers";

// Route model HTTP through Tauri (Rust) so provider APIs aren't blocked by the
// webview's CORS policy.
const tfetch = tauriFetch as unknown as typeof globalThis.fetch;

export type ChatMessage = { role: "user" | "assistant"; content: string };

export type ChatConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
  baseURL: string;
};

function buildModel(cfg: ChatConfig) {
  const { provider, model, apiKey, baseURL } = cfg;
  switch (provider.kind) {
    case "anthropic":
      return createAnthropic({ apiKey, fetch: tfetch })(model);
    case "openai":
      return createOpenAI({ apiKey, fetch: tfetch })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey, fetch: tfetch })(model);
    case "openai-compatible": {
      // Moonshot model registry uses namespaced IDs like "moonshotai/kimi-k2.6"
      // but the API expects bare IDs like "kimi-k2.6".
      const resolvedModel = model.replace(/^moonshotai\//, "");
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console

      }
      return createOpenAICompatible({
        name: provider.id,
        apiKey: apiKey || "noauth",
        baseURL: baseURL || provider.baseURL || "",
        fetch: tfetch,
      })(resolvedModel);
    }
  }
}

/** Stream a chat completion, calling `onDelta` for each text chunk. When
 *  `tools` are supplied the model can call them across up to 8 steps.
 *  Optional `onStatus` receives tool-call/result status strings. */
export async function streamChat(
  cfg: ChatConfig,
  system: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  tools?: Record<string, Tool>,
  abortSignal?: AbortSignal,
  onStatus?: (status: string) => void,
): Promise<void> {
  const result = streamText({
    model: buildModel(cfg),
    system,
    messages: messages as ModelMessage[],
    tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
    stopWhen: stepCountIs(8),
    abortSignal,
  });
  for await (const event of result.fullStream) {
    if (abortSignal?.aborted) break;
    switch (event.type) {
      case "text-delta":
        onDelta(event.text);
        break;
      case "tool-call":
        onStatus?.(`🛠️ ${event.toolName}`);
        break;
      case "tool-result":
        onStatus?.(`✅ ${event.toolName}`);
        break;
      case "error":
        // The AI SDK reports some failures as stream events instead of throws.
        // Surface them so callers can render the error in the chat bubble.
        {
          const ev = event as { error?: unknown };
          const err = ev.error;
          const msg = err instanceof Error ? err.message : String(err || "Stream error");
          throw new Error(msg);
        }
      default:
        break;
    }
  }
}

/** One-shot, non-streaming completion — used for command suggestions and
 *  error explanations. */
export async function generateOnce(
  cfg: ChatConfig,
  system: string,
  prompt: string,
): Promise<string> {
  const result = streamText({ model: buildModel(cfg), system, prompt });
  return (await result.text).trim();
}
