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
