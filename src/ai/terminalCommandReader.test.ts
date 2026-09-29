import { afterEach, describe, expect, it } from "vitest";
import { readActiveTerminalCommand, setActiveTerminalCommandReader, setActiveTerminalPtyId, setCurrentCommand } from "./terminalContext";

afterEach(() => { setActiveTerminalCommandReader(null); setActiveTerminalPtyId(null); });

describe("active terminal command identity", () => {
  it("uses the selected session reader rather than another terminal's last preexec", () => {
    setCurrentCommand("ssh wrong-host");
    setActiveTerminalPtyId(42);
    let command = "ssh right-host";
    setActiveTerminalCommandReader(() => command);
    expect(readActiveTerminalCommand()).toBe("ssh right-host");
    command = "";
    expect(readActiveTerminalCommand()).toBe("");
    setActiveTerminalCommandReader(() => "ssh other-host");
    expect(readActiveTerminalCommand()).toBe("ssh other-host");
  });
  it("has no stale fallback if there is no reader or active PTY", () => {
    setCurrentCommand("ssh old-host");
    setActiveTerminalPtyId(42);
    expect(readActiveTerminalCommand()).toBe("");
    setActiveTerminalCommandReader(() => "ssh old-host");
    setActiveTerminalPtyId(null);
    expect(readActiveTerminalCommand()).toBe("");
  });
});
