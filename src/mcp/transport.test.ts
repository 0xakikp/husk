import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { TauriMcpTransport } from "./transport";

describe("TauriMcpTransport process monitoring", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers buffered messages and closes when the child exits", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "mcp_spawn") return Promise.resolve(7);
      if (command === "mcp_recv") return Promise.resolve({
        lines: ['{"jsonrpc":"2.0","method":"ready"}'],
        running: false,
        exit_code: 0,
        error: null,
      });
      if (command === "mcp_kill") return Promise.resolve();
      throw new Error(`unexpected command ${command}`);
    });

    const transport = new TauriMcpTransport({ command: "server" });
    const onMessage = vi.fn();
    const onClose = vi.fn();
    const onError = vi.fn();
    transport.onmessage = onMessage;
    transport.onclose = onClose;
    transport.onerror = onError;

    await transport.start();
    await vi.advanceTimersByTimeAsync(250);

    expect(onMessage).toHaveBeenCalledWith({ jsonrpc: "2.0", method: "ready" });
    expect(onError).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("mcp_kill", { id: 7 });
  });

  it("reports backpressure or process errors once and stops polling", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "mcp_spawn") return Promise.resolve(9);
      if (command === "mcp_recv") return Promise.resolve({
        lines: [],
        running: false,
        exit_code: 1,
        error: "MCP server produced more output than Husk could safely buffer",
      });
      if (command === "mcp_kill") return Promise.resolve();
      throw new Error(`unexpected command ${command}`);
    });

    const onExit = vi.fn();
    const transport = new TauriMcpTransport({ command: "server", onExit });
    const onClose = vi.fn();
    const onError = vi.fn();
    transport.onclose = onClose;
    transport.onerror = onError;

    await transport.start();
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(1000);

    expect(onExit).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError.mock.calls[0][0].message).toContain("safely buffer");
    expect(onClose).toHaveBeenCalledOnce();
    expect(invokeMock.mock.calls.filter(([name]) => name === "mcp_recv")).toHaveLength(1);
  });

  it("kills a late spawn after close and rejects concurrent starts", async () => {
    let spawned!: (id: number) => void;
    invokeMock.mockImplementation((command: string) => command === "mcp_spawn"
      ? new Promise<number>(resolve => { spawned = resolve; }) : Promise.resolve());
    const transport = new TauriMcpTransport({ command: "server" });
    transport.onclose = vi.fn();
    const starting = transport.start();
    const rejected = expect(starting).rejects.toThrow("closed during startup");
    await expect(transport.start()).rejects.toThrow("already started");
    await transport.close();
    spawned(42);
    await rejected;
    expect(invokeMock).toHaveBeenCalledWith("mcp_kill", { id: 42 });
    expect(transport.onclose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(invokeMock.mock.calls.some(([name]) => name === "mcp_recv")).toBe(false);
    await expect(transport.send({ jsonrpc: "2.0", method: "fixture" })).rejects.toThrow("closed");
  });

  it("ignores receive results after close", async () => {
    let received!: (value: unknown) => void;
    invokeMock.mockImplementation((command: string) => command === "mcp_spawn" ? Promise.resolve(7)
      : command === "mcp_recv" ? new Promise(resolve => { received = resolve; }) : Promise.resolve());
    const onExit = vi.fn();
    const transport = new TauriMcpTransport({ command: "server", onExit });
    transport.onmessage = vi.fn();
    transport.onerror = vi.fn();
    await transport.start();
    await vi.advanceTimersByTimeAsync(250);
    await transport.close();
    received({ lines: ['{"jsonrpc":"2.0","method":"stale"}'], running: false, exit_code: 1, error: "old" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.onmessage).not.toHaveBeenCalled();
    expect(transport.onerror).not.toHaveBeenCalled();
    expect(onExit).not.toHaveBeenCalled();
  });

  it("stops delivering a batch if its first callback closes the transport", async () => {
    invokeMock.mockImplementation((command: string) => command === "mcp_spawn" ? Promise.resolve(7)
      : command === "mcp_recv" ? Promise.resolve({
        lines: ['{"jsonrpc":"2.0","method":"first"}', '{"jsonrpc":"2.0","method":"second"}'],
        running: true, exit_code: null, error: null,
      }) : Promise.resolve());
    const transport = new TauriMcpTransport({ command: "server" });
    transport.onmessage = vi.fn(() => { void transport.close(); });
    await transport.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.onmessage).toHaveBeenCalledOnce();
  });
});
