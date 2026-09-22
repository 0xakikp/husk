import { describe, expect, it, vi } from "vitest";
vi.mock("./screenAssist", () => ({ parseScreenObject: (text: string) => JSON.parse(text) }));
import { parsePeekResult, parseTweakResult, selectionLines, validateStagedCommand } from "./screenSelection";

describe("screen selection evidence", () => {
  it("keeps exact selected lines with stable IDs", () => {
    expect(selectionLines("error\n  detail")).toEqual([{ id: 1, text: "error" }, { id: 2, text: "  detail" }]);
  });
  it("refuses large selections instead of silently sending a prefix", () => {
    expect(() => selectionLines("é".repeat(6200))).toThrow("12 KB");
    expect(() => selectionLines("line\n".repeat(161))).toThrow("160 lines");
  });
  it("accepts only references to lines actually selected", () => {
    expect(parsePeekResult('{"explanation":"A permission error.","sourceLineIds":[1,1]}', [1])).toEqual({ explanation: "A permission error.", sourceLineIds: [1] });
    expect(() => parsePeekResult('{"explanation":"Cause","sourceLineIds":[42]}', [1])).toThrow("valid selected lines");
    expect(() => parsePeekResult('{"explanation":"Cause","sourceLineIds":[]}', [1])).toThrow("valid selected lines");
  });
});
describe("command proposals", () => {
  it.each(["pwd\nid", "pwd\r", "pwd\x1b[201~", "$ pwd", "```sh\npwd\n```", "ls\u2028id", "# comment", ""])("refuses executable control/prompt syntax: %j", (command) => {
    expect(() => validateStagedCommand(command)).toThrow("one plain command");
  });
  it("preserves a single command exactly, without executing or escaping it", () => {
    expect(validateStagedCommand("find . -type f -not -path './node_modules/*'")).toBe("find . -type f -not -path './node_modules/*'");
  });
  it("supports refusing unsupported transformations instead of inventing flags", () => {
    expect(parseTweakResult('{"command":null,"explanation":"This tool has no dry-run flag."}')).toEqual({ command: null, explanation: "This tool has no dry-run flag." });
    expect(() => parseTweakResult('{"command":"ls\\npwd","explanation":"two commands"}')).toThrow("one plain command");
  });
});
