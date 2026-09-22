import { describe, expect, it } from "vitest";
import { absolutePromptPosition, inspectPromptReadiness, readEditablePrompt, type PromptBuffer } from "./promptDraft";

function buffer(lines: string[], overrides: Partial<PromptBuffer> = {}): PromptBuffer {
  return {
    type: "normal",
    baseY: 0,
    cursorY: 0,
    cursorX: 0,
    length: lines.length,
    getLine: (row) => lines[row] == null ? undefined : { translateToString: (_trimRight, startColumn = 0, endColumn) => lines[row].slice(startColumn, endColumn) },
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

describe("verified empty prompt for staging", () => {
  it("accepts a known empty prompt with blank rows below it", () => {
    expect(inspectPromptReadiness(buffer(["❯ ", "", ""], { cursorX: 2 }), { row: 0, col: 2 })).toEqual({ ready: true });
  });
  it.each([
    { text: "❯ existing input", cursorX: 2 },
    { text: "❯ ghost autosuggestion", cursorX: 2 },
    { text: "❯ typed", cursorX: 7 },
    { text: "❯   ", cursorX: 4 },
  ])("refuses visible or entered text, including to the right of Home: %j", ({ text, cursorX }) => {
    expect(inspectPromptReadiness(buffer([text], { cursorX }), { row: 0, col: 2 }).ready).toBe(false);
  });
  it("refuses continuation text below the cursor", () => {
    expect(inspectPromptReadiness(buffer(["❯ ", "continuation"], { cursorX: 2 }), { row: 0, col: 2 }).ready).toBe(false);
  });
  it("fails closed when the marker is missing, stale after clear, or not a normal shell buffer", () => {
    const view = buffer(["❯ existing"], { cursorX: 2 });
    expect(inspectPromptReadiness(view, null).ready).toBe(false);
    expect(inspectPromptReadiness(view, { row: 100, col: 2 }).ready).toBe(false);
    expect(inspectPromptReadiness({ ...view, type: "alternate" }, { row: 0, col: 2 }).ready).toBe(false);
  });
  it("bounds scans and refuses missing lines instead of assuming they are blank", () => {
    expect(inspectPromptReadiness(buffer(["❯ "], { cursorX: 2, length: 600 }), { row: 0, col: 2 }).ready).toBe(false);
    expect(inspectPromptReadiness(buffer(["❯ "], { cursorX: 2, length: 2 }), { row: 0, col: 2 }).ready).toBe(false);
  });
});
