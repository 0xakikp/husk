import { readActiveTerminal } from "./terminalContext";

export function getTerminalContextSize(): { kb: number; capped: boolean } {
  const text = readActiveTerminal();
  const kb = Math.round((text.length / 1024) * 10) / 10;
  const capped = text.length >= 8192;
  return { kb, capped };
}
