import { expect, it, vi } from "vitest";
vi.mock("./store", () => ({
  loadConfig: () => ({ providerId: "codex", model: "gpt-5.4-mini", baseURL: "" }),
  getKey: () => "",
}));
vi.mock("../settings/preferences", () => ({ getPrefs: () => ({ aiEnabled: true }), subscribePrefs: () => () => {} }));
vi.mock("./cliProcess", () => ({
  abortError: () => new DOMException("Stopped", "AbortError"),
  runCliProcess: vi.fn((options: { onLine: (text: string) => void }) => ({
    done: Promise.resolve().then(() => options.onLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: '{"explanation":"This is a directory name.","sourceLineIds":[1]}' } }))),
    stop: vi.fn(),
  })),
}));
import { requestScreenAssist } from "./screenAssist";
import { parsePeekResult } from "./screenSelection";
import { runCliProcess } from "./cliProcess";

it("runs AI Peek through a supported subscription model even with a stale saved configuration", async () => {
  const raw = await requestScreenAssist({ system: "Explain the selection with source-line IDs.", prompt: JSON.stringify({ lines: [{ id: 1, text: "icons" }] }) });
  expect(parsePeekResult(raw, [1])).toEqual({ explanation: "This is a directory name.", sourceLineIds: [1] });
  expect(runCliProcess).toHaveBeenCalledOnce();
  const launch = vi.mocked(runCliProcess).mock.calls[0][0];
  expect(launch.command).toBe("codex_cli");
  expect(launch.args[launch.args.indexOf("--model") + 1]).toBe("gpt-5.6-luna");
  expect(launch.args).not.toContain("gpt-5.4-mini");
  expect(launch.args).toContain("--ignore-user-config");
  expect(launch.cwd).toBeNull();
});
