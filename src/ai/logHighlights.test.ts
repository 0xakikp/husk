import { expect, it } from "vitest";
import { captureLogHighlights, logHighlightsPrompt, parseLogHighlights } from "./logHighlights";

it("freezes a bounded sample without chopping lines", () => {
  const lines = Array.from({ length: 200 }, (_, id) => ({ id, text: `line ${id}` }));
  const snapshot = captureLogHighlights(lines, "All logs");
  expect(snapshot.lines).toHaveLength(120);
  expect(snapshot.omitted).toBe(80);
  lines[199].text = "later output";
  expect(snapshot.lines[119].text).toBe("line 199");
  expect(logHighlightsPrompt(snapshot)).not.toContain("later output");
});
it("accounts for UTF-8 bytes and reports excluded oversized lines", () => {
  const snapshot = captureLogHighlights([{ id: 1, text: "useful" }, { id: 2, text: "é".repeat(10000) }], "All");
  expect(snapshot.lines).toEqual([{ id: 1, text: "useful" }]);
  expect(snapshot.omitted).toBe(1);
});
it("accepts only findings with real source evidence", () => {
  const snapshot = captureLogHighlights([{ id: 7, text: "Warning: retry" }], "Warning logs");
  expect(parseLogHighlights('{"findings":[{"summary":"A retry warning is present.","lineIds":[7]}]}', snapshot)).toHaveLength(1);
  expect(parseLogHighlights('{"findings":[]}', snapshot)).toEqual([]);
  expect(() => parseLogHighlights('{"findings":[{"summary":"made up","lineIds":[8]}]}', snapshot)).toThrow("valid evidence");
  expect(() => parseLogHighlights('{"findings":[{"summary":"unlinked","lineIds":[]}]}', snapshot)).toThrow("valid evidence");
});
