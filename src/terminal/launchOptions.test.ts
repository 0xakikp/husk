import { describe, expect, it, vi } from "vitest";
import { buildPtySpawnArgs, resolveTerminalLaunchCwd } from "./launchOptions";

describe("terminal launch directory boundary", () => {
  it("ignores cyclic objects without coercing or serializing them", () => {
    const invalid = { self: null as unknown, toString: vi.fn(), toJSON: vi.fn() };
    invalid.self = invalid;
    expect(resolveTerminalLaunchCwd(invalid, "/work/project", "/home/user")).toBe("/work/project");
    expect(invalid.toString).not.toHaveBeenCalled();
    expect(invalid.toJSON).not.toHaveBeenCalled();
  });

  it.each([undefined, null, "", 17, true, [], {}, "/work/\0invalid"])(
    "ignores an invalid directory candidate: %j", value => {
      expect(resolveTerminalLaunchCwd(value, "/home/user")).toBe("/home/user");
      expect(resolveTerminalLaunchCwd(value)).toBeUndefined();
    },
  );

  it.each(["/work/my project", "/work/项目", "C:\\Users\\Dev User\\repo", " /directory with spaces "])(
    "preserves legitimate paths exactly: %s", path => {
      expect(resolveTerminalLaunchCwd(path, "/fallback")).toBe(path);
    },
  );
});

describe("PTY launch and restart payloads", () => {
  const source = { cols: 100, rows: 30, cwd: "/work/current", initialCwd: "/work/initial", isRemoteShell: false };

  it("prefers the current local directory for an explicit restart", () => {
    expect(buildPtySpawnArgs(source)).toEqual({ cols: 100, rows: 30, cwd: "/work/current" });
  });

  it("uses the local seed, never the remote prompt directory, for a remote session restart", () => {
    expect(buildPtySpawnArgs({ ...source, isRemoteShell: true })).toEqual({ cols: 100, rows: 30, cwd: "/work/initial" });
  });

  it("keeps an old invalid seed out of startup IPC, including after restart", () => {
    const invalid = { target: null as unknown }; invalid.target = invalid;
    const args = buildPtySpawnArgs({ ...source, cwd: "", initialCwd: invalid });
    expect(args).toEqual({ cols: 100, rows: 30, cwd: null });
    expect(JSON.parse(JSON.stringify(args))).toEqual(args);
    expect(buildPtySpawnArgs({ ...source, cwd: invalid })).toEqual({ cols: 100, rows: 30, cwd: "/work/initial" });
  });

  it("retains native default-directory and initial-size behavior", () => {
    expect(buildPtySpawnArgs({ cols: 0, rows: 0, cwd: "", initialCwd: undefined, isRemoteShell: false }))
      .toEqual({ cols: 80, rows: 24, cwd: null });
  });
});
