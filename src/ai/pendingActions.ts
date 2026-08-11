import type { HuskActionRequest } from "./actionBroker";

export type PendingMcpAction = {
  id: string;
  request: Extract<HuskActionRequest, { kind: "mcp.call" }>;
  sessionId?: string;
  label: string;
  timestamp: number;
};

let pending: PendingMcpAction[] = [];
const listeners = new Set<() => void>();

function notify() { listeners.forEach((listener) => listener()); }

export function addPendingMcpAction(action: Omit<PendingMcpAction, "id" | "timestamp">): PendingMcpAction {
  const item = { ...action, id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, timestamp: Date.now() };
  pending = [...pending, item];
  notify();
  return item;
}

export function getPendingMcpActions(): PendingMcpAction[] { return [...pending]; }

export function removePendingMcpAction(id: string): void {
  pending = pending.filter((item) => item.id !== id);
  notify();
}

export function subscribePendingMcpActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
