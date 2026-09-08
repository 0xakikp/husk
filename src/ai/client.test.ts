import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatConfig, ToolActivity } from "./client";

const fixtures = vi.hoisted(() => ({
  events: [] as Record<string, unknown>[],
  beforeEvent: undefined as (() => void) | undefined,
}));
vi.mock("ai", () => ({
  streamText: vi.fn(() => ({ fullStream: (async function* () {
    for (const event of fixtures.events) { fixtures.beforeEvent?.(); yield event; }
  })() })),
  stepCountIs: vi.fn((count: number) => ({ count })),
}));
vi.mock("@ai-sdk/anthropic", () => ({ createAnthropic: vi.fn(() => (id: string) => ({ id })) }));
vi.mock("@ai-sdk/openai", () => ({ createOpenAI: vi.fn(() => (id: string) => ({ id })) }));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn(() => (id: string) => ({ id })) }));
vi.mock("@ai-sdk/openai-compatible", () => ({ createOpenAICompatible: vi.fn(() => (id: string) => ({ id })) }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("./claudeCli", () => ({ runClaudeCli: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })) }));
vi.mock("./codexCli", () => ({ runCodexCli: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })) }));
vi.mock("./geminiCli", () => ({ runGeminiCli: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })) }));
vi.mock("./kimiCli", () => ({ runKimiCli: vi.fn(() => ({ done: Promise.resolve(), stop: vi.fn() })) }));

import { streamText } from "ai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { streamChat } from "./client";
import { PROVIDERS } from "./providers";
import { runClaudeCli } from "./claudeCli";
import { runCodexCli } from "./codexCli";
import { runGeminiCli } from "./geminiCli";
import { runKimiCli } from "./kimiCli";

function config(id = "openai"): ChatConfig {
  const provider = PROVIDERS.find((item) => item.id === id)!;
  return { provider, model: provider.defaultModel, apiKey: "fixture-key", baseURL: provider.baseURL || "" };
}
beforeEach(() => { fixtures.events = []; fixtures.beforeEvent = undefined; });

describe("AI request images and endpoints", () => {
  it("passes screenshot attachments to the API as real image parts", async () => {
    const image = { dataUrl: "data:image/png;base64,Zml4dHVyZQ==", mediaType: "image/png" };
    await streamChat(config(), "system", [{ role: "user", content: "Describe this screenshot", images: [image] }], vi.fn());
    const request = vi.mocked(streamText).mock.calls[0][0];
    expect(request.messages).toEqual([{ role: "user", content: [
      { type: "text", text: "Describe this screenshot" },
      { type: "image", image: image.dataUrl, mediaType: "image/png" },
    ] }]);
  });

  it.each(["claude-code", "codex", "gemini-cli", "kimi-code"])("refuses images before starting the %s subscription process", async (id) => {
    await expect(streamChat(config(id), "system", [{ role: "user", content: "look", images: [{ dataUrl: "data:image/png;base64,Zml4dHVyZQ==" }] }], vi.fn())).rejects.toThrow("Image attachments require an API provider");
    expect(runClaudeCli).not.toHaveBeenCalled();
    expect(runCodexCli).not.toHaveBeenCalled();
    expect(runGeminiCli).not.toHaveBeenCalled();
    expect(runKimiCli).not.toHaveBeenCalled();
  });

  it("ignores a previous provider's shared URL for named API providers", async () => {
    const cfg = { ...config("deepseek"), baseURL: "https://previous-provider.invalid/v1" };
    await streamChat(cfg, "system", [{ role: "user", content: "private prompt" }], vi.fn());
    expect(createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({ baseURL: cfg.provider.baseURL, apiKey: "fixture-key" }));
  });

  it("honors an explicitly configured Local endpoint", async () => {
    const cfg = { ...config("local"), baseURL: "http://localhost:4321/v1" };
    await streamChat(cfg, "system", [{ role: "user", content: "prompt" }], vi.fn());
    expect(createOpenAICompatible).toHaveBeenCalledWith(expect.objectContaining({ baseURL: "http://localhost:4321/v1" }));
  });
});

describe("request cancellation", () => {
  it.each(["openai", "codex"])("does not start an already cancelled %s request", async (id) => {
    const controller = new AbortController();
    controller.abort();
    await expect(streamChat(config(id), "", [{ role: "user", content: "hello" }], vi.fn(), undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(streamText).not.toHaveBeenCalled();
    expect(runCodexCli).not.toHaveBeenCalled();
  });

  it("reports a cancelled subscription as aborted even if its process promise later resolves", async () => {
    let finish!: () => void;
    const stop = vi.fn();
    vi.mocked(runCodexCli).mockReturnValueOnce({ done: new Promise<void>((resolve) => { finish = resolve; }), stop });
    const controller = new AbortController();
    const request = streamChat(config("codex"), "", [{ role: "user", content: "hello" }], vi.fn(), undefined, controller.signal);
    const rejection = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    finish();
    await rejection;
    expect(stop).toHaveBeenCalledOnce();
  });

  it("does not deliver stream text after cancellation", async () => {
    const controller = new AbortController();
    fixtures.events = [{ type: "text-delta", text: "late content" }];
    fixtures.beforeEvent = () => controller.abort();
    const delta = vi.fn();
    await expect(streamChat(config(), "", [{ role: "user", content: "hello" }], delta, undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(delta).not.toHaveBeenCalled();
  });
});

describe("accurate tool traces", () => {
  it("preserves error, refused, and queued broker results in the reply trace", async () => {
    fixtures.events = [
      { type: "tool-call", toolName: "create_file" },
      { type: "tool-result", toolName: "create_file", output: { state: "queued", summary: "Review required" } },
      { type: "tool-result", toolName: "blocked_edit", output: { state: "refused" } },
      { type: "tool-result", toolName: "mcp_call", output: { state: "error" } },
      { type: "tool-result", toolName: "read_file", output: { state: "complete" } },
      { type: "tool-error", toolName: "failed_tool", error: new Error("tool crashed") },
    ];
    const statuses = vi.fn();
    const trace: ToolActivity[] = [];
    await streamChat(config(), "", [{ role: "user", content: "work" }], vi.fn(), undefined, undefined, statuses, (item) => trace.push(item));
    expect(trace).toEqual([
      { name: "create_file", state: "running" },
      { name: "create_file", state: "queued" },
      { name: "blocked_edit", state: "refused" },
      { name: "mcp_call", state: "error" },
      { name: "read_file", state: "complete" },
      { name: "failed_tool", state: "error" },
    ]);
    expect(statuses).toHaveBeenCalledWith("Review create_file");
    expect(statuses).toHaveBeenCalledWith("Failed mcp_call");
  });

  it("propagates provider error events so the caller cannot display a successful reply", async () => {
    fixtures.events = [{ type: "error", error: new Error("Provider rejected the request") }];
    await expect(streamChat(config(), "", [{ role: "user", content: "hello" }], vi.fn())).rejects.toThrow("Provider rejected the request");
  });
});
