import { describe, expect, it } from "vitest";
import { assertAiRequest, beginAiRequest, cancelAiRequest, finishAiRequest, isCurrentAiRequest } from "./requestLifecycle";

describe("AI request ownership", () => {
  it("rejects concurrent views and keeps stale completion from retiring the new request", () => {
    const old = beginAiRequest("chat")!;
    expect(beginAiRequest("chat")).toBeNull();
    cancelAiRequest(old);
    const next = beginAiRequest("chat")!;
    finishAiRequest(old);
    expect(isCurrentAiRequest(next)).toBe(true);
    expect(() => assertAiRequest(old)).toThrow("Request stopped");
    cancelAiRequest(next);
  });
  it("cancels only the originating conversation", () => {
    const a = beginAiRequest("a")!;
    const b = beginAiRequest("b")!;
    cancelAiRequest(a);
    expect(isCurrentAiRequest(b)).toBe(true);
    cancelAiRequest(b);
  });
});
