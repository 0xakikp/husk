import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { streamText, type ModelMessage } from "ai";
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
    case "openai-compatible":
      return createOpenAICompatible({
        name: provider.id,
        apiKey: apiKey || "noauth",
        baseURL: baseURL || provider.baseURL || "",
        fetch: tfetch,
      })(model);
  }
}

/** Stream a chat completion, calling `onDelta` for each text chunk. */
export async function streamChat(
  cfg: ChatConfig,
  system: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
): Promise<void> {
  const result = streamText({
    model: buildModel(cfg),
    system,
    messages: messages as ModelMessage[],
  });
  for await (const delta of result.textStream) {
    onDelta(delta);
  }
}
