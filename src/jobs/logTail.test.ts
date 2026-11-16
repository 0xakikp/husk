import { describe, expect, it } from "vitest";
import { appendJobLogTail, MAX_JOB_LOG_CHARS } from "./logTail";

describe("background job log tail", () => {
  it("keeps small chunks in order without marking them omitted", () => {
    expect(appendJobLogTail("first\n", "second\n")).toEqual({ text: "first\nsecond\n", trimmed: false });
  });

  it("bounds accumulated output while preserving the newest characters", () => {
    const first = "a".repeat(MAX_JOB_LOG_CHARS - 2);
    const result = appendJobLogTail(first, "bcdef");
    expect(result.text).toHaveLength(MAX_JOB_LOG_CHARS);
    expect(result.text).toBe(`${"a".repeat(MAX_JOB_LOG_CHARS - 5)}bcdef`);
    expect(result.trimmed).toBe(true);
  });

  it("bounds a single native read larger than the UI tail", () => {
    const result = appendJobLogTail("older", `${"x".repeat(MAX_JOB_LOG_CHARS)}new`);
    expect(result.text).toHaveLength(MAX_JOB_LOG_CHARS);
    expect(result.text.endsWith("new")).toBe(true);
    expect(result.text.includes("older")).toBe(false);
    expect(result.trimmed).toBe(true);
  });

  it("does not drop a previous tail when an incoming chunk is exactly the limit", () => {
    const result = appendJobLogTail("before", "z".repeat(MAX_JOB_LOG_CHARS));
    expect(result.text).toBe("z".repeat(MAX_JOB_LOG_CHARS));
    expect(result.trimmed).toBe(true);
  });
});
