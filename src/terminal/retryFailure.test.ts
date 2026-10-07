import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { FailureTerminalScope } from "./failureStore";
import type { PromptReadiness } from "./promptDraft";
import { Terminal } from "@xterm/xterm";
import { TerminalPromptTracker } from "./promptTracker";
import { inspectPromptReadiness, readEditablePrompt } from "./promptDraft";

const fixtures = vi.hoisted(() => ({
  leafId: 10 as number | null,
  scope: { token: "session-1", ptyId: 11, cwd: "/project", isRemote: false, host: null } as FailureTerminalScope | null,
  target: { ptyId: 11, cwd: "/project", isRemote: false, host: null as string | null },
  ptyId: 11 as number | null,
  present: true,
  prompt: { ready: true } as PromptReadiness,
  readPrompt: null as (() => PromptReadiness) | null,
  focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("../ai/terminalTarget", () => ({ captureTerminalTarget: () => ({ ...fixtures.target }) }));
vi.mock("../ai/screenAssist", () => ({ parseScreenObject: JSON.parse }));
vi.mock("./registry", () => ({
  getActiveTerminalLeafId: () => fixtures.leafId,
  getSessionHandle: () => fixtures.present ? {
    getPtyId: () => fixtures.ptyId,
    getStagingScope: () => fixtures.scope ? { ...fixtures.scope } : null,
    getPromptReadiness: () => fixtures.readPrompt?.() ?? fixtures.prompt,
    focus: fixtures.focus,
  } : null,
}));
import { invoke } from "@tauri-apps/api/core";
import { clearFailure, getFailure, recordFailure } from "./failureStore";
import { retryFailure } from "./retryFailure";

function fail(command = "pnpm test", terminalScope = fixtures.scope) {
  recordFailure(10, { command, output: "test failed", exitCode: 1, cwd: "/project", terminalScope });
  return getFailure(10)!.record;
}

beforeEach(() => {
  Object.assign(fixtures, {
    leafId: 10, ptyId: 11, present: true, prompt: { ready: true }, readPrompt: null,
    scope: { token: "session-1", ptyId: 11, cwd: "/project", isRemote: false, host: null },
    target: { ptyId: 11, cwd: "/project", isRemote: false, host: null },
  });
  vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
});
afterEach(() => clearFailure(10));

it("submits exactly the failed command plus one Enter to its own PTY, only after an explicit call", async () => {
  const record = fail(" pnpm test");
  expect(invoke).not.toHaveBeenCalled();
  expect(await retryFailure(10, record)).toBe(true);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 11, data: " pnpm test\r" });
  expect(getFailure(10)).toBeNull();
  expect(fixtures.focus).toHaveBeenCalledOnce();
});

it.each([
  "The terminal already has visible input. Clear or submit it first.",
  "Husk cannot verify an empty shell prompt. Return to a fresh prompt.",
  "The terminal is busy or its shell prompt is not ready.",
])("preserves the failure and reports the exact readiness reason: %s", async (reason) => {
  const record = fail();
  fixtures.prompt = { ready: false, reason };
  await expect(retryFailure(10, record)).rejects.toThrow(reason);
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(record);
  expect(fixtures.focus).not.toHaveBeenCalled();
});

it.each([null, 20])("does not redirect a retry when active leaf is %s", async (leafId) => {
  const record = fail(); fixtures.leafId = leafId;
  await expect(retryFailure(10, record)).rejects.toThrow("Select the terminal");
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(record);
});

it.each([
  { cwd: "/another-project" },
  { token: "reconnected-with-same-pty" },
  { ptyId: 22 },
  { isRemote: true, host: "prod" },
])("rejects changed failure provenance %j", async (change) => {
  const record = fail();
  Object.assign(fixtures.scope!, change);
  Object.assign(fixtures.target, change);
  fixtures.ptyId = fixtures.scope!.ptyId;
  await expect(retryFailure(10, record)).rejects.toThrow("changed since this command failed");
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(record);
});

it("rejects an SSH disconnect even when the local shell reuses the PTY and cwd", async () => {
  Object.assign(fixtures.scope!, { isRemote: true, host: "prod" });
  Object.assign(fixtures.target, { isRemote: true, host: "prod" });
  const record = fail();
  Object.assign(fixtures.scope!, { isRemote: false, host: null });
  Object.assign(fixtures.target, { isRemote: false, host: null });
  await expect(retryFailure(10, record)).rejects.toThrow("SSH connection changed");
  expect(invoke).not.toHaveBeenCalled();
});

it("refuses an unverified failure-time scope even after current scope becomes known", async () => {
  const record = fail("pnpm test", null);
  await expect(retryFailure(10, record)).rejects.toThrow("scope could not be verified");
  expect(invoke).not.toHaveBeenCalled();
});

it.each(["scope", "handle", "global target"])("fails closed when current %s is unavailable or mismatched", async (missing) => {
  const record = fail();
  if (missing === "scope") fixtures.scope = null;
  else if (missing === "handle") fixtures.present = false;
  else fixtures.target.ptyId = 22;
  await expect(retryFailure(10, record)).rejects.toThrow("scope could not be verified");
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects unknown SSH host identity", async () => {
  fixtures.scope!.isRemote = true; fixtures.target.isRemote = true;
  const record = fail();
  await expect(retryFailure(10, record)).rejects.toThrow("SSH host is unknown");
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects a stale record even if the replacement has the same command and timestamp", async () => {
  const record = fail(); const replacement = fail(); replacement.at = record.at;
  await expect(retryFailure(10, record)).rejects.toThrow("no longer current");
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(replacement);
});

it.each(["echo one\necho two", "ls\r", "\x1b[200~ls", ""])("never submits unsafe command text %#", async (command) => {
  const record = fail(command);
  await expect(retryFailure(10, record)).rejects.toThrow("one line");
  expect(invoke).not.toHaveBeenCalled();
  expect(getFailure(10)?.record).toBe(record);
});

it("preserves a complete long command rather than truncating or rewriting the retry", async () => {
  const command = `build ${"package ".repeat(400)}`;
  await retryFailure(10, fail(command));
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 11, data: `${command}\r` });
});

it("retries an empty prompt after actual xterm reflow but still refuses a real draft at Home", async () => {
  const term = new Terminal({ cols: 60, rows: 5, scrollback: 100, allowProposedApi: true });
  const tracker = new TerminalPromptTracker(term);
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  term.parser.registerOscHandler(133, (data) => { if (data === "B") tracker.capture(); return true; });
  fixtures.readPrompt = () => inspectPromptReadiness(term.buffer.active, tracker.position());
  try {
    await write("x".repeat(59) + "\r\n❯ \x1b]133;B\x07");
    const stalePosition = tracker.position();
    const record = fail();
    tracker.resize(20, () => term.resize(20, 5));
    // This old row was the false draft that previously blocked Retry.
    expect(readEditablePrompt(term.buffer.active, stalePosition)).not.toBe("");
    await retryFailure(10, record);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 11, data: "pnpm test\r" });
    expect(getFailure(10)).toBeNull();

    const nextFailure = fail();
    await write("real draft\x1b[10D");
    const prompt = fixtures.readPrompt();
    expect(prompt.ready).toBe(false);
    await expect(retryFailure(10, nextFailure)).rejects.toThrow("already has input");
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(getFailure(10)?.record).toBe(nextFailure);
  } finally {
    tracker.clear(); term.dispose();
  }
});

it("awaits write acknowledgement, leaves the failure available on rejection, and releases the click lock", async () => {
  const record = fail();
  let rejectWrite!: (reason: Error) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectWrite = reject; }));
  const retry = retryFailure(10, record);
  expect(getFailure(10)?.record).toBe(record);
  const rejection = expect(retry).rejects.toThrow("PTY closed");
  rejectWrite(new Error("PTY closed")); await rejection;
  expect(getFailure(10)?.record).toBe(record);
  expect(fixtures.focus).not.toHaveBeenCalled();
  await retryFailure(10, record);
  expect(invoke).toHaveBeenCalledTimes(2);
});

it("coalesces duplicate clicks into one pending native write", async () => {
  const record = fail();
  let resolveWrite!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
  const retry = retryFailure(10, record);
  expect(await retryFailure(10, record)).toBe(false);
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(getFailure(10)?.record).toBe(record);
  resolveWrite(undefined); await retry;
  expect(getFailure(10)).toBeNull();
  await expect(retryFailure(10, record)).rejects.toThrow("no longer current");
  expect(invoke).toHaveBeenCalledTimes(1);
});

it("never clears a newer failure that arrives before write acknowledgement", async () => {
  const record = fail();
  let resolveWrite!: (value: unknown) => void;
  vi.mocked(invoke).mockImplementationOnce(() => new Promise((resolve) => { resolveWrite = resolve; }));
  const retry = retryFailure(10, record);
  const replacement = fail(); replacement.at = record.at;
  resolveWrite(undefined); await retry;
  expect(getFailure(10)?.record).toBe(replacement);
});

it.each(["leaf", "connection"])("does not steal focus if the %s changes while submission is acknowledged", async (changed) => {
  const record = fail();
  vi.mocked(invoke).mockImplementationOnce(async () => {
    if (changed === "leaf") fixtures.leafId = 20;
    else fixtures.scope!.token = "replacement-shell";
  });
  await retryFailure(10, record);
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 11, data: "pnpm test\r" });
  expect(fixtures.focus).not.toHaveBeenCalled();
});
