import { getProvider } from "./providers";
import { loadConfig, getKey } from "./store";
import { generateOnce, type ChatConfig } from "./client";

function currentConfig(): ChatConfig {
  const c = loadConfig();
  const provider = getProvider(c.providerId);
  return { provider, model: c.model, apiKey: getKey(provider.id), baseURL: c.baseURL };
}

/** Natural-language intent → a single shell command (no prose/markdown). */
export async function suggestCommand(
  intent: string,
  cwd: string,
  recentOutput: string,
): Promise<string> {
  const prompt =
    `Working directory: ${cwd || "(unknown)"}\n` +
    `Recent terminal output:\n${recentOutput || "(none)"}\n\n` +
    `Task: ${intent}`;
  const text = await generateOnce(
    currentConfig(),
    "You are a terse terminal assistant. Respond with ONLY the raw shell command — no explanation, no markdown, no backticks. A single line.",
    prompt,
  );
  return text
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```$/, "")
    .trim();
}

/** Explain a failed command and suggest a fix. */
export async function explainError(
  command: string,
  output: string,
  exitCode: number | null,
): Promise<string> {
  const prompt =
    `Command: ${command || "(unknown — infer from the output)"}\n` +
    `Exit code: ${exitCode ?? "unknown"}\n` +
    `Output:\n${output || "(none)"}\n\n` +
    `Explain what went wrong and how to fix it.`;
  return generateOnce(
    currentConfig(),
    "You are a helpful terminal assistant. Explain the error concisely and give a concrete fix — a sentence or two plus the fix command if applicable.",
    prompt,
  );
}
