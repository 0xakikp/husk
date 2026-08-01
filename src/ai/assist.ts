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

/**
 * A conventional-commit subject line describing a diff.
 *
 * The model is asked for one line and then held to it: replies routinely arrive
 * wrapped in backticks, prefixed with "Here's a commit message:", or split over
 * several lines, and any of those would be pasted verbatim into the user's shell.
 * The caller stages the command for review rather than running it, but the message
 * still has to be sane before it gets there.
 */
export async function suggestCommitMessage(diff: string): Promise<string> {
  const text = await generateOnce(
    currentConfig(),
    "You write git commit subject lines. Reply with ONLY the subject line — no body, " +
      "no quotes, no backticks, no markdown, no preamble. Use the conventional-commit " +
      "form type(scope): summary, lower case after the colon, imperative mood, and keep " +
      "it under 72 characters.",
    `Describe this diff as a commit subject line:\n\n${diff}`,
  );
  return sanitizeSubject(text);
}

/** Collapse a model reply to a single safe subject line. */
export function sanitizeSubject(raw: string): string {
  const firstLine =
    raw
      .replace(/^```[\w]*\n?/, "")
      .replace(/\n?```$/, "")
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? "";
  const unquoted = firstLine
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    // Strip a conversational lead-in such as "Commit message: feat: ..."
    .replace(/^(here'?s\s+)?(a|the)?\s*commit\s+(message|subject)\s*[:\-]\s*/i, "")
    .trim();
  return unquoted.length > 72 ? `${unquoted.slice(0, 71)}…` : unquoted;
}
