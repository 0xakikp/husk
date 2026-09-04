import { describe, expect, it } from "vitest";
import { resolveAiConversationFontSize } from "./preferences";

describe("resolveAiConversationFontSize", () => {
  it("follows terminal text at one pixel smaller", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(13);
  });

  it("keeps followed text within the readable 12–15px range", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 11, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(12);
    expect(resolveAiConversationFontSize({ terminalFontSize: 18, aiFontSizeMode: "terminal", aiMiniFontSize: 9 })).toBe(15);
  });

  it("uses and bounds the independent custom size", () => {
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "custom", aiMiniFontSize: 16 })).toBe(16);
    expect(resolveAiConversationFontSize({ terminalFontSize: 14, aiFontSizeMode: "custom", aiMiniFontSize: 30 })).toBe(18);
  });
});
