import { isWorkflowShellLanguage } from "./captureRequest";

export type AiCommandCandidate = {
  text: string;
  /** A preceding standalone comment, not an inferred command description. */
  label: string;
  blockIndex: number;
  lineStart: number;
  lineEnd: number;
  kind: "command" | "script";
};

const MAX_BLOCK_CHARS_TO_SEPARATE = 128 * 1024;
const MAX_COMMANDS_TO_SEPARATE = 100;
const CONTROL_CHARACTERS = /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/;
const RESERVED_WORDS = new Set([
  "!", "[[", "]]", "[", "]", "if", "then", "else", "elif", "fi", "for", "while", "until",
  "do", "done", "case", "esac", "in", "select", "function", "time", "coproc", "repeat",
  "foreach", "end", "switch", "break", "continue", "return",
]);
// These commonly introduce a shell, REPL, or subsequent stdin/script input.
// This is deliberately not a whitelist of supported tools or package managers.
const SESSION_COMMANDS = new Set([
  "read", "readarray", "mapfile", "eval", "source", ".", "exec", "ssh", "mosh", "telnet", "ftp", "sftp", "su",
  "sh", "bash", "zsh", "fish", "dash", "ksh", "csh", "tcsh", "python", "python2", "python3",
  "node", "ruby", "irb", "php", "perl", "lua", "R", "julia", "sqlite3", "mysql", "psql", "redis-cli",
]);
const COMMAND_WRAPPERS = new Set(["sudo", "doas", "env", "command", "builtin", "nohup", "timeout", "nice", "ionice"]);

function literalArgument(token: string): string {
  return /^(["'])([^\\]*)\1$/.exec(token)?.[2] ?? token;
}

function consumesStdin(tokens: string[], commandIndex: number): boolean {
  const basename = tokens[commandIndex].split("/").pop();
  if (basename === "tee") return true;
  if (basename !== "cat") return false;
  let options = true;
  let hasFile = false;
  for (const token of tokens.slice(commandIndex + 1)) {
    // Quoted '-' still asks cat to read stdin; quotes do not make it a file.
    const argument = literalArgument(token);
    if (argument === "-") return true;
    if (options && argument === "--") { options = false; continue; }
    if (options && argument.startsWith("-")) continue;
    hasFile = true;
  }
  return !hasFile;
}

function mayWrapStdinConsumer(tokens: string[], commandIndex: number): boolean {
  let hasFile = false;
  let hasStdinDash = false;
  // One reverse pass avoids repeatedly scanning long suffixes in an AI example
  // with many tokens. Wrapper option grammars are intentionally not inferred.
  for (let index = tokens.length - 1; index > commandIndex; index--) {
    const basename = tokens[index].split("/").pop();
    if (basename === "tee" || (basename === "cat" && (hasStdinDash || !hasFile))) return true;
    const argument = literalArgument(tokens[index]);
    if (argument === "-") hasStdinDash = true;
    else if (!argument.startsWith("-")) hasFile = true;
  }
  return false;
}

/**
 * Recognize only uncomplicated, complete physical command lines. This is not a
 * shell parser and must never be used to authorize execution. Anything outside
 * this small grammar keeps the *whole block* together for manual review.
 */
function isSimpleCommand(line: string): boolean {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  const finishToken = () => {
    if (token) tokens.push(token);
    token = "";
  };
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    const next = line[index + 1];
    if (quote === "'") {
      token += char;
      if (char === "'") quote = null;
      continue;
    }
    if (quote === '"') {
      token += char;
      if (char === '"') quote = null;
      else if (char === "`") return false;
      else if (char === "$" && (next === "(" || next === "{")) return false;
      else if (char === "\\") {
        if (next === undefined) return false;
        token += next;
        index++;
      }
      continue;
    }
    if (char === " ") { finishToken(); continue; }
    if (char === "#" && !token) break;
    if (char === "'" || char === '"') { quote = char; token += char; continue; }
    if (char === "\\") {
      if (next === undefined) return false;
      token += char + next;
      index++;
      continue;
    }
    if (char === "`") return false;
    if (char === "$" && (next === "(" || next === "{" || next === "'" || next === '"')) return false;
    // Documentation placeholders are reviewable text, not shell redirections.
    // Execution validation must separately reject unresolved placeholders.
    if (char === "<" && !token) {
      const placeholder = /^<[A-Za-z][A-Za-z0-9_.-]*>(?= |$)/.exec(line.slice(index));
      if (!placeholder) return false;
      token = placeholder[0];
      index += placeholder[0].length - 1;
      continue;
    }
    if (/[|&;(){}<>!]/.test(char)) return false;
    token += char;
  }
  if (quote) return false;
  finishToken();
  let commandIndex = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[commandIndex] ?? "")) commandIndex++;
  const executable = tokens[commandIndex];
  if (!executable || !/^[A-Za-z0-9_./~][A-Za-z0-9_./~+-]*$/.test(executable) || RESERVED_WORDS.has(executable)) return false;
  const basename = executable.split("/").pop()!;
  if (SESSION_COMMANDS.has(basename)) return false;
  if (COMMAND_WRAPPERS.has(basename) && tokens.slice(commandIndex + 1).some((value) => SESSION_COMMANDS.has(value.split("/").pop()!))) return false;
  if (tokens.includes("-it") || tokens.includes("-ti") || tokens.includes("--interactive")) return false;
  if (consumesStdin(tokens, commandIndex)) return false;
  // Wrapper options have tool-specific grammars. Conservatively recognize a
  // possible wrapped stdin consumer instead of guessing where its input ends.
  if (COMMAND_WRAPPERS.has(basename) && mayWrapStdinConsumer(tokens, commandIndex)) return false;
  return true;
}

function blockCandidates(code: string, blockIndex: number): AiCommandCandidate[] {
  let lastLine = 1;
  for (let index = 0; index < code.length - 1; index++) if (code[index] === "\n") lastLine++;
  const script = (): AiCommandCandidate[] => [{ text: code, label: "", blockIndex, lineStart: 1, lineEnd: lastLine, kind: "script" }];
  if (code.length > MAX_BLOCK_CHARS_TO_SEPARATE) return script();
  // A line separator is not part of a command's body. Only CRLF is recognized;
  // a bare carriage return remains suspicious control text in an intact block.
  const lines = code.split(/\r?\n/);
  const commands: AiCommandCandidate[] = [];
  let comments: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (CONTROL_CHARACTERS.test(line)) return script();
    if (!line.trim()) continue;
    if (/^ *#!/.test(line)) return script();
    const comment = /^ *#(.*)$/.exec(line);
    if (comment) {
      comments.push(comment[1].trim());
      continue;
    }
    if (!isSimpleCommand(line)) return script();
    commands.push({ text: line, label: comments.filter(Boolean).join(" · "), blockIndex, lineStart: index + 1, lineEnd: index + 1, kind: "command" });
    comments = [];
    if (commands.length > MAX_COMMANDS_TO_SEPARATE) return script();
  }
  return commands.length ? commands : script();
}

/**
 * Offer simple shell lines separately without implying that they belong in a
 * sequence. Do not deduplicate alternatives, infer execution order, or partially
 * split an ambiguous block. Non-shell fences never become command candidates.
 */
export function getAiCommandCandidates(blocks: readonly { lang: string; code: string }[]): AiCommandCandidate[] {
  return blocks.flatMap((block, blockIndex) => isWorkflowShellLanguage(block.lang) ? blockCandidates(block.code, blockIndex) : []);
}
