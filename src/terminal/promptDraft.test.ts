import { describe, expect, it } from "vitest";
import { absolutePromptPosition, readEditablePrompt, type PromptBuffer } from "./promptDraft";

function buffer(lines: string[], overrides: Partial<PromptBuffer> = {}): PromptBuffer {
  return {
    type: "normal",
    baseY: 0,
    cursorY: 0,
    cursorX: 0,
    getLine: (row) => lines[row] == null ? undefined : { translateToString: () => lines[row] },
    ...overrides,
  };
}

describe("terminal prompt draft", () => {
  it("records prompt markers against baseY, not the scrolled viewport", () => {
    expect(absolutePromptPosition({ baseY: 120, cursorY: 3, cursorX: 7 })).toEqual({ row: 123, col: 7 });
  });

  it("does not report a visibly empty prompt as a draft", () => {
    const view = buffer(["❯ "], { cursorX: 2 });
    expect(readEditablePrompt(view, { row: 0, col: 2 })).toBe("");
  });

  it("returns typed input while excluding an autosuggestion after the cursor", () => {
    const view = buffer(["❯ git status --short"], { cursorX: 5 });
    expect(readEditablePrompt(view, { row: 0, col: 2 })).toBe("git");
  });

  it("supports wrapped multi-line input in an absolute scrollback buffer", () => {
    const lines = Array.from({ length: 43 }, () => "");
    lines[41] = "❯ echo a very long";
    lines[42] = " command";
    const view = buffer(lines, { baseY: 40, cursorY: 2, cursorX: 8 });
    expect(readEditablePrompt(view, { row: 41, col: 2 })).toBe("echo a very long command");
  });
});

