import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../terminal/registry", () => ({ getActiveTerminalLeafId: vi.fn() }));
vi.mock("../terminal/stageScreenCommand", () => ({ captureScreenCommandTarget: vi.fn(), stageScreenCommand: vi.fn() }));
vi.mock("../toast", () => ({ toast: vi.fn() }));
import { getActiveTerminalLeafId } from "../terminal/registry";
import { captureScreenCommandTarget, stageScreenCommand } from "../terminal/stageScreenCommand";
import { stageLocalToolCommand } from "./stageLocalToolCommand";
const target = { ptyId: 1, cwd: "/project", isRemote: false, host: null, scopeToken: "1:1" };
beforeEach(() => { vi.mocked(getActiveTerminalLeafId).mockReturnValue(1); vi.mocked(captureScreenCommandTarget).mockReturnValue(target); });
it("stages without Enter using the shared verified-prompt writer", async () => {
  await stageLocalToolCommand("docker logs test");
  expect(stageScreenCommand).toHaveBeenCalledWith(1, target, "docker logs test");
});
it.each([null, { ...target, isRemote: true, host: "server" }])("rejects missing or remote targets", async (value) => {
  vi.mocked(captureScreenCommandTarget).mockReturnValue(value);
  await expect(stageLocalToolCommand("docker logs test")).rejects.toThrow("local terminal");
  expect(stageScreenCommand).not.toHaveBeenCalled();
});
it("rejects concurrent clicks rather than appending a second command", async () => {
  let resolve!: () => void;
  vi.mocked(stageScreenCommand).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const first = stageLocalToolCommand("docker logs first");
  await expect(stageLocalToolCommand("docker logs second")).rejects.toThrow("already being staged");
  resolve(); await first;
  expect(stageScreenCommand).toHaveBeenCalledTimes(1);
});
