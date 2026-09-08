import { useSyncExternalStore } from "react";
import { restoreAiTask, type AiTaskState } from "./taskMode";
import { normalizeRemoteWorkspace, type RemoteWorkspaceScope } from "./remoteWorkspace";
import { dismissToast, toast } from "../toast/store";
import { openSessionDatabase, SessionSaveQueue, type SessionDatabase } from "./sessionPersistence";

type Role = "user" | "assistant";

/** Immutable request evidence displayed below an assistant reply. It is stored
 * with the session so reopening a chat never turns a tool-assisted answer into
 * an unexplained wall of text. */
export type AiToolTrace = {
  name: string;
  state: "running" | "complete" | "error" | "refused" | "queued";
};

export type AiReplyTrace = {
  providerLabel: string;
  modelLabel: string;
  mode: "api" | "subscription";
  /** The workspace explicitly selected for this request, if any. */
  workspacePath?: string;
  /** An explicitly enabled folder on the active SSH host, if any. */
  remoteWorkspace?: RemoteWorkspaceScope;
  /** The user enabled reviewed workspace changes for this request. */
  workspaceEditAccess?: boolean;
  /** This request could apply eligible proposals automatically in-memory only. */
  workspaceAutoApply?: boolean;
  context: { label: string; bytes: number }[];
  tools: AiToolTrace[];
  historyMessagesOmitted?: number;
};

export type AiMessage = {
  id?: string;
  role: Role;
  content: string;
  streaming?: boolean;
  timestamp?: number;
  trace?: AiReplyTrace;
  images?: { dataUrl: string; mediaType?: string }[];
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
  /** Explicit, scope-specific consent for reviewed changes from any provider.
      It never grants a provider direct filesystem write access. */
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
const changedBeforeLoad = new Set<string>();
let activeChangedBeforeLoad = false;
let initialized = false;
let initialization: Promise<boolean> | undefined;
let database: SessionDatabase<AiSession> | undefined;
let saveQueue: SessionSaveQueue<AiSession> | undefined;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
let storageToast: string | undefined;
let lifecycleInstalled = false;
let legacyLoadError: unknown;

export type SessionStorageStatus = { state: "loading" | "saving" | "saved" | "error"; message?: string };
let storageStatus: SessionStorageStatus = { state: "loading" };
const storageSubscribers = new Set<() => void>();

function setStorageStatus(state: SessionStorageStatus["state"], error?: unknown) {
  const message = error === undefined ? undefined : error instanceof Error ? error.message : String(error);
  storageStatus = { state, message };
  storageSubscribers.forEach((listener) => listener());
  if (state === "error" && !storageToast && typeof window !== "undefined") {
    storageToast = toast({
      title: "Chat changes have not been saved",
      message: `${message || "Chat storage is unavailable."} Keep Husk open while saving is retried.`,
      variant: "error",
      duration: 0,
      action: { label: "Retry save", onClick: () => { void flushSessionPersistence(); } },
    });
  } else if (state === "saved" && storageToast) {
    dismissToast(storageToast);
    storageToast = undefined;
  }
}

export function getSessionStorageStatus(): SessionStorageStatus { return storageStatus; }
export function useSessionStorageStatus(): SessionStorageStatus {
  return useSyncExternalStore((listener) => {
    storageSubscribers.add(listener);
    return () => storageSubscribers.delete(listener);
  }, getSessionStorageStatus);
}

function restoreSession(value: unknown): AiSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as AiSession;
  if (typeof session.id !== "string" || !session.id || typeof session.name !== "string" || !Array.isArray(session.messages)) return null;
  const messages = session.messages.filter((message) => message && (message.role === "user" || message.role === "assistant") && typeof message.content === "string").map((message, index) => ({
    ...message,
    id: message.id || `${session.id}-restored-${index}`,
    streaming: false,
    // A process cannot continue a tool after a restart. Do not leave stale
    // running indicators that imply a command is still being supervised.
    trace: message.trace && {
      ...message.trace,
      tools: (message.trace.tools || []).map((tool) => tool.state === "running" ? { ...tool, state: "error" as const } : tool),
    },
  }));
  return {
    ...session,
    messages,
    input: typeof session.input === "string" ? session.input : "",
    remoteWorkspace: normalizeRemoteWorkspace(session.remoteWorkspace),
    task: restoreAiTask(session.task),
    name: automaticSessionName(session.name, messages),
  };
}

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
      for (const s of parsed.sessions) {
        const restored = restoreSession(s);
        if (restored) sessions.set(restored.id, restored);
        else legacyLoadError = new Error("The previous chat archive contains an invalid conversation.");
      }
      if (activeSessionId === null && parsed.activeSessionId && sessions.has(parsed.activeSessionId)) {
        activeSessionId = parsed.activeSessionId;
      }
    } else legacyLoadError = new Error("The previous chat archive has an invalid format.");
  } catch (error) {
    if (typeof localStorage !== "undefined") legacyLoadError = error;
  }
}

/** Called before mounting the main window. Legacy data is retained until the
 * first IndexedDB transaction commits, so a failed migration is retryable. */
export async function initialiseSessionPersistence(): Promise<boolean> {
  if (initialized) return true;
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      database = await openSessionDatabase<AiSession>();
      const archive = await database.load();
      if (archive.initialized) {
        const untouched = new Map<string, AiSession>();
        for (const value of archive.sessions) {
          const restored = restoreSession(value);
          if (restored && !changedBeforeLoad.has(restored.id)) untouched.set(restored.id, restored);
        }
        for (const [id, value] of sessions) if (changedBeforeLoad.has(id)) untouched.set(id, value);
        sessions.clear();
        for (const [id, value] of untouched) sessions.set(id, value);
        if (!activeChangedBeforeLoad) activeSessionId = archive.activeSessionId && sessions.has(archive.activeSessionId) ? archive.activeSessionId : null;
      }
      ensureGlobalSession();
      initialized = true;
      const currentDatabase = database;
      saveQueue = new SessionSaveQueue((batch) => currentDatabase.commit(batch), setStorageStatus);
      if (!archive.initialized) {
        for (const session of sessions.values()) saveQueue.put(session);
        saveQueue.select(activeSessionId);
      } else {
        for (const id of changedBeforeLoad) {
          const session = sessions.get(id);
          if (session) saveQueue.put(session);
          else saveQueue.delete(id);
        }
        if (activeChangedBeforeLoad) saveQueue.select(activeSessionId);
      }
      changedBeforeLoad.clear();
      cachedSessionsDirty = true;
      subscribers.forEach((listener) => listener());
      activeSubscribers.forEach((listener) => listener());
      const saved = await saveQueue.flush();
      if (saved) setStorageStatus("saved");
      if (saved && !legacyLoadError) {
        try { localStorage.removeItem(LS_KEY); } catch { /* Keep the old backup if removal is unavailable. */ }
      }
      if (legacyLoadError && typeof window !== "undefined") {
        toast({ title: "Some previous chats could not be loaded", message: "The original chat archive has been kept for recovery.", variant: "error", duration: 0 });
      }
      return saved;
    } catch (error) {
      database?.close();
      database = undefined;
      setStorageStatus("error", error);
      if (!retryTimer && typeof window !== "undefined") retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void initialiseSessionPersistence();
      }, 5000);
      return false;
    }
  })();
  installPersistenceLifecycle();
  const success = await initialization;
  initialization = undefined;
  return success;
}

export async function flushSessionPersistence(): Promise<boolean> {
  if (!initialized && !await initialiseSessionPersistence()) return false;
  return saveQueue?.flush() ?? false;
}

export function hasUnsavedSessions(): boolean {
  return Boolean(saveQueue?.hasPending() || changedBeforeLoad.size || activeChangedBeforeLoad && !initialized);
}

function installPersistenceLifecycle() {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  window.addEventListener("pagehide", () => { if (hasUnsavedSessions()) void flushSessionPersistence(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && hasUnsavedSessions()) void flushSessionPersistence();
  });
  window.addEventListener("beforeunload", (event) => {
    if (!hasUnsavedSessions()) return;
    void flushSessionPersistence();
    event.preventDefault();
    event.returnValue = "";
  });
  if (!("__TAURI_INTERNALS__" in window)) return;
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const win = getCurrentWindow();
    let closeInProgress = false;
    let allowSavedClose = false;
    await win.onCloseRequested(async (event) => {
      if (allowSavedClose || !hasUnsavedSessions()) return;
      event.preventDefault();
      if (closeInProgress) return;
      closeInProgress = true;
      try {
        if (await flushSessionPersistence()) {
          allowSavedClose = true;
          await win.close();
        }
      } catch (error) {
        allowSavedClose = false;
        setStorageStatus("error", error);
      } finally { closeInProgress = false; }
    });
  }).catch((error) => {
    console.error("Chat save-on-close could not be registered", error);
  });
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

function invalidateSessions(id: string) {
  cachedSessionsDirty = true;
  if (!initialized) { changedBeforeLoad.add(id); return; }
  const session = sessions.get(id);
  if (session) saveQueue?.put(session);
  else saveQueue?.delete(id);
}

export function updateSession(id: string, updater: (s: AiSession) => AiSession) {
  updateExistingSession(id, updater);
}

/** Late stream/tool callbacks must not recreate a deleted conversation. */
export function updateExistingSession(id: string, updater: (s: AiSession) => AiSession): boolean {
  const existing = sessions.get(id);
  if (!existing) return false;
  const next = { ...updater(existing), id, updatedAt: Date.now() };
  sessions.set(id, next);
  invalidateSessions(id);
  subscribers.forEach((fn) => fn());
  return true;
}

export function setSessionInput(id: string, input: string) {
  updateSession(id, (s) => ({ ...s, input }));
}

export function appendSessionMessage(id: string, message: AiMessage) {
  updateSession(id, (s) => {
    const messages = [...s.messages, { ...message, id: message.id || crypto.randomUUID() }];
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
  invalidateSessions(id);
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
  invalidateSessions(id);
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
  ensureGlobalSession();
  if (activeSessionId === id) {
    activeSessionId = "global";
    if (initialized) saveQueue?.select(activeSessionId);
    else activeChangedBeforeLoad = true;
    activeSubscribers.forEach((fn) => fn());
  }
  invalidateSessions(id);
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
  if (initialized) saveQueue?.select(id);
  else activeChangedBeforeLoad = true;
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
