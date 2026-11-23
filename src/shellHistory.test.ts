import { readFileSync } from "node:fs";
import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { invoke } from "@tauri-apps/api/core";
import { getShellHistory, mergeShellHistory, SessionCommandHistory, MAX_SESSION_HISTORY_ENTRIES, MAX_SESSION_HISTORY_BYTES, MAX_SHELL_HISTORY_ENTRIES } from "./shellHistory";

it("requests the expanded but bounded saved history", async () => {
  await getShellHistory();
  expect(invoke).toHaveBeenCalledWith("pty_shell_history", { home_dir: null, limit: 10_000 });
});
it("keeps latest unique commands and timestamps in memory without exposing mutable state", () => {
  const history = new SessionCommandHistory();
  history.record("pwd", 1000); history.record("git status", 2000); history.record("pwd", 3000);
  expect(history.snapshot()).toEqual([
    { command: "pwd", timestamp: 3, source: "This terminal session" },
    { command: "git status", timestamp: 2, source: "This terminal session" },
  ]);
  history.snapshot()[0].command = "changed";
  expect(history.snapshot()[0].command).toBe("pwd");
  history.clear(); expect(history.snapshot()).toEqual([]);
});
it("skips whitespace-excluded, internal, sensitive, control and oversized commands", () => {
  const history = new SessionCommandHistory();
  for (const cmd of ["", " echo private", "\techo private", "__husk_prompt", "export TOKEN=example-value", "curl --password example-value", "curl -u person:example-value https://example.test", "echo \u001b[31m", "echo " + "x".repeat(4096), "echo 'one\ntwo'"]) history.record(cmd);
  expect(history.snapshot()).toEqual([]);
  history.record("pwd", NaN); history.record("pwd", -1);
  expect(history.snapshot()).toEqual([]);
});
it("bounds retained entry count and UTF-8 bytes", () => {
  const history = new SessionCommandHistory();
  for (let i = 0; i < MAX_SESSION_HISTORY_ENTRIES + 10; i++) history.record(`echo ${i}`, i * 1000);
  expect(history.snapshot()).toHaveLength(MAX_SESSION_HISTORY_ENTRIES);
  expect(history.snapshot()[0].command).toBe(`echo ${MAX_SESSION_HISTORY_ENTRIES + 9}`);
  for (let i = 0; i < 150; i++) history.record(`echo ${i} ${"😀".repeat(800)}`);
  expect(history.snapshot().reduce((sum, row) => sum + new TextEncoder().encode(row.command).byteLength, 0)).toBeLessThanOrEqual(MAX_SESSION_HISTORY_BYTES);
});
it("merges live and stored history by known recency, retaining newest duplicates", () => {
  const live = [{ command: "pwd", timestamp: 300 }, { command: "git status", timestamp: 100 }];
  const disk = [{ command: "git status", timestamp: 400 }, { command: "ls", timestamp: 200 }, { command: "pwd", timestamp: 50 }];
  const merged = mergeShellHistory(live, disk);
  expect(merged.map((row) => row.command)).toEqual(["git status", "pwd", "ls"]);
  expect(merged[0].timestamp).toBe(400);
  expect(merged[1].timestamp).toBe(300);
  expect(live).toHaveLength(2); expect(disk).toHaveLength(3);
});
it("preserves unknown-date file order after live entries and caps combined results", () => {
  const disk = Array.from({ length: MAX_SHELL_HISTORY_ENTRIES + 50 }, (_, i) => ({ command: `echo ${i}`, timestamp: null }));
  const merged = mergeShellHistory([{ command: "pwd", timestamp: 100 }], disk);
  expect(merged).toHaveLength(MAX_SHELL_HISTORY_ENTRIES);
  expect(merged.slice(0, 3).map((row) => row.command)).toEqual(["pwd", "echo 0", "echo 1"]);
  expect(merged[1].timestamp).toBeNull();
});
it("records only verified local OSC commands before SSH transition and releases session data", () => {
  // Integration wiring contract; scope detection itself has dedicated tests.
  const registry = readFileSync(new URL("./terminal/registry.ts", import.meta.url), "utf8");
  const preexec = registry.slice(registry.indexOf('term.parser.registerOscHandler(778,'), registry.indexOf('term.parser.registerOscHandler(KUBECONFIG_OSC,'));
  expect(preexec).toContain("if (session.commandOutputScope.target(session.isRemoteShell) === null) session.recentHistory.record(rawCommand)");
  expect(preexec.indexOf("recentHistory.record(rawCommand)")).toBeLessThan(preexec.indexOf("commandOutputScope.enterRemote()"));
  expect(registry.slice(registry.indexOf("export async function restartSession"), registry.indexOf("export function getActiveTerminalKubeconfigSnapshot"))).toContain("session.recentHistory.clear()");
  expect(registry.slice(registry.indexOf("export function disposeSession"))).toContain("session.recentHistory.clear()");
});
