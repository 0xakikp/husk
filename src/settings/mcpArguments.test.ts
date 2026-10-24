import { describe, expect, it } from "vitest";
import { formatMcpArguments, parseMcpArguments } from "./mcpArguments";

describe("MCP argument editor", () => {
  it.each([
    [], ["--folder", "/My Project"], ["", "  whitespace  ", 'literal "quotes"', "line\nbreak"],
    ["C:\\Program Files\\tool", "😀", "$(never execute)", "; & |"],
  ].map((value) => ({ value })))("round-trips $value without interpreting shell syntax", ({ value }) => {
    expect(parseMcpArguments(formatMcpArguments(value))).toEqual(value);
  });
  it.each(['--folder "/My Project"', '{}', '[1]', '[null]', '["unterminated]', '["\\u0000"]'])('rejects invalid arguments: %s', (input) => {
    expect(() => parseMcpArguments(input)).toThrow(/Arguments/);
  });
  it("bounds argument count and text size", () => {
    expect(() => parseMcpArguments(JSON.stringify(Array(1025).fill("x")))).toThrow(/1,024/);
    expect(() => parseMcpArguments(JSON.stringify(["x".repeat(128_000)]))).toThrow(/128 KB/);
  });
});
