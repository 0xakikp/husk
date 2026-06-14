import type { EditorChatMessage, SessionModelOverride } from "./types";

export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: EditorChatMessage[];
  /** Per-session model override. Falls back to global Settings default when null. */
  modelOverride?: SessionModelOverride;
}

export interface SessionStore {
  activeSessionId: string | null;
  sessions: ChatSession[];
}

const LS_PREFIX = "huskv2.ai.sessions";

function hashString(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return "h" + Math.abs(h).toString(36);
}

/** Derive a workspace key from the directory of the active file. */
export function getWorkspaceKey(activePath: string | null): string {
  if (!activePath) return "default";
  const lastSlash = activePath.lastIndexOf("/");
  const dir = lastSlash >= 0 ? activePath.slice(0, lastSlash) : activePath;
  return hashString(dir);
}

function getKey(workspace: string): string {
  return `${LS_PREFIX}.${workspace}`;
}

export function loadSessions(workspace: string): SessionStore {
  try {
    const raw = localStorage.getItem(getKey(workspace));
    if (!raw) return { activeSessionId: null, sessions: [] };
    return JSON.parse(raw) as SessionStore;
  } catch {
    return { activeSessionId: null, sessions: [] };
  }
}

export function saveSessions(workspace: string, store: SessionStore): void {
  try {
    localStorage.setItem(getKey(workspace), JSON.stringify(store));
  } catch {
    // storage unavailable
  }
}

export function createSession(
  messages: EditorChatMessage[] = [],
  modelOverride?: SessionModelOverride
): ChatSession {
  const now = Date.now();
  const title =
    messages.length > 0 && messages[0].role === "user"
      ? messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? "…" : "")
      : "New Chat";
  return {
    id: `s-${now.toString(36)}-${crypto.randomUUID()}`,
    title,
    createdAt: now,
    updatedAt: now,
    messages,
    modelOverride,
  };
}

export function updateSessionTitle(
  store: SessionStore,
  sessionId: string,
  title: string
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId ? { ...s, title, updatedAt: Date.now() } : s
    ),
  };
}

export function updateSessionMessages(
  store: SessionStore,
  sessionId: string,
  messages: EditorChatMessage[]
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId ? { ...s, messages, updatedAt: Date.now() } : s
    ),
  };
}

export function updateSessionModelOverride(
  store: SessionStore,
  sessionId: string,
  modelOverride: SessionModelOverride
): SessionStore {
  return {
    ...store,
    sessions: store.sessions.map((s) =>
      s.id === sessionId ? { ...s, modelOverride, updatedAt: Date.now() } : s
    ),
  };
}

export function deleteSession(store: SessionStore, sessionId: string): SessionStore {
  const filtered = store.sessions.filter((s) => s.id !== sessionId);
  return {
    sessions: filtered,
    activeSessionId:
      store.activeSessionId === sessionId
        ? filtered[0]?.id ?? null
        : store.activeSessionId,
  };
}

export function setActiveSession(store: SessionStore, sessionId: string | null): SessionStore {
  return { ...store, activeSessionId: sessionId };
}
