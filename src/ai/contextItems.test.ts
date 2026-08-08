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
    expect(scanForSecrets("terminal output", "ghp_abcdefghijklmnopqrstuvwxyz")).toContain("GitHub token");
  });

  it("builds the inspected terminal block exactly as it is sent to the model", () => {
    const item = { ...contextItem("output", 12), preview: "pnpm test\npassed" };

    expect(itemToRequestBlock(item)).toBe("\n\nActive terminal output:\n```\npnpm test\npassed\n```");
  });
});
