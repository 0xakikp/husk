import { afterEach, describe, expect, it } from "vitest";
import {
  ComparisonScopeTracker, MAX_COMPARISON_BYTES, MAX_COMPARISON_LINES, boundComparisonOutput, captureComparisonOutput,
  clearRunComparisons, comparisonEvidence, diffCommandRuns, dismissRunComparison, getRunComparison,
  parseComparisonClaims, recordComparisonRun, type ComparisonRunInput,
} from "./runComparison";

function run(overrides: Partial<ComparisonRunInput> = {}): void {
  recordComparisonRun({ leafId: 1, ptyId: 11, cwd: "/project", remoteHost: null, command: "npm test", output: "ok", exitCode: 0, at: 1, ...overrides });
}
afterEach(() => { for (let id = 0; id < 30; id++) clearRunComparisons(id); });

it("retains verified remote provenance after the active-shell flag resets, and recognizes return to local", () => {
  const scope = new ComparisonScopeTracker();
  scope.observeCwd("file://laptop/project", false); expect(scope.target(false)).toBeNull();
  scope.enterRemote(); expect(scope.target(true)).toBeUndefined();
  scope.observeCwd("file://server/project", true); expect(scope.target(true)).toBe("server");
  scope.observeCwd("file://server/elsewhere", false); expect(scope.target(false)).toBe("server");
  expect(scope.observeCwd("file://laptop/project", false)).toBe(true);
  expect(scope.target(false)).toBeNull();
});

it("does not treat unknown, same-host SSH, or a stale remote cwd as a local target", () => {
  const scope = new ComparisonScopeTracker(); expect(scope.target(false)).toBeUndefined();
  scope.observeCwd("file://laptop/project", false); scope.enterRemote();
  scope.observeCwd("file://laptop/remote-project", true); expect(scope.target(false)).toBeUndefined();
  scope.observeCwd("file://server/project", true); scope.leaveRemote();
  expect(scope.target(false)).toBeUndefined();
});

it("changes scope generation across reconnects and cwd round trips, not repeated identical prompts", () => {
  const scope = new ComparisonScopeTracker();
  scope.observeCwd("file://laptop/project", false);
  const initial = scope.getGeneration();
  scope.observeCwd("file://laptop/project", false); expect(scope.getGeneration()).toBe(initial);
  scope.enterRemote(); scope.observeCwd("file://server/project", true);
  const firstConnection = scope.getGeneration();
  scope.leaveRemote(); scope.enterRemote(); scope.observeCwd("file://server/project", true);
  expect(scope.getGeneration()).toBeGreaterThan(firstConnection);
  scope.observeCwd("file://server/other", false); scope.observeCwd("file://server/project", false);
  expect(scope.getGeneration()).toBeGreaterThan(firstConnection + 2);
});

it("only offers a comparison after a second matching completed run", () => {
  run({ output: "first" }); expect(getRunComparison(1)).toBeNull();
  run({ command: "git status" }); expect(getRunComparison(1)).toBeNull();
  run({ output: "second", at: 2 });
  expect(getRunComparison(1)?.before.output).toBe("first");
  expect(getRunComparison(1)?.after.output).toBe("second");
});

it("stays quiet for navigation and screen-clearing commands", () => {
  for (const command of ["cd /project", "clear", "reset", "exit"]) {
    run({ command }); run({ command }); expect(getRunComparison(1)).toBeNull();
  }
});

it.each([
  { cwd: "/another-project" }, { ptyId: 12 }, { remoteHost: "server" },
  { command: "npm  test" }, { command: "npm test --watch" }, { leafId: 2 },
])("never crosses exact terminal/host/directory/command identity: %j", (different) => {
  run(); run(different);
  expect(getRunComparison(different.leafId ?? 1)).toBeNull();
});

it("compares repeated remote runs only on the same known target", () => {
  run({ remoteHost: "alice@prod" }); run({ remoteHost: "bob@prod" });
  expect(getRunComparison(1)).toBeNull();
  run({ remoteHost: "alice@prod", at: 2 }); expect(getRunComparison(1)?.before.remoteHost).toBe("alice@prod");
});

it("dismisses the strip without forgetting the prior run and clears all state on disposal", () => {
  run(); run({ at: 2 }); dismissRunComparison(1); expect(getRunComparison(1)).toBeNull();
  run({ at: 3 }); expect(getRunComparison(1)?.before.at).toBe(2);
  clearRunComparisons(1); run({ at: 4 }); expect(getRunComparison(1)).toBeNull();
});

it("evicts old commands and panes to cap long-lived terminal memory", () => {
  run();
  for (let i = 0; i < 9; i++) run({ command: `command ${i}` });
  run(); expect(getRunComparison(1)).toBeNull();
  run({ at: 2 });
  for (let leafId = 2; leafId < 16; leafId++) run({ leafId });
  expect(getRunComparison(1)).toBeNull();
});

it("bounds whole lines in UTF-8 bytes, disclosing partial captures", () => {
  const bounded = boundComparisonOutput(Array.from({ length: 300 }, () => "😀".repeat(100)).join("\n"));
  expect(new TextEncoder().encode(bounded.output).byteLength).toBeLessThanOrEqual(MAX_COMPARISON_BYTES);
  expect(bounded.output.split("\n").length).toBeLessThanOrEqual(MAX_COMPARISON_LINES);
  expect(bounded.truncated).toBe(true);
  expect(boundComparisonOutput("x".repeat(MAX_COMPARISON_BYTES + 1))).toEqual({ output: "", truncated: true });
});

it("detects credentials even beyond the retained prefix", () => {
  run({ output: `${"ok\n".repeat(1000)}password=do-not-transmit-this` }); run();
  expect(getRunComparison(1)?.before.sensitive).toBe(true);
  expect(getRunComparison(1)?.before.truncated).toBe(true);
});

describe("deterministic evidence", () => {
  it("preserves line provenance, duplicates and changed exit status", () => {
    run({ output: "same\nfail one\nsame\nfail two", exitCode: 1 });
    run({ output: "same\npass one\nsame\nfail two", exitCode: 0 });
    const diff = diffCommandRuns(getRunComparison(1)!);
    expect(diff).toMatchObject({ added: 1, removed: 1, exitChanged: true });
    expect(diff.lines).toContainEqual({ id: "before-2", kind: "removed", text: "fail one", beforeLine: 2 });
    expect(diff.lines).toContainEqual({ id: "after-2", kind: "added", text: "pass one", afterLine: 2 });
    expect(diff.lines[diff.lines.length - 1]?.text).toBe("Exit code: 1 → 0");
  });

  it("does not invent differences for identical or empty output", () => {
    run({ output: "" }); run({ output: "" });
    expect(diffCommandRuns(getRunComparison(1)!)).toMatchObject({ added: 0, removed: 0, exitChanged: false });
  });

  it("accepts only bounded structured claims citing supplied evidence IDs", () => {
    run({ output: "bad" }); run({ output: "good" });
    const evidence = comparisonEvidence(diffCommandRuns(getRunComparison(1)!));
    const valid = { claims: [{ text: "Output changed.", evidence: ["before-1", "after-1"] }] };
    expect(parseComparisonClaims(JSON.stringify(valid), evidence)).toEqual(valid.claims);
    for (const invalid of ["free prose", '{"claims":[]}', '{"claims":[{"text":"Invented","evidence":["after-999"]}]}', '{"claims":[{"text":"Unsupported","evidence":[]}]}']) {
      expect(() => parseComparisonClaims(invalid, evidence)).toThrow();
    }
  });

  it("keeps JSON evidence under its byte budget even with escapable output", () => {
    run({ output: Array.from({ length: 190 }, () => '"\\'.repeat(25)).join("\n") });
    run({ output: Array.from({ length: 190 }, () => "new".repeat(20)).join("\n") });
    const evidence = comparisonEvidence(diffCommandRuns(getRunComparison(1)!));
    expect(new TextEncoder().encode(JSON.stringify(evidence)).byteLength).toBeLessThanOrEqual(12 * 1024);
    expect(evidence.some((line) => line.id === "exit")).toBe(true);
  });
});

it("captures wrapped and non-newline output while marking trimmed scrollback incomplete", () => {
  const data = ["prompt", "first ", "wrapped", "last"];
  const buffer = {
    baseY: 0, cursorY: 3, cursorX: 4,
    getLine: (index: number) => ({ isWrapped: index === 2, translateToString: () => data[index] }),
  };
  expect(captureComparisonOutput(buffer, 1)).toEqual({ output: "first wrapped\nlast", truncated: false });
  expect(captureComparisonOutput(buffer, null).truncated).toBe(true);
});
