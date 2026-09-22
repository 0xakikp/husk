import { expect, it, vi } from "vitest";
vi.mock("./cliProcess", () => ({ runCliProcess: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
import { formatCodexError } from "./codexError";
import { runCliProcess } from "./cliProcess";
import { runCodexCli } from "./codexCli";

const unsupported = {
  type: "error", status: 400,
  error: { type: "invalid_request_error", message: "The 'gpt-5.4-mini' model is not supported when using Codex with a ChatGPT account." },
};

it.each([
  unsupported,
  JSON.stringify(unsupported),
  { type: "turn.failed", error: { message: JSON.stringify(unsupported) } },
  { type: "error", message: JSON.stringify(unsupported) },
  new Error(JSON.stringify(unsupported)),
  `Error: HTTP 400: ${JSON.stringify(unsupported)}`,
  { error: { code: "unsupported_model" } },
])("turns unsupported-model envelopes into actionable settings guidance: %j", (error) => {
  const message = formatCodexError(error);
  expect(message).toContain("not supported");
  expect(message).toContain("Codex default");
  expect(message).toContain("Settings → AI & Models");
  expect(message).not.toContain("gpt-5.4-mini");
  expect(message).not.toContain('{"');
});

it("unwraps nested JSON strings without breaking their escaped quotes", () => {
  const error = JSON.stringify({ error: { message: JSON.stringify({ error: { message: "Please sign in again." } }) } });
  expect(formatCodexError(error)).toBe("Codex: Please sign in again.");
});

it("preserves useful plain errors without ANSI, control, or bidi sequences", () => {
  expect(formatCodexError("\x1b[31mError: Could not start Codex.\x1b[0m\nTry again.\u202e")).toBe("Codex: Could not start Codex. Try again.");
  expect(formatCodexError(new Error("Codex attempted a blocked shell action."))).toBe("Codex attempted a blocked shell action.");
});

it.each([
  "Authentication failed. Bearer abcdefghijklmnopqrstuvwxyz",
  "Authorization: Basic YWRtaW46cGFzcw==",
  "request failed: password=short",
  "request failed: sk-abcdefghijklmnopqrstuvwxyz",
  "request failed: https://user:password@example.com/path",
  "request failed: password\\u003dshort",
  { error: { message: "Connection failed: token=secret-token-value" } },
])("does not expose credentials in the displayed error: %j", (error) => {
  expect(formatCodexError(error)).toBe("Codex could not complete this request. Check your Codex sign-in and selected model, then try again.");
});

it("removes URLs that may carry query credentials", () => {
  const message = formatCodexError("Connection failed at https://example.com?access=private-value");
  expect(message).toBe("Codex: Connection failed at [endpoint]");
  expect(message).not.toContain("private-value");
});

it("bounds displayed errors, traversal, oversized envelopes and circular native errors", () => {
  expect(formatCodexError("Failure ".repeat(1000)).length).toBeLessThanOrEqual(420);
  expect(formatCodexError(`{"message":"${"x".repeat(100_000)}"}`)).not.toContain('{"');
  const circular: { cause?: unknown } = {}; circular.cause = circular;
  expect(formatCodexError(circular)).toContain("could not complete");
  for (const error of [null, undefined, [], 42, '{"message":', { request: { authorization: "private" } }]) {
    expect(formatCodexError(error)).toContain("could not complete");
  }
});

it.each(["turn.failed", "error"])("formats %s CLI events containing nested JSON", async (type) => {
  let reject!: (error: Error) => void;
  const done = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
  vi.mocked(runCliProcess).mockReturnValueOnce({ done, stop: vi.fn() });
  const run = runCodexCli({ prompt: "Explain this text", onDelta: vi.fn() });
  const options = vi.mocked(runCliProcess).mock.calls[0][0];
  options.onLine(JSON.stringify(type === "turn.failed" ? { type, error: { message: JSON.stringify(unsupported) } } : { type, message: JSON.stringify(unsupported) }));
  expect(options.error()).toContain("Codex default");
  reject(new Error(options.error()));
  await expect(run.done).rejects.toThrow("Settings → AI & Models");
  expect(runCliProcess).toHaveBeenCalledTimes(1);
});

it("normalizes stderr/native startup failures at the Codex boundary without retrying", async () => {
  const stop = vi.fn();
  vi.mocked(runCliProcess).mockReturnValueOnce({ done: Promise.reject(new Error(JSON.stringify(unsupported))), stop });
  const run = runCodexCli({ prompt: "Explain", onDelta: vi.fn() });
  await expect(run.done).rejects.toThrow("Codex default");
  expect(run.stop).toBe(stop);
  expect(runCliProcess).toHaveBeenCalledTimes(1);
});

it("preserves the original AbortError instance and stop callback unchanged", async () => {
  const cancellation = new DOMException("Request stopped.", "AbortError");
  const stop = vi.fn();
  vi.mocked(runCliProcess).mockReturnValueOnce({ done: Promise.reject(cancellation), stop });
  const run = runCodexCli({ prompt: "Explain", onDelta: vi.fn() });
  await expect(run.done).rejects.toBe(cancellation);
  run.stop(); expect(stop).toHaveBeenCalledOnce();
});

it("preserves cancellation objects from another realm without relying on instanceof Error", async () => {
  const cancellation = Object.freeze({ name: "AbortError", message: "Request stopped." });
  vi.mocked(runCliProcess).mockReturnValueOnce({ done: Promise.reject(cancellation), stop: vi.fn() });
  await expect(runCodexCli({ prompt: "Explain", onDelta: vi.fn() }).done).rejects.toBe(cancellation);
});
