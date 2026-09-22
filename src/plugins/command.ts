import { shq, tokenizeCommand } from "../lib/shellQuote";

export const MAX_PLUGIN_COMMAND_BYTES = 8_000;
const bytes = (value: string) => new TextEncoder().encode(value).length;
const controls = /[\x00-\x1f\x7f\u2028\u2029]/;

/** The existing tokenizer handles deliberately simple argv, not shell syntax.
 * Validate first so unsupported syntax cannot silently change meaning. */
export function pluginCommandArgv(command: string, placeholders = false): string[] {
  if (typeof command !== "string" || !command.trim() || bytes(command) > MAX_PLUGIN_COMMAND_BYTES || controls.test(command)) throw new Error("Command must be one nonempty line, without control characters, at most 8,000 UTF-8 bytes.");
  let quote: "'" | '"' | null = null;
  let content = false;
  let started = false;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote === "'") {
      if (ch === "'" && command.slice(i, i + 4) === "'\\''") { content = true; i += 3; continue; }
      if (ch === "'") quote = null; else content = true;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      else {
        if (/[\\$`]/.test(ch)) throw new Error("Expansion and backslash escapes in double quotes are unsupported. Use literal single-quoted arguments.");
        content = true;
      }
      continue;
    }
    if (ch === "'" || ch === '"') { quote = ch; started = true; continue; }
    if (ch === " ") {
      if (started && !content) throw new Error("Empty quoted arguments are unsupported in command templates.");
      started = false; content = false; continue;
    }
    if (ch === "{" && placeholders) {
      const match = command.slice(i).match(/^\{([^{}]+)\}/);
      if (match) { i += match[0].length - 1; started = true; content = true; continue; }
    }
    if (/[|&;<>()$`*?~[\]{}\\]/.test(ch) || (ch === "#" && !started)) throw new Error("Shell operators, expansions, globs and comments are unsupported. Use a literal program and arguments.");
    started = true; content = true;
  }
  if (quote) throw new Error("Command has an unclosed quote.");
  if (started && !content) throw new Error("Empty quoted arguments are unsupported in command templates.");
  const argv = tokenizeCommand(command.trim());
  if (!argv.length || argv.length > 128) throw new Error("Command must have a program and at most 127 arguments.");
  if (!/^(?:\/?[A-Za-z0-9_.+-])[A-Za-z0-9_./+-]*$/.test(argv[0])) throw new Error("Use a literal executable name or path; row placeholders and assignments cannot choose the program.");
  if (placeholders) {
    for (const argument of argv.slice(1)) {
      if (/[{}]/.test(argument.replace(/\{([^{}]+)\}/g, ""))) throw new Error("Action has malformed placeholders. Quote a placeholder containing spaces as one argument.");
      for (const match of argument.matchAll(/\{([^{}]+)\}/g)) if (!match[1].trim() || bytes(match[1]) > 160) throw new Error("Action placeholder needs a column name of at most 160 UTF-8 bytes.");
    }
    if (argv.some((argument) => /\{[^{}]+\}/.test(argument))) {
      const program = argv[0].split("/").pop()!.toLowerCase();
      if (/^(?:\.|eval|source|exec|command|env|sudo|doas|xargs|nohup|timeout|watch)$/.test(program)) throw new Error("Row placeholders are unsupported in command dispatchers. Name the actual executable directly.");
      if (/^(?:sh|bash|zsh|dash|ksh|fish|csh|tcsh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh|python[\d.]*|node|nodejs|ruby|perl|php|lua|osascript)$/.test(program)) throw new Error("Row placeholders are unsupported in shell/interpreter actions. Use a direct executable action instead.");
    }
  }
  return argv;
}

export function buildPluginActionCommand(action: { command: string }, row: Record<string, string>): string {
  const argv = pluginCommandArgv(action.command, true);
  const resolved = argv.map((arg, index) => {
    if (index === 0) return arg;
    const remainder = arg.replace(/\{([^{}]+)\}/g, "");
    if (/[{}]/.test(remainder)) throw new Error("Action has malformed row placeholders.");
    return arg.replace(/\{([^{}]+)\}/g, (_whole, rawKey: string) => {
      const key = rawKey.trim();
      if (!key || !Object.prototype.hasOwnProperty.call(row, key) || typeof row[key] !== "string") throw new Error(`Action needs a missing row column: ${key || "(empty)"}.`);
      const value = row[key];
      if (controls.test(value) || bytes(value) > 8_000) throw new Error(`Row column ${key} contains unsupported control characters or is too large.`);
      return value;
    });
  });
  const command = resolved.map(shq).join(" ");
  if (bytes(command) > MAX_PLUGIN_COMMAND_BYTES) throw new Error("The expanded action exceeds 8,000 UTF-8 bytes. Nothing was staged.");
  return command;
}
