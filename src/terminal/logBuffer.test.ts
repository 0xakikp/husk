import { describe, expect, it } from "vitest";
import { LOG_LIMITS, TerminalLogBuffer } from "./logBuffer";

describe("bounded terminal log preview", () => {
  it("bounds an endless partial line in characters and UTF-8 bytes", () => {
    const buffer = new TerminalLogBuffer();
    for (let i = 0; i < 1000; i++) buffer.append("界😀".repeat(100));
    expect(buffer.pendingChars).toBeLessThanOrEqual(LOG_LIMITS.lineChars);
    expect(buffer.retainedBytes).toBeLessThanOrEqual(LOG_LIMITS.lineBytes);
    expect(buffer.snapshot()).toEqual([]);
    buffer.append("\nnext line\n", 123);
    const [first, second] = buffer.snapshot();
    expect(first.text).toContain("[line truncated]");
    expect(new TextEncoder().encode(first.text).length).toBeLessThanOrEqual(LOG_LIMITS.lineBytes);
    expect(second).toMatchObject({ text: "next line", at: 123 });
    expect(buffer.isLimited).toBe(true);
  });

  it("bounds the combined completed rows, not only their count", () => {
    const buffer = new TerminalLogBuffer();
    for (let i = 0; i < 5000; i++) buffer.append(`${i}: ${"x".repeat(4000)}\n`);
    const rows = buffer.snapshot();
    expect(rows.length).toBeLessThanOrEqual(LOG_LIMITS.lines);
    expect(buffer.retainedBytes).toBeLessThanOrEqual(LOG_LIMITS.bytes);
    expect(rows[rows.length - 1]?.text).toContain("4999:");
    expect(new Set(rows.map(({ id }) => id)).size).toBe(rows.length);
  });

  it("keeps IDs unique through blank lines and preserves row identity between batches", () => {
    const buffer = new TerminalLogBuffer();
    buffer.append("first\n\nthird\n");
    const first = buffer.snapshot()[0];
    buffer.append("fourth\n");
    expect(buffer.snapshot().map(({ id }) => id)).toEqual([1, 3, 4]);
    expect(buffer.snapshot()[0]).toBe(first);
  });

  it("handles split ANSI/OSC sequences without retaining payload or splitting CRLF", () => {
    const buffer = new TerminalLogBuffer();
    buffer.append("\x1b[3"); buffer.append("1merror\x1b[0m\r"); buffer.append("\n");
    buffer.append("\x1b]private;");
    for (let i = 0; i < 100; i++) buffer.append("secret".repeat(1000));
    expect(buffer.pendingChars).toBe(0);
    buffer.append("\x1b"); buffer.append("\\ready\n");
    expect(buffer.snapshot().map(({ id, text, level }) => ({ id, text, level }))).toEqual([
      { id: 1, text: "error", level: "error" }, { id: 2, text: "ready", level: "info" },
    ]);
  });

  it("does not stitch text across a paused interval", () => {
    const buffer = new TerminalLogBuffer();
    buffer.append("before"); buffer.discardPartial(); buffer.append("after\n");
    expect(buffer.snapshot()[0].text).toBe("after");
  });
});
