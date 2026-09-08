import { describe, expect, it } from "vitest";
import { boundConversation, imageInputs, prepareSendContext, reviewSendContext } from "./requestContext";
import { byteLength, type AiContextItem } from "./contextItems";

const file: AiContextItem = { id: "file", kind: "editor-file", icon: "", label: "config.txt", source: "/repo/config.txt", preview: "old", bytes: 3, sensitive: false, sensitiveReasons: [], removable: true };
describe("reviewed request payload", () => {
  it("scans new file contents before review and preserves both consent choices", async () => {
    const prepared = await prepareSendContext("help", [file], async () => "api_key=abcdef123456789\n" + "x".repeat(9000));
    expect(reviewSendContext(prepared, 8).overBudget).toBe(true);
    expect(prepared.items[0].sensitive).toBe(true);
    prepared.choices = { fitToBudget: true, allowSensitive: true };
    expect(reviewSendContext(prepared, 8)).toMatchObject({ overBudget: false, sensitive: [], items: [] });
    expect(prepared.text).toBe("help");
  });
  it("counts UTF-8 and detects secrets beyond the old scan cutoff", async () => {
    expect(byteLength("é")).toBe(2);
    const prepared = await prepareSendContext("help", [file], async () => "x".repeat(65000) + "\npassword=1234567890");
    expect(prepared.items[0].sensitive).toBe(true);
  });
  it("produces image inputs instead of embedding base64 in text", () => {
    expect(imageInputs([{ ...file, isImage: true, preview: "data:image/png;base64,YWJj" }])).toEqual([{ dataUrl: "data:image/png;base64,YWJj", mediaType: "image/png" }]);
    expect(() => imageInputs([{ ...file, isImage: true, preview: "data:image/svg+xml;base64,YWJj" }])).toThrow("Unsupported image");
  });
  it("keeps complete recent turns and the latest request while bounding history", () => {
    const messages = [
      { role: "user" as const, content: "a".repeat(11000) },
      { role: "assistant" as const, content: "answer" },
      { role: "user" as const, content: "recent" },
      { role: "assistant" as const, content: "answer" },
      { role: "user" as const, content: "now" },
    ];
    const result = boundConversation("system", messages);
    expect(result.omitted).toBe(2);
    expect(result.messages).toEqual(messages.slice(2));
    expect(() => boundConversation("x".repeat(16000), messages)).toThrow("too large");
  });
});
