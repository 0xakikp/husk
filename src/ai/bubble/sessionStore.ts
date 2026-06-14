import type { ChatMessage } from "../client";
import { getWorkspaceRoot } from "../../workspace/store";

export interface BubbleSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
}

export interface BubbleSessionStore {
  activeSessionId: string | null;
  sessions: BubbleSession[];
}

const LS_PREFIX = "huskv2.ai.bubble.sessions";

function getLsKey(): string {
  const ws = getWorkspaceRoot();
  return ws ? `${LS_PREFIX}:${encodeURIComponent(ws)}` : LS_PREFIX;
}

export function loadBubbleSessions(): BubbleSessionStore {
  try {
    const raw = localStorage.getItem(getLsKey());
    if (!raw) return { activeSessionId: null, sessions: [] };
    return JSON.parse(raw) as BubbleSessionStore;
  } catch {
    return { activeSessionId: null, sessions: [] };
  }
}

export function saveBubbleSessions(store: BubbleSessionStore): void {
  try {
    localStorage.setItem(getLsKey(), JSON.stringify(store));
  } catch {
    // storage unavailable
  }
}

export function createBubbleSession(messages: ChatMessage[] = []): BubbleSession {
  const now = Date.now();
  const title =
    messages.length > 0 && messages[0].role === "user"
      ? messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? "…" : "")
      : "New Chat";
  return {
    id: `b-${now.toString(36)}-${crypto.randomUUID()}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages,
  };
}

export function updateBubbleSessionTitle(
  store: BubbleSessionStore,
  sessionId: string,
  title: string
): BubbleSessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s
    ),
  };
}

export function updateBubbleSessionMessages(
  store: BubbleSessionStore,
  sessionId: string,
  messages: ChatMessage[]
): BubbleSessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId ? { ...s, messages, updatedAt: Date.now() } : s
    ),
  };
}

export function deleteBubbleSession(store: BubbleSessionStore, sessionId: string): BubbleSessionStore {
  const filtered = store.sessions.filter((s) => s.id !== sessionId);
  return {
    sessions: filtered,
    activeSessionId:
      store.activeSessionId === sessionId ? filtered[0]?.id ?? null : store.activeSessionId,
  };
}

export function setActiveBubbleSession(store: BubbleSessionStore, sessionId: string | null): BubbleSessionStore {
  return { ...store, activeSessionId: sessionId };
}
