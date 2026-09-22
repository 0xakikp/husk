import { afterEach, beforeEach, expect, it, vi } from "vitest";
const fixtures = vi.hoisted(() => ({ enabled: true, key: "test-key", providerId: "openai", listeners: new Set<() => void>() }));
vi.mock("./client", () => ({ generateOnce: vi.fn() }));
vi.mock("../settings/preferences", () => ({
  getPrefs: () => ({ aiEnabled: fixtures.enabled }),
  subscribePrefs: (listener: () => void) => { fixtures.listeners.add(listener); return () => fixtures.listeners.delete(listener); },
}));
vi.mock("./store", () => ({
  getKey: () => fixtures.key,
  loadConfig: () => ({ providerId: fixtures.providerId, model: "model", baseURL: "https://provider.example/v1" }),
}));
import { generateOnce } from "./client";
import { requestScreenAssist, parseScreenObject, SCREEN_ASSIST_MAX_BYTES } from "./screenAssist";

beforeEach(() => { fixtures.enabled = true; fixtures.key = "test-key"; fixtures.providerId = "openai"; vi.mocked(generateOnce).mockResolvedValue("answer"); });
afterEach(() => { expect(fixtures.listeners.size).toBe(0); vi.useRealTimers(); });

it("uses only the explicit prompt and selected configuration, with no workspace or tools", async () => {
  const signal = new AbortController().signal;
  await expect(requestScreenAssist({ system: "Explain", prompt: "visible evidence", signal })).resolves.toBe("answer");
  expect(generateOnce).toHaveBeenCalledWith(expect.objectContaining({ model: "model", baseURL: "https://provider.example/v1", apiKey: "test-key" }), expect.stringContaining("Explain"), "visible evidence", expect.any(AbortSignal));
  expect(vi.mocked(generateOnce).mock.calls[0][0].workspacePath).toBeUndefined();
  expect(vi.mocked(generateOnce).mock.calls[0][1]).toContain("untrusted data");
});

it.each(["disabled", "key", "secret", "budget", "cancelled"])("refuses %s before launching a request", async (reason) => {
  const controller = new AbortController();
  let prompt = "evidence";
  if (reason === "disabled") fixtures.enabled = false;
  if (reason === "key") fixtures.key = "";
  if (reason === "secret") prompt = "password=do-not-transmit";
  if (reason === "budget") prompt = "😀".repeat(10_000);
  if (reason === "cancelled") controller.abort();
  await expect(requestScreenAssist({ system: "Explain", prompt, signal: controller.signal })).rejects.toThrow();
  expect(generateOnce).not.toHaveBeenCalled();
});

it("allows a keyless provider without inventing credentials", async () => {
  fixtures.providerId = "local"; fixtures.key = "";
  await expect(requestScreenAssist({ system: "Explain", prompt: "evidence" })).resolves.toBe("answer");
  expect(generateOnce).toHaveBeenCalled();
});

it("includes the safety instructions in its total byte budget", async () => {
  await expect(requestScreenAssist({ system: "Explain", prompt: "x".repeat(SCREEN_ASSIST_MAX_BYTES - 7) })).rejects.toThrow("too large");
  expect(generateOnce).not.toHaveBeenCalled();
});

it("rejects whitespace-only credentials before contacting a keyed provider", async () => {
  fixtures.key = "   ";
  await expect(requestScreenAssist({ system: "Explain", prompt: "evidence" })).rejects.toThrow("key in Settings");
  expect(generateOnce).not.toHaveBeenCalled();
});

it("does not return late text after cancellation or global AI disable", async () => {
  const controller = new AbortController();
  vi.mocked(generateOnce).mockImplementation(async () => { controller.abort(); return "late"; });
  await expect(requestScreenAssist({ system: "Explain", prompt: "evidence", signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  vi.mocked(generateOnce).mockImplementation(async () => { fixtures.enabled = false; for (const listener of fixtures.listeners) listener(); return "late"; });
  await expect(requestScreenAssist({ system: "Explain", prompt: "evidence" })).rejects.toMatchObject({ name: "AbortError" });
});

it("times out the request and cleans up its listeners", async () => {
  vi.useFakeTimers();
  vi.mocked(generateOnce).mockImplementation((_config, _system, _prompt, signal) => new Promise((_resolve, reject) => {
    signal!.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
  }));
  const request = requestScreenAssist({ system: "Explain", prompt: "evidence" });
  const result = expect(request).rejects.toThrow("timed out");
  await vi.advanceTimersByTimeAsync(90_000);
  await result;
});

it("rejects empty answers and parses only JSON objects", async () => {
  vi.mocked(generateOnce).mockResolvedValue(" ");
  await expect(requestScreenAssist({ system: "Explain", prompt: "evidence" })).rejects.toThrow("no answer");
  expect(parseScreenObject('```json\n{"text":"value"}\n```')).toEqual({ text: "value" });
  for (const invalid of ["[]", "null", "plain text"]) expect(() => parseScreenObject(invalid)).toThrow();
});
