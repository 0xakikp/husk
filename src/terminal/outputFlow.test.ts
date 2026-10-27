import { describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { TerminalOutputFlow, type NativeTerminalOutput } from "./outputFlow";

const tick = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
function fixture() {
  const parsed: (() => void)[] = [];
  const render = vi.fn((_bytes: number[], complete: () => void) => { parsed.push(complete); });
  const acknowledge = vi.fn<(sequence: number) => Promise<unknown>>().mockResolvedValue(undefined);
  const error = vi.fn();
  const flow = new TerminalOutputFlow(render, acknowledge, error);
  return { flow, render, acknowledge, error, parsed };
}

describe("terminal parser credit flow", () => {
  it.each([null, undefined, [1, 2], { sequence: 1, bytes: null }])("pauses malformed wire data without throwing", packet => {
    const f = fixture();
    expect(() => f.flow.accept(packet as unknown as NativeTerminalOutput)).not.toThrow();
    expect(f.error).toHaveBeenCalledOnce();
    expect(f.flow.failed).toBe(true);
    expect(f.render).not.toHaveBeenCalled();
    expect(f.acknowledge).not.toHaveBeenCalled();
  });
  it("waits for the real xterm parser, including asynchronous OSC handlers in a hidden terminal", async () => {
    const term = new Terminal({ cols: 80, rows: 24 });
    let resume!: (value: boolean) => void; let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const suspended = new Promise<boolean>(resolve => { resume = resolve; });
    term.parser.registerOscHandler(999, () => { entered(); return suspended; });
    const acknowledge = vi.fn<(sequence: number) => Promise<unknown>>().mockResolvedValue(undefined);
    const error = vi.fn();
    const flow = new TerminalOutputFlow((bytes, parsed) => term.write(new Uint8Array(bytes), parsed), acknowledge, error);
    try {
      flow.accept({ sequence: 1, bytes: [...new TextEncoder().encode("before\x1b]999;fixture\x07")] });
      flow.accept({ sequence: 2, bytes: [...new TextEncoder().encode("after\r\nfinal 🐈")] });
      await started; await tick(); expect(acknowledge).not.toHaveBeenCalled();
      resume(true);
      await new Promise<void>(resolve => term.write("", resolve)); await flow.flush();
      expect(acknowledge.mock.calls[acknowledge.mock.calls.length - 1]).toEqual([2]);
      expect(term.buffer.active.getLine(0)?.translateToString(true)).toBe("beforeafter");
      expect(term.buffer.active.getLine(1)?.translateToString(true)).toBe("final 🐈");
      expect(error).not.toHaveBeenCalled();
    } finally { flow.dispose(); term.dispose(); }
  });

  it("does not acknowledge output merely received or queued in xterm", async () => {
    const f = fixture(); f.flow.accept({ sequence: 1, bytes: [36, 32] }); await tick();
    expect(f.acknowledge).not.toHaveBeenCalled();
    f.parsed[0](); await tick();
    expect(f.acknowledge).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("coalesces parser callbacks and never acknowledges a gap", async () => {
    const f = fixture();
    for (let sequence = 1; sequence <= 4; sequence++) f.flow.accept({ sequence, bytes: [sequence] });
    f.parsed[3](); f.parsed[1](); await tick();
    expect(f.acknowledge).not.toHaveBeenCalled();
    f.parsed[0](); await tick();
    expect(f.acknowledge.mock.calls).toEqual([[2]]);
    f.parsed[2](); f.parsed[2](); await tick();
    expect(f.acknowledge.mock.calls).toEqual([[2], [4]]);
  });

  it("serializes ACK requests while parsing continues", async () => {
    const f = fixture(); let resolve!: () => void;
    f.acknowledge.mockReturnValueOnce(new Promise<void>(yes => { resolve = yes; }));
    f.flow.accept({ sequence: 1, bytes: [1] }); f.parsed[0](); await tick();
    for (let sequence = 2; sequence <= 4; sequence++) f.flow.accept({ sequence, bytes: [sequence] });
    f.parsed[1](); f.parsed[2](); f.parsed[3](); await tick();
    expect(f.acknowledge.mock.calls).toEqual([[1]]);
    resolve(); await tick(); expect(f.acknowledge.mock.calls).toEqual([[1], [4]]);
  });

  it("ignores duplicate deliveries without rendering or granting credits twice", async () => {
    const f = fixture(); const packet = { sequence: 1, bytes: [1] };
    f.flow.accept(packet); f.flow.accept(packet); f.parsed[0](); await tick(); f.flow.accept(packet);
    expect(f.render).toHaveBeenCalledOnce(); expect(f.acknowledge).toHaveBeenCalledOnce();
  });

  it("retains failed ACKs for a health-check retry without replaying output", async () => {
    const f = fixture(); f.acknowledge.mockRejectedValueOnce(new Error("paused webview"));
    f.flow.accept({ sequence: 1, bytes: [1] }); f.parsed[0](); await tick();
    expect(f.flow.failed).toBe(true);
    f.flow.accept({ sequence: 2, bytes: [2] }); f.parsed[1](); await tick();
    expect(f.acknowledge).toHaveBeenCalledOnce();
    await f.flow.flush(true);
    expect(f.acknowledge.mock.calls).toEqual([[1], [2]]); expect(f.flow.failed).toBe(false);
    expect(f.render).toHaveBeenCalledTimes(2);
  });

  it("ignores stale parser callbacks and late packets after disposal", async () => {
    const f = fixture(); f.flow.accept({ sequence: 1, bytes: [1] }); f.flow.dispose();
    f.parsed[0](); f.flow.accept({ sequence: 2, bytes: [2] }); await tick();
    expect(f.render).toHaveBeenCalledOnce(); expect(f.acknowledge).not.toHaveBeenCalled();
  });

  it("does not follow an old in-flight ACK with new work after disposal", async () => {
    const f = fixture(); let resolve!: () => void;
    f.acknowledge.mockReturnValueOnce(new Promise<void>(yes => { resolve = yes; }));
    f.flow.accept({ sequence: 1, bytes: [1] }); f.parsed[0](); await tick();
    f.flow.accept({ sequence: 2, bytes: [2] }); f.parsed[1](); f.flow.dispose();
    resolve(); await tick(); expect(f.acknowledge.mock.calls).toEqual([[1]]);
  });

  it("fails closed on a renderer exception without repeatedly retrying a partially parsed packet", async () => {
    const f = fixture(); f.render.mockImplementation(() => { throw new Error("disposed renderer"); });
    f.flow.accept({ sequence: 1, bytes: [1] }); f.flow.accept({ sequence: 2, bytes: [2] });
    expect(f.error).toHaveBeenCalledOnce(); expect(f.render).toHaveBeenCalledOnce();
    await expect(f.flow.flush(true)).rejects.toThrow("disposed renderer");
    expect(f.acknowledge).not.toHaveBeenCalled();
  });

  it.each([
    { sequence: 2, bytes: [1] }, { sequence: -1, bytes: [1] },
    { sequence: Number.MAX_SAFE_INTEGER + 1, bytes: [1] }, { sequence: 1, bytes: [] },
  ])("refuses malformed or missing packets: %j", async packet => {
    const f = fixture(); f.flow.accept(packet); await tick();
    expect(f.error).toHaveBeenCalledOnce(); expect(f.render).not.toHaveBeenCalled();
    expect(f.acknowledge).not.toHaveBeenCalled();
  });

  it("streams 8 MiB through a deliberately slow parser inside a 256 KiB credit window", async () => {
    const packetBytes = 8192; const windowBytes = 256 * 1024; const total = 1024;
    let sent = 0; let acked = 0; let consumed = 0; let maximum = 0;
    const queue: { packet: NativeTerminalOutput; parsed: () => void }[] = [];
    const observed: number[] = [];
    const flow = new TerminalOutputFlow((bytes, parsed) => {
      queue.push({ packet: { sequence: ++consumed, bytes }, parsed });
    }, async sequence => { acked = sequence; }, error => { throw error; });
    const send = () => {
      while (sent < total && (sent - acked + 1) * packetBytes <= windowBytes) {
        sent += 1; flow.accept({ sequence: sent, bytes: Array(packetBytes).fill(sent % 256) });
        maximum = Math.max(maximum, (sent - acked) * packetBytes);
      }
    };
    send(); expect(sent).toBe(32); await tick(); expect(acked).toBe(0);
    while (acked < total) {
      // A slow parser processes only four chunks per turn.
      for (const item of queue.splice(0, 4)) {
        expect(item.packet.bytes.every(byte => byte === item.packet.sequence % 256)).toBe(true);
        observed.push(item.packet.sequence); item.parsed();
      }
      await tick(); send();
    }
    expect(observed).toEqual(Array.from({ length: total }, (_, index) => index + 1));
    expect(maximum).toBe(windowBytes); expect(queue).toHaveLength(0); flow.dispose();
  });
});
