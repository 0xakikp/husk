/**
 * Normalized AI context items.
 *
 * Everything the AI can see before a prompt is sent — terminal output, files,
 * selections, command runs, project memory — is expressed as one AiContextItem
 * list. The composer renders chips from it, the Context Inspector reviews it,
 * and the request builder assembles the final system context from exactly this
 * list. Nothing reaches the model from a hidden ad-hoc source.
 */

export type AiContextKind =
  | "terminal"
  | "command-run"
  | "editor-file"
  | "selection"
  | "file"
  | "project-memory"
  | "project-instructions"
  | "instructions"
  | "personal-memory";

export type AiContextItem = {
  id: string;
  kind: AiContextKind;
  icon: string;
  /** Short chip/row label, e.g. "src/App.tsx" or "terminal output · 8.2 KB". */
  label: string;
  /** Where this came from, human readable (e.g. "active terminal scrollback"). */
  source: string;
  /** Exact text this item contributes to the request. */
  preview: string;
  /** preview length in bytes (UTF-8 approximation via char count is fine for
      budgeting — Husk treats the budget as bytes, not tokens). */
  bytes: number;
  /** True when the secret scanner matched the label or content. */
  sensitive: boolean;
  /** Why it was flagged, e.g. ["API key pattern"]. */
  sensitiveReasons: string[];
  /** False for informational items (global instructions, personal memory) that
      can only be changed in Settings, not removed per request. */
  removable: boolean;
  /** Base64 image payloads render as markdown, not fenced code. */
  isImage?: boolean;
};

/* ── Size helpers ────────────────────────────────────────────────────────── */

export function byteLength(text: string): number {
  return text.length;
}

export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10} KB`;
}

export function totalBytes(items: AiContextItem[]): number {
  return items.reduce((sum, item) => sum + item.bytes, 0);
}

/* ── Context budget ──────────────────────────────────────────────────────── */

/** Preset steps, not a free slider — see Settings → Agents → New chat context. */
export const CONTEXT_BUDGET_OPTIONS_KB = [8, 16, 32, 64] as const;
export const DEFAULT_CONTEXT_BUDGET_KB = 32;

export function budgetBytes(budgetKb: number): number {
  return budgetKb * 1024;
}

/**
 * Keep items in order until the budget runs out; everything after that is
 * dropped. Callers must surface `dropped` to the user — Husk never silently
 * cuts context.
 */
export function fitWithinBudget(
  items: AiContextItem[],
  budgetKb: number,
): { kept: AiContextItem[]; dropped: AiContextItem[] } {
  const limit = budgetBytes(budgetKb);
  const kept: AiContextItem[] = [];
  const dropped: AiContextItem[] = [];
  let used = 0;
  for (const item of items) {
    if (used + item.bytes <= limit) {
      kept.push(item);
      used += item.bytes;
    } else {
      dropped.push(item);
    }
  }
  return { kept, dropped };
}

/* ── Secret scanning ─────────────────────────────────────────────────────── */

const SECRET_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, reason: "private key" },
  { re: /\bAKIA[0-9A-Z]{16}\b/, reason: "AWS access key" },
  { re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/, reason: "GitHub token" },
  { re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, reason: "GitHub token" },
  { re: /\bsk-[A-Za-z0-9_-]{20,}\b/, reason: "API key" },
  { re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, reason: "Slack token" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/, reason: "Google API key" },
  { re: /\bBearer\s+[A-Za-z0-9._~-]{10,}/, reason: "bearer token" },
  {
    re: /\b(?:api[_-]?key|secret|token|password|passwd)\b\s*[:=]\s*["']?[^\s"']{8,}/i,
    reason: "assigned secret",
  },
  /* JWT-shaped blobs */
  { re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, reason: "JWT" },
];

const SENSITIVE_FILENAME_RE = /(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:id_rsa|id_ed25519|credentials|secrets?)(?:\.|$)/i;

/**
 * Returns the list of reasons this label/text looks sensitive. Empty array
 * means clean. This is a warning system, not redaction — the user decides.
 */
export function scanForSecrets(label: string, text: string): string[] {
  const reasons = new Set<string>();
  if (SENSITIVE_FILENAME_RE.test(label)) reasons.add("sensitive filename");
  /* Cap the scan: huge terminal buffers do not need every line regexed. */
  const sample = text.length > 64_000 ? text.slice(0, 64_000) : text;
  for (const { re, reason } of SECRET_PATTERNS) {
    if (re.test(sample)) reasons.add(reason);
  }
  return [...reasons];
}

/* ── Request assembly ────────────────────────────────────────────────────── */

/**
 * The exact block an item contributes to the system context. Assembling from
 * the inspected item list — instead of hidden per-source appends — is what
 * makes the Inspector honest: what you see is literally what is sent.
 */
export function itemToRequestBlock(item: AiContextItem): string {
  switch (item.kind) {
    case "terminal":
      return `\n\nActive terminal output:\n\`\`\`\n${item.preview}\n\`\`\``;
    case "command-run":
      return `\n\nOutput of command \`${item.source}\`:\n\`\`\`\n${item.preview}\n\`\`\``;
    case "editor-file":
      return `\n\nCurrent open file: ${item.source}\n\nFull file content:\n\`\`\`\n${item.preview}\n\`\`\``;
    case "selection":
      return `\n\nSelected ${item.source}:\n\`\`\`\n${item.preview}\n\`\`\``;
    case "file":
      return item.isImage
        ? `\n\n--- attached image: ${item.source} ---\n${item.preview}`
        : `\n\n--- attached file: ${item.source} ---\n\`\`\`\n${item.preview}\n\`\`\``;
    case "project-memory":
      return `\n\nBackground on this project (written by the user, not part of their current question):\n${item.preview}`;
    case "project-instructions":
      return `\n\nProject instructions (from .husk/instructions.md — follow unless the current request conflicts):\n---\n${item.preview}\n---`;
    /* instructions and personal-memory are assembled by huskContext.ts as part
       of the product-context layer; they appear in the Inspector for review
       but are not appended twice. */
    default:
      return "";
  }
}
