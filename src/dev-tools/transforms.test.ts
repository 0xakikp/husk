import { describe, expect, it } from "vitest";
import { transformDevValue } from "./transforms";

describe("Dev Tools transformations", () => {
  it("formats and minifies JSON without changing its value", () => {
    expect(transformDevValue("json", '{"husk":true}').output).toBe('{\n  "husk": true\n}');
    expect(transformDevValue("json", '{ "husk": true }', { jsonOperation: "minify" }).output).toBe('{"husk":true}');
  });

  it("decodes a JWT payload locally", () => {
    const output = transformDevValue("jwt", "eyJhbGciOiJub25lIn0.eyJuYW1lIjoiaHVzayJ9.").output;
    expect(output).toContain('"alg": "none"');
    expect(output).toContain('"name": "husk"');
  });

  it("encodes then decodes Unicode Base64 text", () => {
    const encoded = transformDevValue("base64", "Husk ✦").output;
    expect(transformDevValue("base64", encoded, { decode: true }).output).toBe("Husk ✦");
  });

  it("turns Unix seconds into an ISO date", () => {
    expect(transformDevValue("timestamp", "0").output).toContain("ISO: 1970-01-01T00:00:00.000Z");
  });
});
