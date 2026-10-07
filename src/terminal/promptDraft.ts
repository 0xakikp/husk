export type PromptPosition = { row: number; col: number };

type PromptLine = {
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
  readonly length?: number;
  getCell?(column: number): { getChars(): string } | undefined;
} | undefined;

export type PromptBuffer = {
  type: string;
  baseY: number;
  cursorY: number;
  cursorX: number;
  length?: number;
  getLine(row: number): PromptLine;
};

/** xterm's cursorY is relative to the normal buffer base, not the user's
 * scroll viewport. Prompt markers and later draft reads must use this same
 * coordinate system or a scrolled/restored terminal can treat old output as
 * unsubmitted input. */
export function absolutePromptPosition(buffer: Pick<PromptBuffer, "baseY" | "cursorY" | "cursorX">): PromptPosition {
  return { row: buffer.baseY + buffer.cursorY, col: buffer.cursorX };
}

/** Return only editable characters between OSC 133 B and the current cursor.
 * Text to the right of the cursor (for example a painted autosuggestion) is
 * deliberately excluded. */
export function readEditablePrompt(buffer: PromptBuffer, prompt: PromptPosition | null): string {
  if (!prompt || buffer.type !== "normal") return "";
  const cursorRow = buffer.baseY + buffer.cursorY;
  if (cursorRow < prompt.row) return "";

  const parts: string[] = [];
  for (let row = prompt.row; row <= cursorRow; row += 1) {
    const line = buffer.getLine(row);
    const start = row === prompt.row ? prompt.col : 0;
    const end = row === cursorRow ? buffer.cursorX : undefined;
    // Prompt/cursor columns are terminal cells, not UTF-16 string offsets.
    if (end === undefined || end > start) parts.push(line?.translateToString(true, start, end) ?? "");
  }
  return parts.join("").trim();
}

export type PromptReadiness = { ready: true } | { ready: false; reason: string };

/** Staging must prove a genuinely empty prompt, not just an empty prefix to
 * the cursor. Unknown/stale markers, Home before a draft, trailing text and
 * autosuggestions all fail closed. This does not mutate or clear shell input. */
export function inspectPromptReadiness(buffer: PromptBuffer, prompt: PromptPosition | null): PromptReadiness {
  const unknown: PromptReadiness = { ready: false, reason: "Husk cannot verify an empty shell prompt. Return to a fresh prompt or copy the command instead." };
  const input: PromptReadiness = { ready: false, reason: "The terminal already has input. Clear or submit it before continuing." };
  if (!prompt || buffer.type !== "normal" || !Number.isInteger(prompt.row) || !Number.isInteger(prompt.col)
    || prompt.row < 0 || prompt.col < 0) return unknown;
  const cursorRow = buffer.baseY + buffer.cursorY;
  // A cursor before the saved prompt normally means a screen clear or stale marker.
  if (cursorRow < prompt.row || (cursorRow === prompt.row && buffer.cursorX < prompt.col)) return unknown;
  if (cursorRow !== prompt.row || buffer.cursorX !== prompt.col) return input;
  const length = buffer.length;
  if (length == null || !Number.isInteger(length) || length <= cursorRow || length - cursorRow > 512) return unknown;
  let characters = 0;
  let cells = 0;
  // Include the remainder of the line and visible continuation lines. A
  // bounded conservative scan may reject decoration, but never inserts into it.
  for (let row = cursorRow; row < length; row++) {
    const line = buffer.getLine(row);
    if (!line) return unknown;
    const text = line.translateToString(true, row === cursorRow ? prompt.col : 0);
    characters += text.length;
    if (characters > 32 * 1024) return unknown;
    if (text.trim()) return input;
    // Home before a spaces-only draft is still input. xterm's string view
    // trims both untouched null cells and literal spaces, so distinguish them
    // using cells when available. Erased/padded cells contain no characters.
    if (line.getCell && line.length != null) {
      const start = row === cursorRow ? prompt.col : 0;
      cells += line.length - start;
      if (cells > 256 * 1024) return unknown;
      for (let column = start; column < line.length; column++) {
        const cell = line.getCell(column);
        if (!cell) return unknown;
        if (cell.getChars()) return input;
      }
    }
  }
  return { ready: true };
}
