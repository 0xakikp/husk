export type PromptPosition = { row: number; col: number };

type PromptLine = { translateToString(trimRight?: boolean): string } | undefined;

export type PromptBuffer = {
  type: string;
  baseY: number;
  cursorY: number;
  cursorX: number;
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
    const line = buffer.getLine(row)?.translateToString(true) ?? "";
    const start = row === prompt.row ? prompt.col : 0;
    const end = row === cursorRow ? buffer.cursorX : line.length;
    if (end > start) parts.push(line.slice(start, end));
  }
  return parts.join("").trim();
}

