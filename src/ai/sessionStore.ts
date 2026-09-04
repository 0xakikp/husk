import { useSyncExternalStore } from "react";
import { restoreAiTask, type AiTaskState } from "./taskMode";
import { normalizeRemoteWorkspace, type RemoteWorkspaceScope } from "./remoteWorkspace";

type Role = "user" | "assistant";

/** Immutable request evidence displayed below an assistant reply. It is stored
 * with the session so reopening a chat never turns a tool-assisted answer into
 * an unexplained wall of text. */
export type AiToolTrace = {
  name: string;
  state: "running" | "complete";
};

export type AiReplyTrace = {
  providerLabel: string;
  modelLabel: string;
  mode: "api" | "subscription";
  /** The workspace explicitly selected for this request, if any. */
  workspacePath?: string;
  /** An explicitly enabled folder on the active SSH host, if any. */
  remoteWorkspace?: RemoteWorkspaceScope;
  /** The legacy signed-in CLI edit-proposal format was enabled for this request. */
  workspaceEditAccess?: boolean;
  /** This request could apply eligible proposals automatically in-memory only. */
  workspaceAutoApply?: boolean;
  context: { label: string; bytes: number }[];
  tools: AiToolTrace[];
};

export type AiMessage = {
  role: Role;
  content: string;
  streaming?: boolean;
  timestamp?: number;
  trace?: AiReplyTrace;
};

export type AiSession = {
  id: string;
  name: string;
  messages: AiMessage[];
  input: string;
  source: "terminal" | "ai-tab";
  tabId?: number;
  /**
   * The folder this chat treats as its project. Old sessions intentionally
   * have no value here, which means general chat rather than silently binding
   * historical messages to whichever folder happens to be open now.
   */
  workspacePath?: string;
  /** Optional SSH folder access. SSH chats are terminal-only until this is set. */
  remoteWorkspace?: RemoteWorkspaceScope;
  /** Explicit, scope-specific compatibility flag for the legacy signed-in CLI
      edit-proposal format. It never grants direct filesystem write access. */
  workspaceEditAccess?: boolean;
  /** Persistent supervised work state. Running tasks restore paused so Husk
      never resumes actions silently after an application restart. */
  task?: AiTaskState;
  createdAt: number;
  updatedAt: number;
  archived?: boolean;
};

const LS_KEY = "huskv2.ai.sessions.v1";

const sessions = new Map<string, AiSession>();
const subscribers = new Set<() => void>();

let activeSessionId: string | null = null;
const activeSubscribers = new Set<() => void>();

/** Names assigned by Husk before a conversation has established a topic. */
const PLACEHOLDER_NAME = /^(new ai chat|ai chat|general chat|tab \d+|terminal \d+)$/i;

const LOW_SIGNAL_OPENING = /^(hi|hello|hey|yo|test|testing|thanks|thank you|yes|no|ok|okay|how are you|who are you)[!?.\s]*$/i;

/** First line of a user request, trimmed to fit the sidebar. */
function titleFrom(text: string): string {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length > 0);
  if (!line) return "";
  const clean = line.replace(/^[/>#\s-]+/, "").trim();
  if (clean.length === 0) return "";
  return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
}

/** Keep terminal identity in the session id/source while giving the visible
 * conversation a useful name. A greeting remains "General chat" until a
 * substantive request arrives, at which point it can still be replaced. */
export function automaticSessionName(currentName: string, messages: AiMessage[]): string {
  if (!PLACEHOLDER_NAME.test(currentName.trim())) return currentName;
  const userMessages = messages
    .filter((message) => message.role === "user")
    .map((message) => message.content.trim())
    .filter(Boolean);
  if (userMessages.length === 0) return currentName;
  const meaningful = userMessages.find((message) => !LOW_SIGNAL_OPENING.test(message));
  return titleFrom(meaningful || "") || "General chat";
}

function loadSessions() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { sessions: AiSession[]; activeSessionId?: string | null };
    if (Array.isArray(parsed.sessions)) {
      sessions.clear();
      for (const s of parsed.sessions) {
        if (s.id) {
          const restored = {
            ...s,
            remoteWorkspace: normalizeRemoteWorkspace(s.remoteWorkspace),
            task: restoreAiTask(s.task),
          };
          sessions.set(s.id, {
            ...restored,
            name: automaticSessionName(restored.name, restored.messages),
          });
        }
      }
      if (activeSessionId === null && parsed.activeSessionId && sessions.has(parsed.activeSessionId)) {
        activeSessionId = parsed.activeSessionId;
      }
    }
  } catch {
    // ignore
  }
}

function saveSessions() {
  try {
    const payload = {
      sessions: Array.from(sessions.values()),
      activeSessionId,
    };
    localStorage.setItem(LS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function ensureGlobalSession() {
  if (!sessions.has("global")) {
    sessions.set("global", {
      id: "global",
      name: "Global AI",
      messages: [],
      input: "",
      source: "ai-tab",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }
}

loadSessions();
ensureGlobalSession();

export function getSession(id: string): AiSession {
  const s = sessions.get(id);
  if (s) return s;
  ensureGlobalSession();
  return sessions.get("global")!;
}

let cachedSessions: AiSession[] = [];
let cachedSessionsDirty = true;

function recomputeSessions() {
  cachedSessions = Array.from(sessions.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  cachedSessionsDirty = false;
}

export function getAllSessions(): AiSession[] {
  if (cachedSessionsDirty) {
    recomputeSessions();
  }
  return cachedSessions;
}

function invalidateSessions() {
  cachedSessionsDirty = true;
  saveSessions();
}

export function updateSession(id: string, updater: (s: AiSession) => AiSession) {
  const next = updater(getSession(id));
  next.updatedAt = Date.now();
  sessions.set(id, next);
  invalidateSessions();
  subscribers.forEach((fn) => fn());
}

export function setSessionInput(id: string, input: string) {
  updateSession(id, (s) => ({ ...s, input }));
}

export function appendSessionMessage(id: string, message: AiMessage) {
  updateSession(id, (s) => {
    const messages = [...s.messages, message];
    return {
      ...s,
      name: message.role === "user" ? automaticSessionName(s.name, messages) : s.name,
      messages,
    };
  });
}

export function updateLastMessage(id: string, updater: (m: AiMessage) => AiMessage) {
  updateSession(id, (s) => {
    const messages = [...s.messages];
    const last = messages[messages.length - 1];
    if (last) {
      messages[messages.length - 1] = updater(last);
    }
    return { ...s, messages };
  });
}

export function createSession(options: {
  name?: string;
  source?: "terminal" | "ai-tab";
  tabId?: number;
  workspacePath?: string;
  remoteWorkspace?: RemoteWorkspaceScope;
  workspaceEditAccess?: boolean;
} = {}): AiSession {
  const id = options.tabId ? `tab-${options.tabId}` : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const session: AiSession = {
    id,
    name: options.name || (options.tabId ? `Tab ${options.tabId}` : "New AI Chat"),
    messages: [],
    input: "",
    source: options.source || "ai-tab",
    tabId: options.tabId,
    workspacePath: options.workspacePath,
    remoteWorkspace: normalizeRemoteWorkspace(options.remoteWorkspace),
    workspaceEditAccess: options.workspaceEditAccess,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  invalidateSessions();
  subscribers.forEach((fn) => fn());
  return session;
}

export function ensureSession(id: string, options?: {
  name?: string;
  source?: "terminal" | "ai-tab";
  tabId?: number;
  workspacePath?: string;
  remoteWorkspace?: RemoteWorkspaceScope;
  workspaceEditAccess?: boolean;
}): AiSession {
  if (sessions.has(id)) return sessions.get(id)!;
  const session: AiSession = {
    id,
    name: options?.name || (options?.tabId ? `Tab ${options.tabId}` : "AI Chat"),
    messages: [],
    input: "",
    source: options?.source || "ai-tab",
    tabId: options?.tabId,
    workspacePath: options?.workspacePath,
    remoteWorkspace: normalizeRemoteWorkspace(options?.remoteWorkspace),
    workspaceEditAccess: options?.workspaceEditAccess,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  invalidateSessions();
  subscribers.forEach((fn) => fn());
  return session;
}

export function renameSession(id: string, name: string) {
  updateSession(id, (s) => ({ ...s, name }));
}

export function archiveSession(id: string) {
  updateSession(id, (s) => ({ ...s, archived: true }));
}

export function unarchiveSession(id: string) {
  updateSession(id, (s) => ({ ...s, archived: false }));
}

export function deleteSession(id: string) {
  if (id === "global" && sessions.size <= 1) return;
  sessions.delete(id);
  if (activeSessionId === id) {
    activeSessionId = "global";
    activeSubscribers.forEach((fn) => fn());
  }
  invalidateSessions();
  subscribers.forEach((fn) => fn());
}

export function subscribeSessions(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function setActiveSessionId(id: string) {
  activeSessionId = id;
  saveSessions();
  activeSubscribers.forEach((fn) => fn());
}

export function subscribeActiveSession(fn: () => void): () => void {
  activeSubscribers.add(fn);
  return () => activeSubscribers.delete(fn);
}

export function useSessions() {
  return useSyncExternalStore(subscribeSessions, getAllSessions);
}

export function useActiveSessionId() {
  return useSyncExternalStore(subscribeActiveSession, getActiveSessionId);
}

export function tabSessionId(tabId: number): string {
  return `tab-${tabId}`;
}

export function isTabSessionId(sessionId: string): boolean {
  return sessionId.startsWith("tab-");
}
