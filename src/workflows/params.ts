import { shq } from "../lib/shellQuote";
import { bytes, isWorkflowNumber, type Workflow, type WorkflowInput } from "./schema";

export type WorkflowParam = { name: string; default: string | null };
export const COMMAND_INPUT_HELP = "Saved command inputs must be whole arguments containing only ASCII letters, digits, spaces, and _ . / : @ + = , -. Quotes, backslashes, and shell syntax are not supported.";
const paramRe = () => /\{\{\s*([A-Za-z0-9_]+)\s*(?:=\s*([^}]*?))?\s*\}\}/g;
const unsafePrograms = /^(?:eval|exec|source|\.|env|sudo|doas|xargs|sh|bash|zsh|fish|dash|ksh|csh|tcsh|python[\d.]*|node|nodejs|perl|ruby|php|lua|awk|osascript|if|then|elif|else|fi|for|while|until|do|done|case|esac|select|function|time|coproc|!|command|builtin|return|trap|shift|set|unset|export|read|readonly|local|declare|typeset|alias|unalias)$/i;
export function extractParams(steps: string[]): WorkflowParam[] {
  const seen = new Map<string, string | null>();
  for (const step of steps) for (const match of step.matchAll(paramRe())) {
    const value = match[2] ?? null;
    if (!seen.has(match[1]) || seen.get(match[1]) === null) seen.set(match[1], value);
  }
  return [...seen].map(([name, value]) => ({ name, default: value }));
}
export function getWorkflowInputs(wf: Pick<Workflow, "steps" | "inputs">): WorkflowInput[] {
  const declarations = new Map((wf.inputs ?? []).map((input) => [input.name, input]));
  const inferred = extractParams(wf.steps);
  if (inferred.length > 32) throw new Error("A workflow supports at most 32 inputs.");
  const result = inferred.map((param): WorkflowInput => {
    if (["__proto__", "constructor", "prototype"].includes(param.name)) throw new Error("Reserved input name: " + param.name);
    const explicit = declarations.get(param.name);
    if (explicit?.type === "secret" && param.default !== null) throw new Error("Secret inputs cannot have inline defaults. Remove the =default from their placeholders.");
    return explicit ? { ...explicit, defaultValue: explicit.defaultValue ?? (param.default ?? undefined) }
      : { name: param.name, label: param.name, type: "text", required: param.default === null, defaultValue: param.default ?? undefined };
  });
  for (const input of wf.inputs ?? []) if (!inferred.some((param) => param.name === input.name)) result.push(input);
  return result;
}
function valuesFor(wf: Pick<Workflow, "steps" | "inputs">, values: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = Object.create(null);
  for (const input of getWorkflowInputs(wf)) {
    const provided = Object.prototype.hasOwnProperty.call(values, input.name) ? values[input.name] : undefined;
    const value = provided === undefined ? input.defaultValue ?? "" : provided;
    if (typeof value !== "string" || bytes(value) > 2000 || /[\x00-\x1f\x7f\u2028\u2029]/.test(value)) throw new Error(input.label + ": use a single-line value of at most 2,000 UTF-8 bytes.");
    if (input.required && !value.trim()) throw new Error(input.label + " is required.");
    if (input.type === "number" && value !== "" && !isWorkflowNumber(value)) throw new Error(input.label + " must be a finite number.");
    resolved[input.name] = value;
  }
  return resolved;
}

/** Rebuild parameterized words as literals. Complex shell grammar is rejected
 * rather than pretending to safely parse an arbitrary embedded program. */
function expandStep(text: string, values: Record<string, string>): string {
  if (text.includes("{{") && !extractParams([text]).length) throw new Error("Malformed input placeholder.");
  if (!extractParams([text]).length) return text;
  if (/[<>\x60]/.test(text) || /\$\(|\$\{|[\r\n]/.test(text)) throw new Error("Parameterized steps cannot use redirection, heredocs, backticks, or shell substitutions. Use simple argument placeholders.");
  let result = ""; let i = 0; let needsProgram = true;
  while (i < text.length) {
    if (/\s/.test(text[i])) { result += text[i++]; continue; }
    if (/[;&|]/.test(text[i])) { result += text[i++]; needsProgram = true; continue; }
    if (/[(){}]/.test(text[i]) && text.slice(i, i + 2) !== "{{") throw new Error("Parameterized steps cannot use shell blocks or functions.");
    const start = i;
    let quote: "'" | '"' | null = null; let literal = ""; let hasParam = false; let expansion = false;
    while (i < text.length) {
      const ch = text[i];
      if (text.slice(i, i + 2) === "{{") {
        const match = text.slice(i).match(/^\{\{\s*([A-Za-z0-9_]+)\s*(?:=\s*([^}]*?))?\s*\}\}/);
        if (!match) throw new Error("Malformed input placeholder.");
        if (!Object.prototype.hasOwnProperty.call(values, match[1])) throw new Error("Missing input: " + match[1]);
        literal += values[match[1]]; hasParam = true; i += match[0].length; continue;
      }
      if (!quote && (/\s/.test(ch) || /[;&|]/.test(ch))) break;
      if (ch === "\\" && quote !== "'") {
        expansion = true; literal += ch;
        i++; if (i < text.length) literal += text[i++];
        continue;
      }
      if (ch === "'" || ch === '"') {
        if (quote === ch) quote = null;
        else if (!quote) quote = ch;
        else literal += ch;
        i++; continue;
      }
      if (!quote && /[(){}]/.test(ch)) throw new Error("Parameterized steps cannot use shell blocks or functions.");
      if ((ch === "$" && quote !== "'") || (!quote && /[*?[\](){}]/.test(ch))) expansion = true;
      literal += ch; i++;
    }
    if (quote) throw new Error("Unclosed shell quote.");
    const raw = text.slice(start, i);
    if (needsProgram) {
      if (hasParam || /[=$\\]/.test(raw) || unsafePrograms.test(literal.split("/").pop() ?? "")) throw new Error("Inputs cannot select an executable, shell assignment, interpreter, or command dispatcher.");
      needsProgram = false;
    }
    if (hasParam) {
      if (expansion) throw new Error("An input cannot share a word with shell expansion or escapes. Use a literal path or a separate argument.");
      if (raw.startsWith("~/")) result += "~/" + shq(literal.slice(2));
      else result += shq(literal);
    } else result += raw;
  }
  return result;
}
/** The active shell is intentionally not guessed from the local login shell:
 * it may be fish, PowerShell, or an SSH session. A small literal alphabet in
 * standalone single-quoted arguments needs no dialect-specific escaping.
 * Plain authored commands are unchanged; only parameterized templates use
 * this deliberately small grammar. Aliases/functions still resolve in-shell. */
function expandSavedCommand(text: string, values: Record<string, string>): string {
  if (!extractParams([text]).length) {
    if (text.includes("{{")) throw new Error("Malformed input placeholder.");
    return text;
  }
  let result = ""; let i = 0; let needsProgram = true;
  while (i < text.length) {
    if (text[i] === " ") { result += text[i++]; continue; }
    const remaining = text.slice(i);
    const input = remaining.match(/^(['"])?\{\{\s*([A-Za-z0-9_]+)\s*(?:=\s*([^}]*?))?\s*\}\}\1(?= |$)/);
    if (input) {
      if (needsProgram) throw new Error("Inputs cannot select an executable, shell assignment, interpreter, or command dispatcher.");
      if (!Object.prototype.hasOwnProperty.call(values, input[2])) throw new Error("Missing input: " + input[2]);
      const value = values[input[2]];
      if (!/^[A-Za-z0-9 _./:@+=,-]*$/.test(value)) throw new Error(input[2] + ": " + COMMAND_INPUT_HELP);
      result += "'" + value + "'";
      i += input[0].length;
      continue;
    }
    const literal = remaining.match(/^(?:'[A-Za-z0-9 _./:@%+=,-]*'|"[A-Za-z0-9 _./:@%+=,-]*"|[A-Za-z0-9_./:@%+=,-]+)(?= |$)/)?.[0];
    if (!literal || literal === "--%" || literal.startsWith("@")) throw new Error("Parameterized saved commands support a simple command with whole-argument inputs, not shell syntax or combined words. " + COMMAND_INPUT_HELP);
    if (needsProgram) {
      const program = (literal.split("/").pop() ?? "").replace(/\.exe$/i, "");
      if (!/^[A-Za-z_./][A-Za-z0-9_./-]*$/.test(literal) || unsafePrograms.test(program)
        || /^(?:pwsh|powershell|cmd)(?:\.exe)?$|^(?:iex|invoke-expression|invoke-command|icm|start-process|saps|start|foreach|foreach-object|begin|end|switch|and|or|not)$/i.test(program)) throw new Error("Inputs cannot select an executable, shell assignment, interpreter, or command dispatcher.");
      needsProgram = false;
    }
    result += literal;
    i += literal.length;
  }
  return result;
}
export function substituteParams(text: string, values: Record<string, string>): string {
  return expandStep(text, valuesFor({ steps: [text] }, values));
}
export function compileWorkflow(wf: Pick<Workflow, "steps" | "inputs" | "stopOnError" | "kind">, values: Record<string, string>): { steps: string[]; command: string } {
  if (!wf.steps.length || wf.steps.length > 100) throw new Error("Use 1–100 steps.");
  if (wf.kind !== undefined && wf.kind !== "command") throw new Error("Unknown saved item kind.");
  if (wf.kind === "command" && wf.steps.length !== 1) throw new Error("A saved command needs exactly one command line.");
  const resolved = valuesFor(wf, values);
  const steps = wf.steps.map((step, index) => {
    if (!step.trim() || bytes(step) > 8000 || /[\x00-\x1f\x7f\u2028\u2029]/.test(step)) throw new Error("Step " + (index + 1) + ": use one command line per card, at most 8,000 UTF-8 bytes.");
    if (wf.kind === "command" && /[\x80-\x9f]/.test(step)) throw new Error("Saved commands cannot contain control characters.");
    return wf.kind === "command" ? expandSavedCommand(step, resolved) : expandStep(step, resolved);
  });
  if (wf.kind === "command") {
    if (bytes(steps[0]) > 64 * 1024) throw new Error("Expanded command exceeds the 64 KiB terminal-run limit.");
    return { steps, command: steps[0] };
  }
  // Each reviewed step is a separate argument; semicolons in a later step
  // cannot escape a simple && chain. cd/env changes last within the workflow.
  const script = 'status=0; for step do eval "$step"; status=$?; ' +
    (wf.stopOnError === false ? "" : '[ "$status" -eq 0 ] || exit "$status"; ') +
    'done; exit "$status"';
  const command = ["sh", "-c", shq(script), "husk-workflow", ...steps.map(shq)].join(" ");
  if (bytes(command) > 64 * 1024) throw new Error("Expanded workflow exceeds the 64 KiB terminal-run limit.");
  return { steps, command };
}
export function composeCommand(steps: string[], values: Record<string, string>, opts: { stopOnError?: boolean } = {}): string {
  return compileWorkflow({ steps, stopOnError: opts.stopOnError }, values).command;
}
