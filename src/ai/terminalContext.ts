/**
 * Lets the AI panel read the active terminal's recent output. The active
 * TerminalView registers a reader; the panel calls it when sending a message.
 */
let reader: (() => string) | null = null;

export function setActiveTerminalReader(fn: (() => string) | null): void {
  reader = fn;
}

export function readActiveTerminal(maxChars = 4000): string {
  const text = reader ? reader() : "";
  return text.length > maxChars ? text.slice(-maxChars) : text;
}
