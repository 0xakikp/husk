import { useSyncExternalStore } from "react";

type Role = "user" | "assistant";

export type AiMessage = {
  role: Role;
  content: string;
  streaming?: boolean;
};

export type AiSession = {
  id: string;
  name: string;
  messages: AiMessage[];
  input: string;
  source: "terminal" | "ai-tab";
  tabId?: number;
  createdAt: number;
  updatedAt: number;
};

const sessions = new Map<string, AiSession>();
const subscribers = new Set<() => void>();

let activeSessionId: string | null = null;
const activeSubscribers = new Set<() => void>();

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
  updateSession(id, (s) => ({ ...s, messages: [...s.messages, message] }));
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

export function createSession(options: { name?: string; source?: "terminal" | "ai-tab"; tabId?: number } = {}): AiSession {
  const id = options.tabId ? `tab-${options.tabId}` : `ai-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const session: AiSession = {
    id,
    name: options.name || (options.tabId ? `Tab ${options.tabId}` : "New AI Chat"),
    messages: [],
    input: "",
    source: options.source || "ai-tab",
    tabId: options.tabId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  sessions.set(id, session);
  invalidateSessions();
  subscribers.forEach((fn) => fn());
  return session;
}

export function ensureSession(id: string, options?: { name?: string; source?: "terminal" | "ai-tab"; tabId?: number }): AiSession {
  if (sessions.has(id)) return sessions.get(id)!;
  const session: AiSession = {
    id,
    name: options?.name || (options?.tabId ? `Tab ${options.tabId}` : "AI Chat"),
    messages: [],
    input: "",
    source: options?.source || "ai-tab",
    tabId: options?.tabId,
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
