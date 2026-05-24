import { invoke } from "@tauri-apps/api/core";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type TauriMcpTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
};

/**
 * MCP transport that bridges to the Rust child-process commands: spawns the
 * server, writes JSON-RPC lines to its stdin, and polls stdout for replies.
 */
export class TauriMcpTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private options: TauriMcpTransportOptions;
  private _sessionId: number | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;

  constructor(options: TauriMcpTransportOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("Transport is closed");
    this._sessionId = await invoke<number>("mcp_spawn", {
      command: this.options.command,
      args: this.options.args ?? [],
      env: this.options.env ?? null,
      cwd: this.options.cwd ?? null,
    });
    this.pollTimer = setInterval(() => void this.poll(), 100);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this._sessionId == null) throw new Error("Transport not started");
    await invoke("mcp_send", { id: this._sessionId, message: JSON.stringify(message) });
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this._sessionId != null) {
      try {
        await invoke("mcp_kill", { id: this._sessionId });
      } catch {
        // ignore
      }
      this._sessionId = null;
    }
    this.onclose?.();
  }

  private async poll(): Promise<void> {
    if (this._sessionId == null || this.closed) return;
    try {
      const lines = await invoke<string[]>("mcp_recv", { id: this._sessionId, limit: 50 });
      for (const line of lines) {
        try {
          this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
        } catch (e) {
          console.warn("[mcp] invalid JSON-RPC message:", line, e);
        }
      }
    } catch (e) {
      console.warn("[mcp] recv error:", e);
    }
  }
}
