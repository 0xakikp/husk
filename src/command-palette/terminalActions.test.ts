import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  leafId: 10 as number | null,
  target: { ptyId: 7 as number | null, cwd: "/fixture/project", isRemote: false, host: null as string | null },
  token: "connection-1", ready: true, scopeKnown: true, focus: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("../ai/screenAssist", () => ({ parseScreenObject: JSON.parse }));
vi.mock("../ai/terminalTarget", () => ({
  captureTerminalTarget: () => ({ ...state.target }),
  isCurrentTerminalTarget: (target: typeof state.target) => target.ptyId !== null
    && Object.entries(state.target).every(([key, value]) => target[key as keyof typeof target] === value),
}));
vi.mock("../terminal/registry", () => ({
  getActiveTerminalLeafId: () => state.leafId,
  getSessionHandle: (leafId: number) => leafId === state.leafId ? {
    getPtyId: () => state.target.ptyId,
    getStagingScope: () => state.scopeKnown ? { ...state.target, token: state.token } : null,
    getPromptReadiness: () => state.ready ? { ready: true } : { ready: false, reason: "Terminal prompt is not verified empty." },
    focus: state.focus,
  } : null,
}));

import { invoke } from "@tauri-apps/api/core";
import { captureLauncherTerminalTarget, stageLauncherCommand } from "./terminalActions";

beforeEach(() => {
  state.leafId = 10;
  state.target = { ptyId: 7, cwd: "/fixture/project", isRemote: false, host: null };
  state.token = "connection-1"; state.ready = true; state.scopeKnown = true;
});

it("captures the displayed terminal destination without probing or writing to it", () => {
  const target = captureLauncherTerminalTarget("Build tab");
  expect(target?.label).toBe("Build tab · Local shell · /fixture/project");
  expect(target?.scope).not.toBe(state.target);
  expect(invoke).not.toHaveBeenCalled();
});

it("stages exactly one reviewed line on the captured PTY, without Enter", async () => {
  await stageLauncherCommand(captureLauncherTerminalTarget(), "git status --short");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 7, data: "git status --short" });
});

it("preserves intentional leading/trailing spaces in the reviewed command", async () => {
  await stageLauncherCommand(captureLauncherTerminalTarget(), " pwd ");
  expect(invoke).toHaveBeenCalledExactlyOnceWith("pty_write", { id: 7, data: " pwd " });
});

it.each(["pwd\n", "pwd\r", "pwd\nwhoami", "pwd\rwhoami", "\x1b[200~pwd", "pwd\0", "pwd\t", "pwd\u2028whoami"])(
  "refuses raw clipboard controls/multiline text without rewriting it: %j", async text => {
    await expect(stageLauncherCommand(captureLauncherTerminalTarget(), text)).rejects.toThrow("nothing was sent");
    expect(invoke).not.toHaveBeenCalled();
  },
);

it.each(["tab", "pty", "directory", "host", "reconnect", "prompt"])(
  "refuses staging if %s changed after review", async change => {
    const target = captureLauncherTerminalTarget();
    if (change === "tab") state.leafId = 11;
    if (change === "pty") state.target.ptyId = 8;
    if (change === "directory") state.target.cwd = "/fixture/other";
    if (change === "host") { state.target.isRemote = true; state.target.host = "production"; }
    if (change === "reconnect") state.token = "connection-2";
    if (change === "prompt") state.ready = false;
    await expect(stageLauncherCommand(target, "pwd")).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  },
);

it("does not use a newly available terminal when no target was verified on open", async () => {
  state.scopeKnown = false;
  const target = captureLauncherTerminalTarget();
  state.scopeKnown = true;
  await expect(stageLauncherCommand(target, "pwd")).rejects.toThrow("original terminal");
  expect(invoke).not.toHaveBeenCalled();
});

it("requires an identified remote host and displays the captured host", () => {
  state.target.isRemote = true;
  expect(captureLauncherTerminalTarget()).toBeNull();
  state.target.host = "production";
  expect(captureLauncherTerminalTarget("Remote tab")?.label).toBe("Remote tab · SSH production · /fixture/project");
});

it("propagates a native staging failure rather than claiming success", async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error("The terminal closed."));
  await expect(stageLauncherCommand(captureLauncherTerminalTarget(), "pwd")).rejects.toThrow("terminal closed");
  expect(state.focus).not.toHaveBeenCalled();
});
