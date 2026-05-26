/**
 * Terminal AI Input — intercepts `/ai <question>` typed into any terminal
 * before it reaches the PTY shell.
 *
 * How it works:
 * 1. User types `/ai why did this fail?` normally (shell echoes each char)
 * 2. User hits Enter — `term.onData` fires with `\r`
 * 3. We read the current terminal line; if it contains `/ai ` we intercept
 * 4. We do NOT send Enter to the PTY
 * 5. We send Ctrl+A + Ctrl+K to the PTY — readline clears the input after
 *    the prompt, leaving the prompt intact
 * 6. The query is forwarded to the AI output window
 *
 * This works at the xterm.js layer (frontend), so it works identically
 * for local shells, SSH, docker exec, tmux, etc.
 */

type AiQueryListener = (query: string) => void;
type PtyWriter = (data: string) => void;

let listener: AiQueryListener | null = null;
let ptyWriter: PtyWriter | null = null;

/** Register the listener that receives intercepted `/ai` queries. */
export function setAiQueryListener(fn: AiQueryListener | null): void {
  listener = fn;
}

/** Register the PTY writer so we can send Ctrl+A+Ctrl+K to clear input. */
export function setAiPtyWriter(fn: PtyWriter | null): void {
  ptyWriter = fn;
}

/** Read the current input line from the active terminal buffer. */
let lineReader: (() => string) | null = null;

export function setTerminalLineReader(fn: (() => string) | null): void {
  lineReader = fn;
}

function getCurrentTerminalLine(): string {
  if (!lineReader) return "";
  return lineReader();
}

/**
 * Intercept key data before it's sent to the PTY.
 * Returns the data that should actually be written to the PTY,
 * or `null` when the entire chunk should be swallowed.
 */
export function interceptTerminalInput(data: string): string | null {
  // We only intercept when the user types Enter (\r or \n)
  if (data !== "\r" && data !== "\n" && data !== "\r\n") return data;

  const line = getCurrentTerminalLine();
  const idx = line.lastIndexOf("/ai ");
  if (idx < 0) return data;

  const query = line.slice(idx + 4).trim();
  if (!query) return data;

  // Intercept! Don't send Enter to the shell.
  // Send Ctrl+A (\x01) then Ctrl+K (\x0b) to the PTY.
  // Readline moves cursor to start of input, then deletes to end.
  // The prompt remains; the `/ai ...` text disappears.
  if (ptyWriter) {
    ptyWriter("\x01\x0b");
  }

  if (listener) {
    listener(query);
  }

  return null; // swallow the Enter
}
