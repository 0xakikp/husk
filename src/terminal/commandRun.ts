/**
 * Rules for the Composer's direct terminal action.
 *
 * `Run` is deliberately much narrower than “execute this code block”. A chat
 * response can contain JavaScript, Python, a multi-line shell script, prose,
 * or a command intended for a different runtime. Typing any of that into the
 * user's live shell is both surprising and, for incomplete syntax, capable of
 * leaving it at a continuation prompt. Only an explicit, short shell one-liner
 * earns the direct action.
 */

export type TerminalRunDecision =
  | { runnable: true; command: string }
  | { runnable: false; reason: string };

const SHELL_LANGUAGES = new Set(["sh", "bash", "zsh", "shell"]);
const MAX_DIRECT_COMMAND_CHARS = 480;

export function getTerminalRunDecision(language: string, code: string): TerminalRunDecision {
  const lang = language.trim().toLowerCase();
  if (!SHELL_LANGUAGES.has(lang)) {
    return {
      runnable: false,
      reason: lang
        ? `${lang} source is not sent directly to a shell`
        : "Label a single shell command as sh, bash, or zsh to run it",
    };
  }

  const lines = code
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== 1) {
    return { runnable: false, reason: "Multi-line scripts are copy-only so you can review them first" };
  }

  const command = lines[0];
  if (command.startsWith("#")) {
    return { runnable: false, reason: "A comment is not a runnable command" };
  }
  if (command.length > MAX_DIRECT_COMMAND_CHARS) {
    return { runnable: false, reason: "Long commands are copy-only so they do not flood the terminal" };
  }

  return { runnable: true, command };
}
