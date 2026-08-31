import { normalizeRemoteHost } from "../ai/remoteWorkspace";

/** A deliberately small shell-word reader. It extracts metadata only; it never
 * executes or rewrites the user's command. */
function shellWords(command: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: "'" | '"' | "" = "";
  let escaped = false;
  for (const char of command.trim()) {
    if (escaped) {
      word += char;
      escaped = false;
    } else if (char === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (word) words.push(word);
      word = "";
    } else {
      word += char;
    }
  }
  if (escaped) word += "\\";
  if (word) words.push(word);
  return words;
}

const SSH_OPTIONS_WITH_VALUE = new Set([
  "-B", "-b", "-c", "-D", "-E", "-e", "-F", "-I", "-i", "-J", "-L", "-l",
  "-m", "-O", "-o", "-p", "-Q", "-R", "-S", "-W", "-w",
]);
const MOSH_OPTIONS_WITH_VALUE = new Set(["-p", "--ssh", "--server", "--predict", "--port"]);

/** Return the SSH destination of a direct interactive ssh/mosh command. */
export function parseRemoteShellTarget(command: string): string | null {
  const words = shellWords(command);
  while (words[0] === "command" || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0] ?? "")) words.shift();
  const executable = (words.shift() ?? "").split("/").pop();
  if (executable !== "ssh" && executable !== "mosh") return null;
  const withValue = executable === "ssh" ? SSH_OPTIONS_WITH_VALUE : MOSH_OPTIONS_WITH_VALUE;
  let positional = false;
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (!positional && word === "--") {
      positional = true;
      continue;
    }
    if (!positional && word.startsWith("-")) {
      if (withValue.has(word)) index += 1;
      continue;
    }
    const target = normalizeRemoteHost(word);
    return target || null;
  }
  return null;
}
