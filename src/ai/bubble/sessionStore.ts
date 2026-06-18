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
const LS_ALL_KEY = "huskv2.ai.bubble.all-sessions";

function getLsKey(tabId?: number | string): string {
  const ws = getWorkspaceRoot();
  const wsPart = ws ? `:${encodeURIComponent(ws)}` : "";
  const tabPart = tabId !== undefined ? `:${tabId}` : "";
  return `${LS_PREFIX}${tabPart}${wsPart}`;
}

/** Load the active session ID for a specific tab (per-tab state) */
export function loadBubbleSessions(tabId?: number | string): BubbleSessionStore {
  try {
    const raw = localStorage.getItem(getLsKey(tabId));
    if (!raw) return { activeSessionId: null, sessions: [] };
    return JSON.parse(raw) as BubbleSessionStore;
  } catch {
    return { activeSessionId: null, sessions: [] };
  }
}

/** Save the active session ID for a specific tab (per-tab state) */
export function saveBubbleSessions(store: BubbleSessionStore, tabId?: number | string): void {
  try {
    localStorage.setItem(getLsKey(tabId), JSON.stringify(store));
  } catch {
    // storage unavailable
  }
}

/** Load ALL sessions across all tabs (global session registry) */
export function loadAllBubbleSessions(): BubbleSession[] {
  try {
    const raw = localStorage.getItem(LS_ALL_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BubbleSession[];
  } catch {
    return [];
  }
}

/** Save ALL sessions across all tabs (global session registry) */
export function saveAllBubbleSessions(sessions: BubbleSession[]): void {
  try {
    localStorage.setItem(LS_ALL_KEY, JSON.stringify(sessions));
  } catch {
    // storage unavailable
  }
}

/** Add or update a session in the global registry */
export function upsertGlobalSession(session: BubbleSession): void {
  const all = loadAllBubbleSessions();
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) {
    all[idx] = session;
  } else {
    all.unshift(session);
  }
  saveAllBubbleSessions(all);
}

/** Delete a session from the global registry */
export function deleteGlobalSession(sessionId: string): void {
  const all = loadAllBubbleSessions().filter((s) => s.id !== sessionId);
  saveAllBubbleSessions(all);
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
