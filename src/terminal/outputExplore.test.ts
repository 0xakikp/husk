import { describe, expect, it } from "vitest";
import { captureOutput, numericColumns, outputOutline, parseOutputTable, type OutputSnapshot } from "./outputExplore";

const snapshot = (text: string): OutputSnapshot => captureOutput(text.split("\n").map((line, index) => ({ id: index + 11, text: line })), "Selected output");

describe("bounded output capture", () => {
  it("freezes a contiguous suffix and reports excluded lines", () => {
    const lines = Array.from({ length: 300 }, (_, index) => ({ id: index + 1, text: `row ${index}` }));
    const captured = captureOutput(lines, "Filtered logs");
    expect(captured.lines).toHaveLength(240);
    expect(captured.omitted).toBe(60);
    expect(captured.lines[0].id).toBe(61);
    lines[299].text = "changed";
    expect(captured.lines[239].text).toBe("row 299");
  });

  it("does not join disjoint rows across an oversized UTF-8 line", () => {
    const captured = captureOutput([{ id: 1, text: "name,value" }, { id: 2, text: "界".repeat(20_000) }, { id: 3, text: "last,3" }], "Logs");
    expect(captured.lines.map((line) => line.id)).toEqual([3]);
    expect(captured.omitted).toBe(2);
    expect(parseOutputTable(captured)).toBeNull();
  });
});

describe("exact structured values", () => {
  it("parses quoted commas and quotes without altering cells or source IDs", () => {
    const table = parseOutputTable(snapshot('name,duration\n"compile, client",001.20ms\n"test ""unit""",2.40ms'))!;
    expect(table.format).toBe("CSV");
    expect(table.rows).toEqual([
      { cells: ["compile, client", "001.20ms"], lineIds: [12] },
      { cells: ['test "unit"', "2.40ms"], lineIds: [13] },
    ]);
    expect(numericColumns(table)).toEqual([{ index: 1, unit: "ms", values: [1.2, 2.4] }]);
  });

  it("preserves duplicate TSV rows rather than aggregating them", () => {
    const table = parseOutputTable(snapshot("name\tbytes\nworker\t1024\nworker\t1024"))!;
    expect(table.format).toBe("TSV");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].lineIds).not.toEqual(table.rows[1].lineIds);
  });

  it("preserves JSON numeric lexemes and maps reordered keys to the correct columns", () => {
    const table = parseOutputTable(snapshot('[\n{"name":"large", "count":9007199254740993},\n{"count":1.2300e+2,"name":"small"}\n]'))!;
    expect(table.rows).toEqual([
      { cells: ["large", "9007199254740993"], lineIds: [12] },
      { cells: ["small", "1.2300e+2"], lineIds: [13] },
    ]);
    expect(numericColumns(table)).toEqual([]);
  });

  it("links pretty-printed JSON records to all of their actual source lines", () => {
    const table = parseOutputTable(snapshot('[\n{\n"name":"task",\n"duration":3\n}\n]'))!;
    expect(table.rows[0].lineIds).toEqual([12, 13, 14, 15]);
  });

  it("retains null, booleans and markup as plain values", () => {
    const table = parseOutputTable(snapshot('[{"name":"<img src=x onerror=evil()>","ok":true,"result":null}]'))!;
    expect(table.rows[0].cells).toEqual(["<img src=x onerror=evil()>", "true", "null"]);
  });

  it.each([
    "name,name\na,1", "name, name\na,1", "name,value\na,1,2",
    'name,value\n"unterminated,2', 'name,value\n"has\nnewline",2', "1,2\n3,4",
    '[{"name":"a","value":1,"value":2}]', '[{"name":"a","value":{"nested":1}}]',
    '[{"name":"a","value":1},{"name":"b","different":2}]', "[]", "arbitrary log output",
  ])("refuses ambiguous or unsupported data: %s", (text) => {
    expect(parseOutputTable(snapshot(text))).toBeNull();
  });

  it("bounds rows and columns", () => {
    expect(parseOutputTable(snapshot(`name,value\n${Array.from({ length: 201 }, () => "a,1").join("\n")}`))).toBeNull();
    const headers = Array.from({ length: 13 }, (_, index) => `column${index}`);
    expect(parseOutputTable(snapshot(`${headers.join(",")}\n${headers.map(() => "1").join(",")}`))).toBeNull();
  });
});

describe("charts and source outlines", () => {
  it.each(["name,time\na,2ms\nb,1s", "name,time\na,-2\nb,1", "name,time\na,Infinity\nb,1", "name,time\na,1e999\nb,1", "name,time\na,1e-999\nb,1", "name,time\na,\nb,1"])("does not chart mismatched units or unsupported values: %s", (text) => {
    expect(numericColumns(parseOutputTable(snapshot(text))!)).toEqual([]);
  });

  it("allows zero values and consistent percent units without conversion", () => {
    expect(numericColumns(parseOutputTable(snapshot("disk,used\na,0%\nb,42.5%"))!)).toEqual([{ index: 1, unit: "%", values: [0, 42.5] }]);
  });

  it("uses bounded exact section text and source IDs rather than invented labels", () => {
    const captured = snapshot("ordinary output\n### Build client\nerror: missing dependency\n=== Tests ===\nstill running");
    expect(outputOutline(captured)).toEqual({ items: [captured.lines[1], captured.lines[2], captured.lines[3]], omitted: 0 });
    const many = snapshot(Array.from({ length: 20 }, (_, index) => `### Step ${index}`).join("\n"));
    expect(outputOutline(many).items).toHaveLength(16);
    expect(outputOutline(many).omitted).toBe(4);
  });
});
