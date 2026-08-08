import { afterEach, describe, expect, it } from "vitest";

import {
  classifyFailure,
  clearFailure,
  collapseFailure,
  expandFailure,
  getFailure,
  recordFailure,
} from "./failureStore";

const testLeaf = 9_001;

afterEach(() => clearFailure(testLeaf));

describe("command failure assistant", () => {
  it.each([
    ["npm run dev", "Error: listen EADDRINUSE: address already in use", "port"],
    ["cat file", "permission denied", "permission"],
    ["pnpm install", "ENOTFOUND registry.npmjs.org", "network"],
    ["node app", "command not found", "dependency"],
    ["git pull", "fatal: refusing to merge unrelated histories", "git"],
    ["pnpm test", "", "test"],
    ["echo okay", "unrecognised output", "unknown"],
  ] as const)("classifies %s failures as %s", (command, output, expected) => {
    expect(classifyFailure(command, output)).toBe(expected);
  });

  it("keeps a failure attached to its pane, warns about secrets, and supports collapse", () => {
    recordFailure(testLeaf, {
      command: "deploy",
      output: "token=super-secret-value",
      exitCode: 1,
      cwd: "/work/husk",
    });

    expect(getFailure(testLeaf)).toMatchObject({
      collapsed: false,
      record: { command: "deploy", sensitive: true },
    });

    collapseFailure(testLeaf);
    expect(getFailure(testLeaf)?.collapsed).toBe(true);

    expandFailure(testLeaf);
    expect(getFailure(testLeaf)?.collapsed).toBe(false);
  });

  it("does not create a failure strip for a successful command", () => {
    recordFailure(testLeaf, { command: "true", output: "", exitCode: 0, cwd: "/work/husk" });

    expect(getFailure(testLeaf)).toBeNull();
  });
});
