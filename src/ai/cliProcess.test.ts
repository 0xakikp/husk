import { beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (event: { payload: unknown }) => void>(), invoke: vi.fn(), listen: vi.fn(), remove: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: ipc.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: ipc.listen }));
import { runCliProcess } from "./cliProcess";

const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const create = () => runCliProcess({ id: "test", prefix: "test-cli", command: "test_cli", args: [], onLine: vi.fn(), error: () => "" });
beforeEach(() => {
  ipc.handlers.clear(); ipc.invoke.mockReset().mockResolvedValue(undefined); ipc.remove.mockReset();
  ipc.listen.mockReset().mockImplementation(async (name, callback) => { ipc.handlers.set(name, callback); return ipc.remove; });
});

describe("CLI lifecycle", () => {
  it("does not start after cancellation during listener registration", async () => {
    const run = create(); const result = run.done.catch((error) => error);
    run.stop(); await tick();
    expect((await result).name).toBe("AbortError");
    expect(ipc.invoke).not.toHaveBeenCalled();
    expect(ipc.remove).toHaveBeenCalled();
  });
  it("cancellation after partial output is never successful completion", async () => {
    const run = create(); const result = run.done.catch((error) => error); await tick();
    ipc.handlers.get("test-cli://line/test")!({ payload: "partial response" });
    run.stop();
    ipc.handlers.get("test-cli://exit/test")!({ payload: 0 });
    expect((await result).name).toBe("AbortError");
    expect(ipc.invoke).toHaveBeenCalledWith("test_cli_stop", { id: "test" });
  });
  it("stops again when cancellation races an in-flight start", async () => {
    let started!: () => void;
    ipc.invoke.mockImplementation((command) => command.endsWith("_start") ? new Promise<void>((resolve) => { started = resolve; }) : Promise.resolve());
    const run = create(); const result = run.done.catch((error) => error); await tick();
    run.stop(); started(); await tick();
    expect((await result).name).toBe("AbortError");
    expect(ipc.invoke.mock.calls.filter(([name]) => name.endsWith("_stop"))).toHaveLength(2);
  });
  it("rejects a failed process even when it previously emitted text", async () => {
    const run = create(); const result = run.done.catch((error) => error); await tick();
    ipc.handlers.get("test-cli://line/test")!({ payload: "partial" });
    ipc.handlers.get("test-cli://err/test")!({ payload: "authentication failed" });
    ipc.handlers.get("test-cli://exit/test")!({ payload: 1 });
    expect((await result).message).toBe("authentication failed");
  });
});
