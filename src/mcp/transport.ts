import { invoke } from "@tauri-apps/api/core";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export type TauriMcpTransportOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Called only when the child or protocol ends unexpectedly, not on close(). */
  onExit?: (error?: Error) => void;
};

type McpReceive = {
  lines: string[];
  running: boolean;
  exit_code: number | null;
  error: string | null;
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
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private closed = false;
  private starting = false;

  constructor(options: TauriMcpTransportOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.closed) throw new Error("Transport is closed");
    if (this._sessionId != null || this.starting) throw new Error("Transport already started");
    this.starting = true;
    try {
      const id = await invoke<number>("mcp_spawn", {
        command: this.options.command,
        args: this.options.args ?? [],
        env: this.options.env ?? null,
        cwd: this.options.cwd ?? null,
      });
      if (this.closed) {
        // close() may have run while native discovery/spawn was pending. It
        // could not know the ID then; dispose the late child, never adopt it.
        try { await invoke("mcp_kill", { id }); } catch { /* Already exited. */ }
        throw new Error("Transport closed during startup");
      }
      this._sessionId = id;
      this.schedulePoll();
    } finally {
      this.starting = false;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("Transport is closed");
    if (this._sessionId == null) throw new Error("Transport not started");
    await invoke("mcp_send", { id: this._sessionId, message: JSON.stringify(message) });
  }

  async close(): Promise<void> {
    await this.finish();
  }

  private schedulePoll(): void {
    if (this.closed || this._sessionId == null) return;
    /* A timeout scheduled only after the previous receive completes prevents
       slow native calls from accumulating overlapping polls. */
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      void this.poll();
    }, 250);
  }

  private async finish(error?: Error, unexpected = false): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    const id = this._sessionId;
    this._sessionId = null;
    if (id != null) {
      try {
        await invoke("mcp_kill", { id });
      } catch {
        // The child may already have exited. The session still closes locally.
      }
    }
    if (unexpected) this.options.onExit?.(error);
    if (error) this.onerror?.(error);
    this.onclose?.();
  }

  private async poll(): Promise<void> {
    if (this._sessionId == null || this.closed) return;
    const id = this._sessionId;
    try {
      const result = await invoke<McpReceive>("mcp_recv", { id, limit: 50 });
      if (this.closed || this._sessionId !== id) return;
      for (const line of result.lines) {
        // An onmessage callback can close the transport synchronously.
        if (this.closed || this._sessionId !== id) return;
        try {
          this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
        } catch {
          await this.finish(new Error("MCP server sent an invalid JSON-RPC message"), true);
          return;
        }
      }
      if (!result.running) {
        const detail = result.error || `MCP server exited with ${result.exit_code ?? "no status"}`;
        await this.finish(result.error || result.exit_code !== 0 ? new Error(detail) : undefined, true);
        return;
      }
      this.schedulePoll();
    } catch (cause) {
      if (this.closed || this._sessionId !== id) return;
      const error = cause instanceof Error ? cause : new Error(String(cause));
      await this.finish(error, true);
    }
  }
}
