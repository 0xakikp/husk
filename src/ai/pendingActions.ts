import type { HuskActionRequest, HuskActionResult } from "./actionBroker";
import { conversationIdentity, getAllSessions } from "./sessionStore";

export type PendingMcpAction = {
  id: string;
  request: Extract<HuskActionRequest, { kind: "mcp.call" }>;
  sessionId?: string;
  /** The conversation that proposed this action, not merely its reusable tab. */
  conversationId?: string;
  label: string;
  timestamp: number;
  /** Optional for older in-memory callers; new entries always start pending. */
  status?: "pending" | "running" | "settled";
  outcome?: HuskActionResult;
  receiptSaved?: boolean;
};

let pending: PendingMcpAction[] = [];
const listeners = new Set<() => void>();

function notify() { listeners.forEach((listener) => listener()); }

export function addPendingMcpAction(action: Pick<PendingMcpAction, "request" | "sessionId" | "label">): PendingMcpAction {
  const session = action.sessionId ? getAllSessions().find((item) => item.id === action.sessionId) : undefined;
  const item: PendingMcpAction = {
    ...action,
    request: structuredClone(action.request),
    conversationId: session ? conversationIdentity(session) : undefined,
    status: "pending",
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
  pending = [...pending, item];
  notify();
  return item;
}

export function getPendingMcpActions(): PendingMcpAction[] { return [...pending]; }

/** Claim synchronously, before reading preferences or awaiting a transport.
 * This lock belongs to the queue, so remounts and multiple views cannot rerun. */
export function claimPendingMcpAction(id: string): PendingMcpAction | null {
  const item = pending.find((entry) => entry.id === id);
  if (!item || (item.status ?? "pending") !== "pending") return null;
  const claimed: PendingMcpAction = { ...item, status: "running" };
  pending = pending.map((entry) => entry.id === id ? claimed : entry);
  notify();
  return claimed;
}

export function settlePendingMcpAction(id: string, outcome: HuskActionResult, receiptSaved: boolean): boolean {
  const item = pending.find((entry) => entry.id === id);
  if (item?.status !== "running") return false;
  pending = pending.map((entry) => entry.id === id ? { ...item, status: "settled", outcome, receiptSaved } : entry);
  notify();
  return true;
}

/** A submitted operation may already have mutated the service. Discarding its
 * card must never forget that operation or make the same approval available. */
export function removePendingMcpAction(id: string): boolean {
  const item = pending.find((entry) => entry.id === id);
  if (!item || item.status === "running") return false;
  pending = pending.filter((item) => item.id !== id);
  notify();
  return true;
}

export function subscribePendingMcpActions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
