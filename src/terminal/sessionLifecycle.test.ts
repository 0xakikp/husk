import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSessionConnection, type NativeTerminalStatus, type TerminalTransport } from "./sessionLifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const running: NativeTerminalStatus = { state: "running" };
function fixture() {
  const data = new Map<number, (bytes: number[]) => void>();
  const exits = new Map<number, (status: NativeTerminalStatus | null) => void>();
  const stops: ReturnType<typeof vi.fn>[] = [];
  const transport = {
    spawn: vi.fn<() => Promise<number>>().mockResolvedValue(1),
    listenData: vi.fn<TerminalTransport["listenData"]>(async (id: number, callback: (bytes: number[]) => void) => {
      data.set(id, callback); const stop = vi.fn(); stops.push(stop); return stop;
    }),
    listenExit: vi.fn<TerminalTransport["listenExit"]>(async (id: number, callback: (status: NativeTerminalStatus | null) => void) => {
      exits.set(id, callback); const stop = vi.fn(); stops.push(stop); return stop;
    }),
    attach: vi.fn<TerminalTransport["attach"]>().mockResolvedValue(running),
    status: vi.fn<TerminalTransport["status"]>().mockResolvedValue(running),
    write: vi.fn<TerminalTransport["write"]>().mockResolvedValue(undefined),
    kill: vi.fn<TerminalTransport["kill"]>().mockResolvedValue(undefined),
  };
  const output = vi.fn(); const changed = vi.fn();
  const connection = new TerminalSessionConnection(transport, output, changed);
  const ready = async () => { await connection.start(); data.get(connection.id!)!([36, 32]); };
  return { connection, transport, data, exits, stops, output, changed, ready };
}
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("terminal startup and generation identity", () => {
  it("subscribes before the attach handshake and receives buffered first-prompt bytes", async () => {
    const f = fixture();
    f.transport.attach.mockImplementation(async id => {
      expect(f.data.has(id) && f.exits.has(id)).toBe(true);
      f.data.get(id)!([36, 32]); return running;
    });
    await f.connection.start();
    expect(f.connection.status.state).toBe("ready");
    expect(f.output).toHaveBeenCalledExactlyOnceWith([36, 32]);
    f.connection.dispose();
  });

  it("does not drop xterm's startup query replies while attach is acknowledging", async () => {
    const f = fixture();
    f.transport.attach.mockImplementation(async id => {
      f.data.get(id)!([27, 91, 99]);
      f.connection.write("\u001b[?1;2c");
      expect(f.transport.write).toHaveBeenCalledExactlyOnceWith(1, "\u001b[?1;2c");
      return running;
    });
    await f.connection.start(); f.connection.dispose();
  });

  it("shows slow startup without spawning again or injecting a command", async () => {
    const f = fixture(); const spawn = deferred<number>();
    f.transport.spawn.mockReturnValue(spawn.promise);
    const pending = f.connection.start();
    await vi.advanceTimersByTimeAsync(10_001);
    expect(f.connection.status.state).toBe("slow-start");
    await f.connection.check();
    expect(f.transport.spawn).toHaveBeenCalledOnce();
    expect(f.transport.write).not.toHaveBeenCalled();
    expect(f.transport.kill).not.toHaveBeenCalled();
    spawn.resolve(7); await pending;
    f.data.get(7)!([36]);
    expect(f.connection.status.state).toBe("ready");
    f.connection.dispose();
  });

  it("reports a spawn error instead of silently leaving an unusable terminal", async () => {
    const f = fixture(); f.transport.spawn.mockRejectedValue(new Error("fixture launch failure"));
    await f.connection.start();
    expect(f.connection.status).toEqual({ state: "error", message: expect.stringContaining("fixture launch failure") });
    expect(f.transport.kill).not.toHaveBeenCalled();
    f.connection.dispose();
  });

  it("closes late startup only after the user has closed its tab", async () => {
    const f = fixture(); const spawn = deferred<number>(); f.transport.spawn.mockReturnValue(spawn.promise);
    const pending = f.connection.start(); f.connection.dispose(); spawn.resolve(19); await pending;
    expect(f.transport.kill).toHaveBeenCalledExactlyOnceWith(19);
    expect(f.transport.listenData).not.toHaveBeenCalled();
  });

  it("does not revive an exited shell when a concurrent status response arrives", async () => {
    const f = fixture(); await f.ready(); const status = deferred<NativeTerminalStatus>();
    f.transport.status.mockReturnValue(status.promise); const pending = f.connection.check();
    f.exits.get(1)!({ state: "exited", message: "Shell exited." });
    status.resolve(running); await pending;
    f.connection.write("not sent");
    expect(f.connection.status.state).toBe("exited");
    expect(f.transport.write).not.toHaveBeenCalled();
    expect(f.transport.spawn).toHaveBeenCalledOnce();
    f.connection.dispose();
  });

  it("removes a listener that resolves after attachment timed out", async () => {
    const f = fixture(); const subscription = deferred<() => void>(); const lateStop = vi.fn();
    f.transport.listenData.mockReturnValueOnce(subscription.promise);
    const pending = f.connection.start(); await vi.advanceTimersByTimeAsync(5_001); await pending;
    expect(f.connection.status.state).toBe("error");
    subscription.resolve(lateStop); await vi.advanceTimersByTimeAsync(0);
    expect(lateStop).toHaveBeenCalledOnce();
    await f.connection.check(); f.data.get(1)!([36]);
    expect(f.connection.status.state).toBe("ready");
    f.connection.dispose();
  });

  it("retains prompt listeners when attach acknowledgement arrives after a pause", async () => {
    const f = fixture(); const attach = deferred<NativeTerminalStatus>();
    f.transport.attach.mockReturnValueOnce(attach.promise);
    const start = f.connection.start(); await vi.advanceTimersByTimeAsync(5_001); await start;
    expect(f.connection.status.state).toBe("error");
    f.data.get(1)!([36, 32]);
    expect(f.output).toHaveBeenCalledExactlyOnceWith([36, 32]);
    await f.connection.check();
    expect(f.connection.status.state).toBe("ready");
    expect(f.transport.listenData).toHaveBeenCalledOnce();
    expect(f.transport.listenExit).toHaveBeenCalledOnce();
    expect(f.connection.id).toBe(1);
    attach.resolve(running); await vi.advanceTimersByTimeAsync(0);
    expect(f.output).toHaveBeenCalledOnce();
    f.connection.dispose();
  });

  it("a recovered quiet startup remains diagnosable after the startup timer elapsed", async () => {
    const f = fixture(); const attach = deferred<NativeTerminalStatus>();
    f.transport.attach.mockReturnValueOnce(attach.promise);
    const start = f.connection.start(); await vi.advanceTimersByTimeAsync(15_001); await start;
    await f.connection.check(); expect(f.connection.status.state).toBe("slow-start");
    attach.resolve(running); await vi.advanceTimersByTimeAsync(0);
    f.connection.dispose();
  });
});

describe("non-destructive health checks and explicit restart", () => {
  it("coalesces health checks and never writes, kills, or respawns a running job", async () => {
    const f = fixture(); await f.ready(); const status = deferred<NativeTerminalStatus>();
    f.transport.status.mockReturnValue(status.promise);
    const first = f.connection.check(); const second = f.connection.check();
    expect(first).toBe(second); status.resolve(running); await first;
    expect(f.transport.status).toHaveBeenCalledOnce();
    expect(f.transport.write).not.toHaveBeenCalled();
    expect(f.transport.kill).not.toHaveBeenCalled();
    expect(f.transport.spawn).toHaveBeenCalledOnce(); f.connection.dispose();
  });

  it("reports an unresponsive backend, then recovers the same shell", async () => {
    const f = fixture(); await f.ready(); f.transport.status.mockReturnValueOnce(new Promise(() => {}));
    const pending = f.connection.check(); await vi.advanceTimersByTimeAsync(5_001); await pending;
    expect(f.connection.status.state).toBe("unresponsive");
    await f.connection.check(); expect(f.connection.status.state).toBe("ready");
    expect(f.connection.id).toBe(1); expect(f.transport.kill).not.toHaveBeenCalled();
    f.connection.dispose();
  });

  it("ends the old shell only on explicit restart and ignores its late events", async () => {
    const f = fixture(); await f.ready(); const oldOutput = f.data.get(1)!; const oldExit = f.exits.get(1)!;
    const oldStatus = deferred<NativeTerminalStatus>(); f.transport.status.mockReturnValueOnce(oldStatus.promise);
    const check = f.connection.check(); f.transport.spawn.mockResolvedValueOnce(2);
    await f.connection.restart(); f.data.get(2)!([62]);
    oldOutput([99]); oldExit({ state: "exited" }); oldStatus.resolve({ state: "disconnected" }); await check;
    expect(f.connection.id).toBe(2); expect(f.connection.status.state).toBe("ready");
    expect(f.output.mock.calls).toEqual([[[36, 32]], [[62]]]);
    expect(f.transport.kill).toHaveBeenCalledExactlyOnceWith(1);
    f.connection.dispose();
  });

  it("does not start a replacement when ending the old shell failed", async () => {
    const f = fixture(); await f.ready(); f.transport.kill.mockRejectedValueOnce(new Error("fixture close failure"));
    await f.connection.restart();
    expect(f.connection.status.state).toBe("error"); expect(f.transport.spawn).toHaveBeenCalledOnce();
    expect(f.connection.id).toBe(1); f.connection.dispose();
  });
});

describe("input isolation, ordering and expiry", () => {
  it("serializes input, and a stuck tab cannot hold another tab's input", async () => {
    const f = fixture(); const other = fixture(); await f.ready(); await other.ready();
    const write = deferred<void>(); f.transport.write.mockReturnValueOnce(write.promise);
    f.connection.write("a"); f.connection.write("b"); other.connection.write("other");
    expect(f.transport.write.mock.calls).toEqual([[1, "a"]]);
    expect(other.transport.write).toHaveBeenCalledExactlyOnceWith(1, "other");
    write.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.transport.write.mock.calls).toEqual([[1, "a"], [1, "b"]]);
    f.connection.dispose(); other.connection.dispose();
  });

  it("drops queued input after a write failure and never replays it on wake", async () => {
    const f = fixture(); await f.ready(); const write = deferred<void>();
    f.transport.write.mockReturnValueOnce(write.promise);
    f.connection.write("partial"); f.connection.write("must-not-replay\r");
    write.reject(new Error("fixture backpressure")); await vi.advanceTimersByTimeAsync(0);
    expect(f.connection.status.state).toBe("unresponsive");
    await f.connection.check(); expect(f.connection.status.state).toBe("ready");
    expect(f.transport.write.mock.calls).toEqual([[1, "partial"]]); f.connection.dispose();
  });

  it("expires queued input across sleep even if monotonic timers did not advance", async () => {
    const f = fixture(); await f.ready(); const write = deferred<void>();
    f.transport.write.mockReturnValueOnce(write.promise);
    f.connection.write("first"); f.connection.write("stale\r");
    vi.setSystemTime(Date.now() + 86_400_000); write.resolve(); await vi.advanceTimersByTimeAsync(0);
    expect(f.transport.write.mock.calls).toEqual([[1, "first"]]);
    expect(f.connection.status.state).toBe("unresponsive");
    expect(f.connection.status.message).toContain("expired"); f.connection.dispose();
  });

  it("bounds input by UTF-8 bytes instead of accepting an unbounded paste", async () => {
    const f = fixture(); await f.ready(); f.connection.write("😀".repeat(100_000));
    expect(f.connection.status.state).toBe("unresponsive"); expect(f.transport.write).not.toHaveBeenCalled();
    f.connection.dispose();
  });
});
