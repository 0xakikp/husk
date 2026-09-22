import { scanForSecrets } from "./contextItems";
import { parseScreenObject } from "./screenAssist";
import { validateStagedCommand } from "./screenSelection";

export type CommandReviewScope = { cwd: string; host: string | null; isRemote: boolean };

/** Text-only hints, not a shell parser or a safety classification. Quoted text,
 * aliases, substitutions, wrapper scripts and tool defaults cannot be resolved. */
export function inspectCommandText(text: string, scope?: CommandReviewScope) {
  const command = validateStagedCommand(text);
  const cautions: string[] = [];
  if (/(?:^|[\s;&|])(?:sudo|doas)\b/.test(command)) cautions.push("Elevated privileges appear in this command. Check which operations inherit them.");
  if (/(?:^|[\s;&|])(?:rm|rmdir|shred|mkfs(?:\.\w+)?|dd)\b|\bgit\s+(?:clean|reset\b[^;&|]*--hard)\b|\b(?:destroy|truncate|drop\s+table)\b/i.test(command)) cautions.push("Deletion or data replacement syntax appears here. Confirm targets and backups before running.");
  if (/(?:^|[^<])>{1,2}|\btee\b|\bsed\b[^;&|]*\s-i\b|\b(?:mv|cp)\s/.test(command)) cautions.push("File-write syntax appears here; destinations may be created, overwritten or appended to.");
  if (/\b(?:curl|wget)\b[^;]*\|[^;]*\b(?:sh|bash|zsh|python\d?)\b|\b(?:eval|source)\s|(?:^|[;&|]\s*)\.\s/.test(command)) cautions.push("Downloaded or indirect code may run. The selected command alone does not show what that code does.");
  if (/[;&|`]|\$\(|\$\{|\$[A-Za-z_]|[?*]/.test(command)) cautions.push("Chaining, expansion or substitution appears here. The shell can change the effective arguments and targets.");
  if (/\b(?:kubectl|helm|aws|gcloud|az|terraform|docker|ssh|scp|rsync)\b/.test(command)) cautions.push("A tool can target a different host or environment. Its active context, profile and default target have not been inspected.");
  if (/--(?:force|force-with-lease|no-preserve-root|yes|auto-approve)\b|(?:^|\s)-[A-Za-z]*f\b/.test(command)) cautions.push("A force or confirmation-bypass flag may be present; check its meaning for this tool.");
  if (scope?.isRemote && scope.host && /prod|production|live/i.test(scope.host)) cautions.push("The SSH hostname resembles a production name. This is a naming hint, not verified environment information.");
  const sensitive = scanForSecrets("command review", command).length > 0;
  if (sensitive) cautions.push("Potential credentials detected. This command cannot be sent for AI review; remove sensitive values first.");
  return { command, cautions, sensitive };
}

export function parseCommandReview(raw: string): { explanation: string; cautions: string[]; unknowns: string[] } {
  const value = parseScreenObject(raw);
  const bounded = (text: unknown, max: number): text is string => typeof text === "string" && !!text.trim() && text.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text);
  const list = (items: unknown): items is string[] => Array.isArray(items) && items.length <= 5 && items.every((item) => bounded(item, 500));
  if (!bounded(value.explanation, 1500) || !list(value.cautions) || !list(value.unknowns)) throw new Error("The review was not in the expected format. Try again.");
  return { explanation: value.explanation, cautions: value.cautions, unknowns: value.unknowns };
}
