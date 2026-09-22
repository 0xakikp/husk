import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const fixtures = vi.hoisted(() => ({
  draft: "", busy: false, matches: true, pty: 1, buffer: "normal", knownPrompt: true,
  token: "scope-1", scopeKnown: true, scopeRemote: false, scopeHost: null as string | null,
  target: { ptyId: 1, isRemote: false, host: null as string | null, cwd: "/project" },
  focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("../ai/terminalTarget", () => ({ isCurrentTerminalTarget: () => fixtures.matches, captureTerminalTarget: () => ({ ...fixtures.target }) }));
vi.mock("../ai/screenAssist", () => ({ parseScreenObject: JSON.parse }));
vi.mock("./registry", () => ({ getSessionHandle: () => ({
  getPtyId: () => fixtures.pty,
  getStagingScope: () => fixtures.scopeKnown ? { token: fixtures.token, ptyId: fixtures.pty, cwd: "/project", isRemote: fixtures.scopeRemote, host: fixtures.scopeHost } : null,
  getPromptReadiness: () => fixtures.knownPrompt && !fixtures.draft && !fixtures.busy && fixtures.buffer === "normal" ? { ready: true } : { ready: false, reason: "Prompt is not verified empty." },
  focus: fixtures.focus,
}) }));
import { invoke } from "@tauri-apps/api/core";
import { captureScreenCommandTarget, stageScreenCommand } from "./stageScreenCommand";
const target = { ptyId: 1, isRemote: false, host: null, cwd: "/project", scopeToken: "scope-1" };
beforeEach(() => { Object.assign(fixtures, { draft: "", busy: false, matches: true, pty: 1, buffer: "normal", knownPrompt: true, token: "scope-1", scopeKnown: true, scopeRemote: false, scopeHost: null, target: { ptyId: 1, isRemote: false, host: null, cwd: "/project" } }); });
it("writes exactly one line without Enter to the originally reviewed PTY", async () => {
  await stageScreenCommand(10, target, "ls -lh");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 1, data: "ls -lh" });
});
it.each([{ draft: "my input" }, { busy: true }, { matches: false }, { pty: 2 }, { buffer: "alternate" }, { knownPrompt: false }])("refuses unsafe staging state %j", async (change) => {
  Object.assign(fixtures, change);
  await expect(stageScreenCommand(10, target, "ls -lh")).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled();
});
it("refuses multiline history entries and model output", async () => {
  await expect(stageScreenCommand(10, target, "ls\nrm file")).rejects.toThrow(); expect(invoke).not.toHaveBeenCalled();
});

it("captures a plain immutable target with a per-connection scope token", () => {
  const captured = captureScreenCommandTarget(10);
  expect(captured).toEqual(target);
  expect(JSON.parse(JSON.stringify(captured))).toEqual(target);
});

it("rejects a reconnect even when the same PTY, host and directory are reused", async () => {
  const captured = captureScreenCommandTarget(10)!;
  fixtures.token = "scope-2";
  await expect(stageScreenCommand(10, captured, "ls")).rejects.toThrow("connection changed");
  expect(invoke).not.toHaveBeenCalled();
});

it("does not treat canonical SSH scope as local when global remote flags reset", async () => {
  fixtures.scopeRemote = true; fixtures.scopeHost = "prod";
  expect(captureScreenCommandTarget(10)).toBeNull();
  await expect(stageScreenCommand(10, target, "ls")).rejects.toThrow("scope could not be verified");
  expect(invoke).not.toHaveBeenCalled();
});

it("refuses scope that was unknown at review time, even if it becomes known later", async () => {
  fixtures.scopeKnown = false;
  const captured = captureScreenCommandTarget(10);
  fixtures.scopeKnown = true;
  await expect(stageScreenCommand(10, captured, "ls")).rejects.toThrow("scope could not be verified");
  expect(invoke).not.toHaveBeenCalled();
});

it("rejects a remote preview after disconnect to a local shell with the same PTY/cwd", async () => {
  fixtures.scopeRemote = true; fixtures.scopeHost = "prod";
  fixtures.target = { ...fixtures.target, isRemote: true, host: "prod" };
  const captured = captureScreenCommandTarget(10)!;
  fixtures.scopeRemote = false; fixtures.scopeHost = null; fixtures.token = "scope-after-disconnect";
  fixtures.target = { ...fixtures.target, isRemote: false, host: null };
  await expect(stageScreenCommand(10, captured, "ls")).rejects.toThrow("connection changed");
  expect(invoke).not.toHaveBeenCalled();
});

it("does not steal focus back if the terminal changes while the PTY acknowledges staging", async () => {
  vi.mocked(invoke).mockImplementationOnce(async () => { fixtures.matches = false; return undefined; });
  await stageScreenCommand(10, target, "ls");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 1, data: "ls" });
  expect(fixtures.focus).not.toHaveBeenCalled();
});

it("keeps the local-history shortcut and opener free of implicit PTY writes and clears", () => {
  // Guard these narrow integration seams: Ctrl+C/Ctrl+G and xterm.clear used
  // to mutate the shell/buffer before the user had selected any history row.
  const registry = readFileSync(new URL("./registry.ts", import.meta.url), "utf8");
  const historyBranch = registry.slice(registry.indexOf('if (e.type === "keydown" && e.ctrlKey && !e.metaKey && e.key.toLowerCase() === "r")'), registry.indexOf('if (e.type === "keydown" && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c"'));
  expect(historyBranch).toContain("session.comparisonScope.target(session.isRemoteShell) !== null");
  expect(historyBranch).not.toMatch(/invoke\(|\.clear\(/);
  const terminal = readFileSync(new URL("../Terminal.tsx", import.meta.url), "utf8");
  const opener = terminal.slice(terminal.indexOf("const openHistory = () =>"), terminal.indexOf("const menuCopy = () =>"));
  expect(opener).toContain("captureScreenCommandTarget(leafId)");
  expect(opener).not.toMatch(/invoke\(|\.clear\(|\.write\(/);
});
