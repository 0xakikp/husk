import { expect, it } from "vitest";
import {
  CommandOutputScopeTracker, MAX_COMMAND_OUTPUT_BYTES, MAX_COMMAND_OUTPUT_LINES,
  boundCommandOutput, captureCommandOutput,
} from "./commandOutputCapture";

it("retains verified remote provenance after the active-shell flag resets, and recognizes return to local", () => {
  const scope = new CommandOutputScopeTracker();
  scope.observeCwd("file://laptop/project", false); expect(scope.target(false)).toBeNull();
  scope.enterRemote(); expect(scope.target(true)).toBeUndefined();
  scope.observeCwd("file://server/project", true); expect(scope.target(true)).toBe("server");
  scope.observeCwd("file://server/elsewhere", false); expect(scope.target(false)).toBe("server");
  expect(scope.observeCwd("file://laptop/project", false)).toBe(true);
  expect(scope.target(false)).toBeNull();
});

it("does not treat unknown, same-host SSH, or a stale remote cwd as a local target", () => {
  const scope = new CommandOutputScopeTracker(); expect(scope.target(false)).toBeUndefined();
  scope.observeCwd("file://laptop/project", false); scope.enterRemote();
  scope.observeCwd("file://laptop/remote-project", true); expect(scope.target(false)).toBeUndefined();
  scope.observeCwd("file://server/project", true); scope.leaveRemote();
  expect(scope.target(false)).toBeUndefined();
});

it("changes scope generation across reconnects and cwd round trips, not repeated identical prompts", () => {
  const scope = new CommandOutputScopeTracker();
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

it("bounds whole lines in UTF-8 bytes, disclosing partial captures", () => {
  const bounded = boundCommandOutput(Array.from({ length: 300 }, () => "😀".repeat(100)).join("\n"));
  expect(new TextEncoder().encode(bounded.output).byteLength).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_BYTES);
  expect(bounded.output.split("\n").length).toBeLessThanOrEqual(MAX_COMMAND_OUTPUT_LINES);
  expect(bounded.truncated).toBe(true);
  expect(boundCommandOutput("x".repeat(MAX_COMMAND_OUTPUT_BYTES + 1))).toEqual({ output: "", truncated: true });
});

it("captures wrapped and non-newline output while marking trimmed scrollback incomplete", () => {
  const data = ["prompt", "first ", "wrapped", "last"];
  const buffer = {
    baseY: 0, cursorY: 3, cursorX: 4,
    getLine: (index: number) => ({ isWrapped: index === 2, translateToString: () => data[index] }),
  };
  expect(captureCommandOutput(buffer, 1)).toEqual({ output: "first wrapped\nlast", truncated: false });
  expect(captureCommandOutput(buffer, null).truncated).toBe(true);
});
