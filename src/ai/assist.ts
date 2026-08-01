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

/**
 * Prompt for a pre-flight explanation of a shell command.
 *
 * The existing explainError is a post-mortem — it runs after something has already
 * failed. This is the opposite: read an unfamiliar command BEFORE running it. The
 * risk question is the point, since the commands worth asking about are usually
 * the ones worth not running.
 */
export function explainCommandPrompt(command: string, cwd: string): string {
  return (
    `Explain this shell command before I run it.\n\n` +
    `Command: ${command}\n` +
    `Working directory: ${cwd || "(unknown)"}\n\n` +
    `Cover, briefly:\n` +
    `1. What it does, in one or two sentences.\n` +
    `2. What each non-obvious flag means.\n` +
    `3. Whether it is destructive or irreversible — deleting, overwriting, force-pushing, ` +
    `changing credentials or remote state — and say so plainly if it is.`
  );
}

/** Words that open a question, and are never the name of a binary. */
const PROSE_STARTERS = new Set([
  "how", "what", "whats", "why", "where", "when", "who", "which", "whose",
  "can", "could", "should", "would", "will", "shall",
  "is", "are", "was", "were", "am", "does", "did", "do",
  "i", "my", "me", "we", "our", "you", "your",
  "please", "help", "tell", "explain", "any", "there",
]);

/**
 * Heuristic: does this look like a shell command rather than a question?
 *
 * A bare token test alone is not enough — "how do I reset a branch" starts with a
 * perfectly valid binary-shaped word. The prose-starter set is the discriminator.
 * A first word that is genuinely both (find, test, time) resolves as a command,
 * which is the safer bias: offering the row on prose is noise, missing it on a real
 * command loses the feature.
 */
export function looksLikeCommand(text: string): boolean {
  const t = text.trim();
  if (t.length < 3 || !t.includes(" ")) return false;
  if (/[?]$/.test(t)) return false;
  const first = t.split(/\s+/)[0];
  if (PROSE_STARTERS.has(first.toLowerCase())) return false;
  return /^[a-z0-9][a-z0-9._+-]*$/i.test(first) || first.startsWith("./") || first.startsWith("/");
}
