import { getProvider } from "./providers";
import { loadConfig, getKey } from "./store";
import { generateOnce, type ChatConfig } from "./client";
import { scanForSecrets } from "./contextItems";

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
 * Suggest one safe, inspectable next command after a completed terminal run.
 * This is deliberately separate from `suggestCommand`: the completed command
 * and its bounded output are evidence, while the user has not supplied a new
 * natural-language intent. The result is staged, never executed.
 */
export async function suggestNextCommand(
  command: string,
  output: string,
  cwd: string,
): Promise<string> {
  const text = await generateOnce(
    currentConfig(),
    "You are a careful terminal workflow assistant. Given one SUCCESSFUL completed command and its output, " +
      "suggest exactly one useful next shell command for verification, inspection, or a clearly safe continuation. " +
      "Never suggest destructive commands, deploys, deletes, force-pushes, credential changes, or a command that " +
      "would mutate remote/shared infrastructure. Reply with ONLY one raw shell command, no prose or markdown. " +
      "If there is no responsible next command, reply exactly NONE.",
    `Working directory: ${cwd || "(unknown)"}\n\nCompleted command:\n${command || "(unknown)"}\n\nOutput:\n${output || "(none)"}`,
  );
  const commandLine = text
    .replace(/^```[\w]*\n?/, "")
    .replace(/\n?```$/, "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) ?? "";
  return /^(?:none|no\s+(?:safe\s+)?next\s+command)\.?$/i.test(commandLine) ? "" : commandLine;
}

export type WorkflowRefinement = {
  name: string;
  description: string;
  steps: string[];
};

function firstProgram(command: string): string {
  return command.trim().split(/\s+/)[0]?.replace(/["']/g, "") ?? "";
}

/** Optional, user-triggered polish for a locally detected workflow. Detection
 * never needs a model; this call receives only the already-redacted commands
 * visible in the review form and cannot save or execute its response. */
export async function refineWorkflowDraft(
  name: string,
  description: string,
  steps: string[],
): Promise<WorkflowRefinement> {
  const text = await generateOnce(
    currentConfig(),
    "You refine a terminal workflow that the user is already reviewing. Reply with ONLY valid JSON using this exact shape: " +
      '{"name":"...","description":"...","steps":["..."]}. Keep exactly the same number and order of steps. ' +
      "Never add a command, flag, pipe, redirect, network destination, or executable. You may improve the short name and description, " +
      "and replace an obvious reusable value with a {{parameter}} placeholder. Do not include secrets or markdown.",
    JSON.stringify({ name, description, steps }),
  );
  const objectText = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(objectText) as Partial<WorkflowRefinement>;
  if (
    typeof parsed.name !== "string"
    || typeof parsed.description !== "string"
    || !Array.isArray(parsed.steps)
    || parsed.steps.length !== steps.length
    || parsed.steps.some((step) => typeof step !== "string" || !step.trim())
  ) {
    throw new Error("The model returned an invalid workflow shape.");
  }
  const refined = parsed.steps.map((step) => step.trim());
  if (refined.some((step, index) => firstProgram(step) !== firstProgram(steps[index]))) {
    throw new Error("The model changed a workflow executable, so Husk rejected the refinement.");
  }
  if (refined.some((step) => /\n|\r|\0/.test(step) || scanForSecrets("workflow step", step).length > 0)) {
    throw new Error("The model returned an unsafe or sensitive workflow step.");
  }
  return {
    name: parsed.name.trim().slice(0, 160) || name,
    description: parsed.description.trim().slice(0, 2_000),
    steps: refined,
  };
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
