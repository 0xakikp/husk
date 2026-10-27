import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TextBatch } from "./textBatch";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("streamed text batching", () => {
  it("coalesces token bursts and flushes final text exactly once", () => {
    const publish = vi.fn();
    const batch = new TextBatch(publish, () => true, new AbortController().signal);
    for (let i = 0; i < 1000; i++) batch.push("x");
    expect(publish).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TextBatch.DELAY_MS);
    expect(publish).toHaveBeenCalledExactlyOnceWith("x".repeat(1000));
    batch.push(" final"); batch.flush(); batch.dispose();
    vi.runAllTimers();
    expect(publish.mock.calls.map(([text]) => text).join("")).toBe("x".repeat(1000) + " final");
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("bounds queued and published chunks even for a very large delta", () => {
    const publish = vi.fn();
    const batch = new TextBatch(publish, () => true, new AbortController().signal);
    const text = "😀a".repeat(30000);
    batch.push(text); batch.flush();
    expect(publish.mock.calls.every(([chunk]) => chunk.length <= TextBatch.MAX_CHARS)).toBe(true);
    expect(publish.mock.calls.map(([chunk]) => chunk).join("")).toBe(text);
  });

  it("flushes received text before an explicit stop and ignores late tokens", () => {
    const controller = new AbortController();
    const publish = vi.fn();
    const batch = new TextBatch(publish, () => !controller.signal.aborted, controller.signal);
    batch.push("received"); batch.flush(); controller.abort();
    batch.push(" late"); batch.flush(); vi.runAllTimers();
    expect(publish).toHaveBeenCalledExactlyOnceWith("received");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["abort", "dispose", "stale"])("never publishes queued text after %s", (kind) => {
    const controller = new AbortController();
    let current = true;
    const publish = vi.fn();
    const batch = new TextBatch(publish, () => current, controller.signal);
    batch.push("queued");
    if (kind === "abort") controller.abort();
    if (kind === "dispose") batch.dispose();
    if (kind === "stale") current = false;
    vi.runAllTimers(); batch.push(" late"); batch.flush(); batch.dispose();
    expect(publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps text in order across tool/error transitions", () => {
    const events: string[] = [];
    const batch = new TextBatch((text) => events.push(text), () => true, new AbortController().signal);
    batch.push("first"); batch.flush(); events.push("tool");
    batch.push("second"); batch.flush(); events.push("error"); batch.dispose();
    vi.runAllTimers(); expect(events).toEqual(["first", "tool", "second", "error"]);
  });
});
