import { byteLength } from "./contextItems";
import { parseScreenObject } from "./screenAssist";

export function selectionLines(text: string) {
  if (!text.trim()) throw new Error("Select some text first.");
  if (byteLength(text) > 12 * 1024 || text.split("\n").length > 160) throw new Error("Select up to 160 lines / 12 KB for a focused explanation.");
  return text.split(/\r?\n/).map((line, index) => ({ id: index + 1, text: line }));
}

export function parsePeekResult(text: string, validIds: number[]) {
  const result = parseScreenObject(text);
  if (typeof result.explanation !== "string" || !result.explanation.trim() || result.explanation.length > 1200
    || !Array.isArray(result.sourceLineIds) || !result.sourceLineIds.length || result.sourceLineIds.length > 6
    || result.sourceLineIds.some((id) => !Number.isInteger(id) || !validIds.includes(id))) {
    throw new Error("The explanation did not cite valid selected lines. Try again.");
  }
  return { explanation: result.explanation.trim(), sourceLineIds: [...new Set(result.sourceLineIds as number[])] };
}

/** Commands remain proposals. Control characters (including embedded Enter),
 * multiline text, bracketed paste escapes and shell prompt prefixes are refused. */
export function validateStagedCommand(command: string): string {
  if (!command.trim() || command.length > 2000 || /[\x00-\x1f\x7f\u2028\u2029]/.test(command)
    || /^\s*(?:```|\$\s|>\s|#)/.test(command)) {
    throw new Error("The suggestion must be one plain command without control characters. Nothing was staged.");
  }
  return command.trim();
}

export function parseTweakResult(text: string) {
  const result = parseScreenObject(text);
  if (typeof result.explanation !== "string" || !result.explanation.trim() || result.explanation.length > 1000) throw new Error("The model did not explain the command change.");
  if (result.command === null) return { command: null, explanation: result.explanation.trim() };
  if (typeof result.command !== "string") throw new Error("The model returned an invalid command proposal.");
  return { command: validateStagedCommand(result.command), explanation: result.explanation.trim() };
}
