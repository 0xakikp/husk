import type { ChatMessage } from "../client";

export type EditorChatMessage = ChatMessage & {
  id: string;
  /** Optional base64 image data URI attached to the message */
  image?: string;
};

/** Per-session model override. When null, uses global Settings default. */
export type SessionModelOverride = {
  providerId: string;
  model: string;
} | null;

/** Models that support vision (image input). */
export const VISION_MODELS = new Set([
  "claude-sonnet-4",
  "claude-opus-4",
  "claude-haiku-4",
  "gpt-4.1",
  "gpt-4.1-mini",
  "gpt-4o",
  "gemini-2.5-pro",
  "gemini-2.0-flash",
]);

export function supportsVision(modelId: string): boolean {
  return VISION_MODELS.has(modelId);
}

export interface CodeEdit {
  file: string;
  search: string;
  replace: string;
}

export type QuickAction = {
  id: string;
  label: string;
  prompt: string;
};

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "explain", label: "Explain", prompt: "Explain this code in detail. What does it do and how does it work?" },
  { id: "refactor", label: "Refactor", prompt: "Refactor this code to improve readability, performance, and maintainability. Keep the same functionality." },
  { id: "fix", label: "Fix", prompt: "Find and fix any bugs, issues, or anti-patterns in this code. Explain what was wrong." },
  { id: "test", label: "Test", prompt: "Generate comprehensive unit tests for this code. Cover edge cases and error paths." },
  { id: "docs", label: "Docs", prompt: "Add JSDoc/docstring documentation to all functions, classes, and public APIs in this code." },
  { id: "review", label: "Review", prompt: "Perform a code review of this file. Look for bugs, security issues, performance problems, and style issues." },
];

export const EDITOR_SYSTEM_PROMPT = `You are husk, an expert code editor assistant integrated into a terminal IDE. You help developers write, refactor, debug, and understand code.

When the user asks you to modify code, use this exact format for each change:

FILE: <relative-file-path>
<<<<<<< SEARCH
<exact existing code to find>
=======
<new replacement code>
>>>>>>> REPLACE

Rules:
- Only change what the user explicitly asked for.
- SEARCH blocks must match the existing file EXACTLY, including whitespace and indentation.
- If multiple changes, emit multiple FILE blocks.
- If no file changes are needed, just answer normally without FILE blocks.
- Always explain what you changed and why, outside the FILE blocks.`;
