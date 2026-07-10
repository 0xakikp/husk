/**
 * Quote a value for safe interpolation into a POSIX shell command string.
 *
 * Wraps the value in single quotes — inside which nothing is special — and
 * escapes any embedded single quote as the standard `'\''` sequence. Use this
 * for every externally-derived value (paths, container/pod names, ssh hosts,
 * aws profiles, branches, …) before splicing it into a command run through
 * `sh -lc` or typed into the PTY. Without it, a value containing `;`, `$(…)`,
 * backticks, or quotes would be executed as code.
 *
 *   shq("a'b")        -> 'a'\''b'
 *   shq("$(rm -rf ~)") -> '$(rm -rf ~)'   (a literal string, not a subshell)
 */
export function shq(value: string | number): string {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/**
 * Tokenize a simple shell-like command string into program + args.
 * Handles single- and double-quoted substrings, including the escaped single
 * quote sequence `'\''`. This lets callers keep using `shq()` in template
 * literals while the backend executes via `Command::arg()` (no shell invoked).
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: "'" | '"' | null = null;
  let i = 0;

  while (i < command.length) {
    const c = command[i];
    if (inQuote === "'") {
      if (c === "'") {
        // escaped single quote: '\''
        if (command.slice(i, i + 4) === "'\\''") {
          current += "'";
          i += 4;
          continue;
        }
        inQuote = null;
      } else {
        current += c;
      }
    } else if (inQuote === '"') {
      if (c === '"') {
        inQuote = null;
      } else {
        current += c;
      }
    } else if (c === "'" || c === '"') {
      inQuote = c;
    } else if (/\s/.test(c)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += c;
    }
    i++;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
