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
});
