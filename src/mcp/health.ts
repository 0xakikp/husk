import { useSyncExternalStore } from "react";

import { connectMcpServer } from "./client";
import { resolveMcpServerEnv, type McpServerConfig } from "./store";

/**
 * Ephemeral MCP runtime status. Configuration lives in the store/TOML,
 * credentials in the keychain — this is only what the current session has
 * observed: did the handshake work, how many tools did the server offer, and
 * when did we last check. Nothing here persists across launches.
 */
export type McpHealth = {
  serverId: string;
  state: "idle" | "connecting" | "connected" | "error";
  checkedAt?: number;
  toolCount?: number;
  toolNames?: string[];
  message?: string;
};

const health = new Map<string, McpHealth>();
const subscribers = new Set<() => void>();

function emit(): void {
  for (const fn of subscribers) fn();
}

function setHealth(serverId: string, patch: Partial<McpHealth>): void {
  const current = health.get(serverId) ?? { serverId, state: "idle" as const };
  health.set(serverId, { ...current, ...patch });
  emit();
}

export function getMcpHealth(serverId: string): McpHealth {
  /* useSyncExternalStore compares snapshots by identity — a fresh `?? {}`
     object per call reads as "changed" forever and React throws an
     infinite-loop error. Cache the idle entry so the snapshot is stable. */
  let h = health.get(serverId);
  if (!h) {
    h = { serverId, state: "idle" };
    health.set(serverId, h);
  }
  return h;
}

export function subscribeMcpHealth(fn: () => void): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

export function useMcpHealth(serverId: string): McpHealth {
  return useSyncExternalStore(subscribeMcpHealth, () => getMcpHealth(serverId));
}

/** Called by buildMcpTools so the AI path reports the same status surface. */
export function reportMcpResult(serverId: string, ok: boolean, toolNames?: string[], message?: string): void {
  setHealth(serverId, {
    state: ok ? "connected" : "error",
    checkedAt: Date.now(),
    toolCount: ok ? (toolNames?.length ?? 0) : undefined,
    toolNames: ok ? toolNames : undefined,
    message: ok ? undefined : (message ?? "connection failed"),
  });
}

export function reportMcpConnecting(serverId: string): void {
  setHealth(serverId, { state: "connecting" });
}

/**
 * Scoped handshake: resolve keychain env, connect, list tools, keep the
 * client for reuse. The error message is surfaced verbatim — a failed test
 * that says nothing teaches nothing.
 */
export async function testMcpConnection(server: McpServerConfig): Promise<void> {
  setHealth(server.id, { state: "connecting", message: undefined });
  try {
    const env = await resolveMcpServerEnv(server);
    const tools = await connectMcpServer(server.id, server.name, {
      command: server.command,
      args: server.args,
      env,
      cwd: server.cwd,
    });
    setHealth(server.id, {
      state: "connected",
      checkedAt: Date.now(),
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name),
      message: undefined,
    });
  } catch (e) {
    setHealth(server.id, {
      state: "error",
      checkedAt: Date.now(),
      toolCount: undefined,
      toolNames: undefined,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
