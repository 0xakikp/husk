import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { streamText, stepCountIs, type ModelMessage, type Tool } from "ai";
import type { Provider } from "./providers";
import { runClaudeCli } from "./claudeCli";
import { runCodexCli } from "./codexCli";
import { runGeminiCli } from "./geminiCli";
import { runKimiCli } from "./kimiCli";
import { abortError } from "./cliProcess";

// Route model HTTP through Tauri (Rust) so provider APIs aren't blocked by the
// webview's CORS policy.
const tfetch = tauriFetch as unknown as typeof globalThis.fetch;

export type ChatImage = { dataUrl: string; mediaType?: string };
export type ChatMessage = { role: "user" | "assistant"; content: string; images?: ChatImage[] };

export function modelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === "assistant") return { role: "assistant", content: message.content };
    if (!message.images?.length) return { role: "user", content: message.content };
    return {
      role: "user",
      content: [
        { type: "text", text: message.content },
        ...message.images.map((image) => ({
          type: "image" as const,
          image: image.dataUrl,
          ...(image.mediaType ? { mediaType: image.mediaType } : {}),
        })),
      ],
    };
  });
}

export type ChatConfig = {
  provider: Provider;
  model: string;
  apiKey: string;
  baseURL: string;
  /** The chat's selected local project. Husk actions remain brokered. */
  workspacePath?: string;
};

/** A compact, user-facing record of Husk executing a local or connected tool.
 * It deliberately contains no tool input or result body: the chat should show
 * what happened without accidentally exposing private context in its chrome. */
export type ToolActivity = {
  name: string;
  state: "running" | "complete" | "error" | "refused" | "queued";
};

/**
 * Flatten a conversation into the single prompt the CLI accepts.
 *
 * Husk's session store stays the one source of truth for history, so the whole
 * transcript is re-sent each turn rather than threading the CLI's own
 * `--resume` session id. Two session models tracking the same conversation is
 * the kind of bookkeeping that drifts and then silently loses turns; the CLI
 * caches repeated context, so the cost of re-sending is much smaller than it
 * looks.
 */
function flattenForCli(system: string, messages: ChatMessage[]): string {
  if (messages.some((message) => message.images?.length)) {
    throw new Error("Image attachments require an API provider with image support. Remove the image or switch providers.");
  }
  const parts: string[] = [];
  if (system.trim()) parts.push(system.trim());
  for (const m of messages) {
    parts.push(`${m.role === "user" ? "User" : "Assistant"}: ${m.content}`);
  }
  return parts.join("\n\n");
}

function buildModel(cfg: ChatConfig) {
  const { provider, model, apiKey, baseURL } = cfg;
  switch (provider.kind) {
    case "cli":
      // Handled before this is reached; there is no HTTP model to build.
      throw new Error("cli provider does not use an HTTP model");
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
        baseURL: provider.configurableBaseURL ? baseURL || provider.baseURL || "" : provider.baseURL || "",
        fetch: tfetch,
      })(resolvedModel);
    }
  }
}

/** Execute one signed-in CLI backend without exposing raw local capabilities.
 * A CLI can return a small, validated action proposal; the renderer routes it
 * through Husk's action broker, exactly as API tool calls are routed. */
function runSubscriptionCli(
  cfg: ChatConfig,
  prompt: string,
  onDelta: (text: string) => void,
  onStatus?: (status: string) => void,
) {
  switch (cfg.provider.cli) {
    case "codex":
      return runCodexCli({ prompt, model: cfg.model, cwd: cfg.workspacePath ?? null, onDelta, onStatus });
    case "gemini":
      return runGeminiCli({ prompt, model: cfg.model, cwd: cfg.workspacePath ?? null, onDelta, onStatus });
    case "kimi":
      return runKimiCli({ prompt, model: cfg.model, cwd: cfg.workspacePath ?? null, onDelta });
    case "claude":
      return runClaudeCli({
        prompt,
        model: cfg.model,
        cwd: cfg.workspacePath ?? null,
        onDelta,
        onStatus: (name) => onStatus?.(`🛠️ ${name}`),
        onNotice: (text) => onStatus?.(`⚠️ ${text}`),
      });
    default:
      throw new Error("This CLI provider is not configured correctly.");
  }
}

/** Stream a chat completion, calling `onDelta` for each text chunk. When
 *  `tools` are supplied the model can call them across up to 8 steps.
 *  Optional `onStatus` receives tool-call/result status strings. `onToolActivity`
 *  records the same events in a structured form so a completed answer can show
 *  its trace after the temporary status line disappears. */
export async function streamChat(
  cfg: ChatConfig,
  system: string,
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  tools?: Record<string, Tool>,
  abortSignal?: AbortSignal,
  onStatus?: (status: string) => void,
  onToolActivity?: (activity: ToolActivity) => void,
): Promise<void> {
  if (abortSignal?.aborted) throw abortError();
  if (cfg.provider.kind === "cli") {
    /* Husk tools are never forwarded to a subscription CLI. It can only return
       an explicit proposal, which the renderer validates and executes through
       the local action broker. */
    const prompt = flattenForCli(system, messages);
    const run = runSubscriptionCli(cfg, prompt, onDelta, onStatus);
    const onAbort = () => run.stop();
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
    try {
      await run.done;
      if (abortSignal?.aborted) throw abortError();
    } finally {
      abortSignal?.removeEventListener("abort", onAbort);
    }
    return;
  }

  const result = streamText({
    model: buildModel(cfg),
    system,
    messages: modelMessages(messages),
    tools: tools && Object.keys(tools).length > 0 ? tools : undefined,
    stopWhen: stepCountIs(8),
    maxOutputTokens: 2048,
    abortSignal,
  });
  for await (const event of result.fullStream) {
    if (abortSignal?.aborted) throw abortError();
    switch (event.type) {
      case "text-delta":
        onDelta(event.text);
        break;
      case "tool-call":
        onStatus?.(`🛠️ ${event.toolName}`);
        onToolActivity?.({ name: event.toolName, state: "running" });
        break;
      case "tool-result":
        {
          const output = event.output as { state?: string } | null;
          const state = output && ["error", "refused", "queued"].includes(output.state ?? "") ? output.state as "error" | "refused" | "queued" : "complete";
          onStatus?.(`${state === "complete" ? "✅" : state === "queued" ? "Review" : "Failed"} ${event.toolName}`);
          onToolActivity?.({ name: event.toolName, state });
        }
        break;
      case "tool-error":
        onStatus?.(`Failed ${event.toolName}`);
        onToolActivity?.({ name: event.toolName, state: "error" });
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
  if (abortSignal?.aborted) throw abortError();
}

/** One-shot, non-streaming completion — used for command suggestions and
 *  error explanations. */
export async function generateOnce(
  cfg: ChatConfig,
  system: string,
  prompt: string,
  abortSignal?: AbortSignal,
): Promise<string> {
  let out = "";
  await streamChat(cfg, system, [{ role: "user", content: prompt }], (text) => { out += text; }, undefined, abortSignal);
  return out.trim();
}
