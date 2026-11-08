import { describe, expect, it } from "vitest";

import {
  fitWithinBudget,
  itemToRequestBlock,
  scanForSecrets,
  type AiContextItem,
} from "./contextItems";

function contextItem(id: string, bytes: number): AiContextItem {
  return {
    id,
    kind: "terminal",
    icon: "›_",
    label: id,
    source: "terminal",
    preview: id,
    bytes,
    sensitive: false,
    sensitiveReasons: [],
    removable: true,
  };
}

describe("AI context safety", () => {
  it("keeps only complete items within the selected budget and reports every omission", () => {
    const first = contextItem("first", 7 * 1024);
    const tooLarge = contextItem("too-large", 3 * 1024);
    const final = contextItem("final", 1 * 1024);

    const result = fitWithinBudget([first, tooLarge, final], 8);

    expect(result.kept).toEqual([first, final]);
    expect(result.dropped).toEqual([tooLarge]);
  });

  it("warns about sensitive filenames and token-shaped values before they are attached", () => {
    expect(scanForSecrets(".env.production", "PORT=3000")).toContain("sensitive filename");
    expect(scanForSecrets("terminal output", "token=super-secret-value")).toContain("assigned secret");
    expect(scanForSecrets("terminal output", "AWS_SECRET_ACCESS_KEY=example-secret-value")).toContain("assigned secret");
    expect(scanForSecrets("terminal output", "tool --password example-password")).toContain("credential argument");
    expect(scanForSecrets("terminal output", "ghp_abcdefghijklmnopqrstuvwxyz")).toContain("GitHub token");
  });

  it.each(["token", "password", "api_key", "DATABASE_PASSWORD", "AWS_SECRET_ACCESS_KEY", "SERVICE_AUTH_TOKEN"])(
    "recognizes quoted JSON credential key %s without relying on a token-shaped value", (key) => {
      for (const text of [JSON.stringify({ [key]: "example-sensitive-value" }), JSON.stringify({ [key]: "example-sensitive-value" }, null, 2)]) {
        expect(scanForSecrets("tool output", text)).toContain("assigned secret");
      }
    },
  );

  it("recognizes single-quoted credential keys while retaining unquoted assignment detection", () => {
    for (const text of ["{'token': 'example-sensitive-value'}", "DATABASE_PASSWORD=example-sensitive-value", "password: example-sensitive-value"]) {
      expect(scanForSecrets("tool output", text)).toContain("assigned secret");
    }
  });

  it.each([
    '{"name":"example-project","region":"us-east-1","port":3000}',
    '{"description":"Documentation about token and password fields"}',
    '{"token":"","password":null,"api_key":false}',
    '{"tokenCount":42,"passwordRequired":true}',
  ])("does not flag ordinary JSON without a recognized credential assignment: %s", (text) => {
    expect(scanForSecrets("tool output", text)).toEqual([]);
  });

  it("builds the inspected terminal block exactly as it is sent to the model", () => {
    const item = { ...contextItem("output", 12), preview: "pnpm test\npassed" };

    expect(itemToRequestBlock(item)).toBe("\n\nActive terminal output:\n```\npnpm test\npassed\n```");
  });
});
