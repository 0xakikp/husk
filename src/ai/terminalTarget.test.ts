import { beforeEach, expect, it, vi } from "vitest";
const current = vi.hoisted(() => ({ ptyId: 1 as number | null, cwd: "/project", isRemote: false, host: undefined as string | undefined }));
vi.mock("./terminalContext", () => ({
  getActiveTerminalCwd: () => current.cwd,
  getActiveTerminalPtyId: () => current.ptyId,
  getActiveRemoteTerminal: () => ({ isRemote: current.isRemote, host: current.host }),
}));
import { captureTerminalTarget, isCurrentTerminalTarget } from "./terminalTarget";
beforeEach(() => { Object.assign(current, { ptyId: 1, cwd: "/project", isRemote: false, host: undefined }); });
it("accepts the original target", () => { expect(isCurrentTerminalTarget(captureTerminalTarget())).toBe(true); });
it.each([{ ptyId: 2 }, { ptyId: null }, { cwd: "/other" }, { isRemote: true }, { host: "production" }])("invalidates approval after %j", (change) => {
  const target = captureTerminalTarget(); Object.assign(current, change);
  expect(isCurrentTerminalTarget(target)).toBe(false);
});
