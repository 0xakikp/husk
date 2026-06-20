import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, getKey } from "../store";
import { getProvider } from "../providers";
import { streamChat, type ChatMessage } from "../client";
import { getActiveAgent } from "../agents";
import { readActiveTerminal } from "../terminalContext";
import { getEditorFile, getEditorSelection } from "../editorStore";
import { buildMcpTools } from "../../mcp/tools";
import { buildBuiltinTools, mergeTools } from "../builtinTools";
import { subscribeWorkspaceRoot } from "../../workspace/store";
import {
  loadBubbleSessions,
  saveBubbleSessions,
  loadAllBubbleSessions,
  saveAllBubbleSessions,
  upsertGlobalSession,
  deleteGlobalSession,
  createBubbleSession,
  updateBubbleSessionMessages,
  deleteBubbleSession,
  setActiveBubbleSession,
  type BubbleSessionStore,
  type BubbleSession,
} from "./sessionStore";

export interface AttachedFile {
  name: string;
  content: string;
}

export function useAiBubbleChat(tabId?: number) {
  const tabIdRef = useRef(tabId);
  tabIdRef.current = tabId;

  // Per-tab store (only tracks activeSessionId for this tab)
  const [store, setStore] = useState<BubbleSessionStore>(() => loadBubbleSessions(tabId));
  
  // Global sessions list (all sessions across all tabs)
  const [allSessions, setAllSessions] = useState<BubbleSession[]>(() => loadAllBubbleSessions());
  
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const inputRef = useRef("");
  inputRef.current = input;
  const setInputExternal = useRef<(text: string) => void>((text) => setInput(text));
  setInputExternal.current = (text) => setInput(text);

  const [busy, setBusy] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Active session is from global list, filtered by current tab's activeSessionId
  const activeSession = allSessions.find((s) => s.id === store.activeSessionId) ?? null;
  const loadedSessionIdRef = useRef<string | null>(null);

  // Reload sessions when workspace changes or tabId changes
  useEffect(() => {
    return subscribeWorkspaceRoot(() => {
      const next = loadBubbleSessions(tabIdRef.current);
      setStore(next);
      setAllSessions(loadAllBubbleSessions());
      loadedSessionIdRef.current = next.activeSessionId;
      setMessages(next.activeSessionId ? loadAllBubbleSessions().find((s) => s.id === next.activeSessionId)?.messages ?? [] : []);
    });
  }, []);

  // Reload when tabId prop changes
  useEffect(() => {
    const next = loadBubbleSessions(tabId);
    setStore(next);
    setAllSessions(loadAllBubbleSessions());
    loadedSessionIdRef.current = next.activeSessionId;
    setMessages(next.activeSessionId ? loadAllBubbleSessions().find((s) => s.id === next.activeSessionId)?.messages ?? [] : []);
  }, [tabId]);

  // Load messages when active session changes
  useEffect(() => {
    if (activeSession) {
      if (loadedSessionIdRef.current !== activeSession.id) {
        loadedSessionIdRef.current = activeSession.id;
        setMessages(activeSession.messages);
      }
    } else {
      loadedSessionIdRef.current = null;
      setMessages([]);
    }
  }, [activeSession]);

  // Persist messages after each change (and auto-title from first user message)
  useEffect(() => {
    if (!activeSession) return;
    
    // Update global session with new messages
    const updatedSession: BubbleSession = {
      ...activeSession,
      messages,
      updatedAt: Date.now(),
    };
    
    // Auto-title from first user message
    if (messages.length > 0 && messages[0].role === "user" && updatedSession.title === "New Chat") {
      updatedSession.title = messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? "…" : "");
    }
    
    upsertGlobalSession(updatedSession);
    setAllSessions(loadAllBubbleSessions());
    
    // Also update per-tab store (just the active session ID reference)
    const next = updateBubbleSessionMessages(store, activeSession.id, messages);
    setStore(next);
    saveBubbleSessions(next, tabIdRef.current);
    // We intentionally omit `store` from deps: it is updated inside this effect
    // (via setStore), so including it would cause an infinite loop. We only want
    // to persist when `messages` or `activeSession` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);


  const ensureSession = useCallback(() => {
    if (activeSession) return;
    const session = createBubbleSession();
    
    // Add to global registry
    upsertGlobalSession(session);
    setAllSessions(loadAllBubbleSessions());
    
    // Set as active for this tab only
    const next = {
      activeSessionId: session.id,
      sessions: [], // per-tab store only tracks active ID, not the list
    };
    setStore(next);
    saveBubbleSessions(next, tabIdRef.current);
    loadedSessionIdRef.current = session.id;
    setMessages([]);
  }, [activeSession, store]);

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || busy) return;

      // Read current Settings config fresh — the user may have changed it.
      const cfg = loadConfig();
      const provider = getProvider(cfg.providerId);
      const apiKey = getKey(provider.id);
      if (!provider.keyless && !apiKey) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: `⚠️ Set a ${provider.label} API key in Settings → Models first.` },
        ]);
        return;
      }

      const userMsg: ChatMessage = { role: "user", content: text };
      const assistantMsg: ChatMessage = { role: "assistant", content: "" };
      const currentMessages = messagesRef.current;
      const history: ChatMessage[] = [...currentMessages, userMsg];

      setMessages([...history, assistantMsg]);
      setInput("");
      setBusy(true);
      abortRef.current = false;
      abortCtrlRef.current?.abort();
      abortCtrlRef.current = new AbortController();

      const agent = getActiveAgent();
      const ctx = includeContext ? readActiveTerminal() : "";
      const base = agent.systemPrompt;

      let system = base + "\n\nYou have access to file tools: readFile, writeFile, listFiles, applyEdit, revertPendingEdit. Use them to explore the codebase, read files for context, and make surgical edits. When writing files, always write the complete file content. When editing, use applyEdit for small changes. If the user asks to revert/undo a change you just proposed, use revertPendingEdit to cancel it.";

      // Auto-context: current file and selection
      const currentFile = getEditorFile();
      const selection = getEditorSelection();
      if (currentFile) {
        system += `\n\nCurrent file: ${currentFile}`;
        if (selection) {
          system += `\nSelected lines ${selection.startLine}-${selection.endLine}:\n\`\`\`\n${selection.text}\n\`\`\``;
        }
      }

      if (ctx) {
        system += `\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``;
      }
      if (attachedFiles.length > 0) {
        const fileBlock = attachedFiles.map((f) => `--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
        system += `\n\nAttached files:\n${fileBlock}`;
      }

      const modelId = cfg.model || agent.model || provider.defaultModel;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console

      }

      try {
        const mcpTools = await buildMcpTools().catch(() => ({}));
        const builtinTools = buildBuiltinTools();
        const tools = mergeTools(builtinTools, mcpTools);
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<void>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error("Request timed out after 60s")), 60000);
        });
        await Promise.race([
          streamChat(
            { provider, model: modelId, apiKey, baseURL: cfg.baseURL },
            system,
            history,
            (delta) => {
              if (abortRef.current) return;
              setMessages((prev) => {
                const next = [...prev];
                const last = next[next.length - 1];
                if (last?.role === "assistant") {
                  next[next.length - 1] = { ...last, content: last.content + delta };
                }
                return next;
              });
            },
            tools,
            abortCtrlRef.current?.signal,
          ),
          timeoutPromise,
        ]);
        if (timeoutId) clearTimeout(timeoutId);
      } catch (e) {
        if (abortCtrlRef.current?.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.error("[AI] stream error:", e);
        }
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant") {
            next[next.length - 1] = { ...last, content: `⚠️ ${msg}` };
          }
          return next;
        });
      } finally {
        setBusy(false);
        setAttachedFiles([]);
      }
    },
    // messagesRef is a stable ref (mutated, not reassigned); we read from it
    // inside the callback so it doesn't need to be in deps. Including it would
    // create a new callback on every message update, breaking memoisation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, busy, includeContext, attachedFiles]
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setBusy(false);
    // Also clear any pending timeout so it doesn't leak
    // (handled by finally in send, but belt-and-suspenders)
  }, []);

  const clear = useCallback(() => {
    abortCtrlRef.current?.abort();
    setMessages([]);
    setInput("");
  }, []);

  // Session management
  const newSession = useCallback(() => {
    const session = createBubbleSession();
    
    // Add to global registry
    upsertGlobalSession(session);
    setAllSessions(loadAllBubbleSessions());
    
    // Set as active for this tab only
    const next = {
      activeSessionId: session.id,
      sessions: [],
    };
    setStore(next);
    saveBubbleSessions(next, tabIdRef.current);
    loadedSessionIdRef.current = session.id;
    setMessages([]);
  }, [store]);

  const switchSession = useCallback((id: string) => {
    // Update per-tab active session ID only
    setStore((prev) => {
      const next = setActiveBubbleSession(prev, id);
      saveBubbleSessions(next, tabIdRef.current);
      return next;
    });
    // Load messages from global registry
    const s = loadAllBubbleSessions().find((sess) => sess.id === id);
    if (s) {
      loadedSessionIdRef.current = id;
      setMessages(s.messages);
    }
  }, []);

  const deleteSession = useCallback((id: string) => {
    // Remove from global registry
    deleteGlobalSession(id);
    setAllSessions(loadAllBubbleSessions());
    
    // If this tab had this session active, clear it
    setStore((prev) => {
      const next = deleteBubbleSession(prev, id);
      saveBubbleSessions(next, tabIdRef.current);
      return next;
    });
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    // Update in global registry
    const all = loadAllBubbleSessions();
    const idx = all.findIndex((s) => s.id === id);
    if (idx >= 0) {
      all[idx] = { ...all[idx], title, updatedAt: Date.now() };
      saveAllBubbleSessions(all);
      setAllSessions(all);
    }
  }, []);

  return {
    messages,
    input,
    setInput,
    busy,
    send,
    stop,
    clear,
    includeContext,
    setIncludeContext,
    ensureSession,
    attachedFiles,
    setAttachedFiles,
    store: { activeSessionId: store.activeSessionId, sessions: allSessions },
    activeSession,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
  };
}
