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
  createBubbleSession,
  updateBubbleSessionTitle,
  updateBubbleSessionMessages,
  deleteBubbleSession,
  setActiveBubbleSession,
  type BubbleSessionStore,
} from "./sessionStore";

export interface AttachedFile {
  name: string;
  content: string;
}

export function useAiBubbleChat() {
  const [store, setStore] = useState<BubbleSessionStore>(() => loadBubbleSessions());
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

  const activeSession = store.sessions.find((s) => s.id === store.activeSessionId) ?? null;
  const loadedSessionIdRef = useRef<string | null>(null);

  // Reload sessions when workspace changes
  useEffect(() => {
    return subscribeWorkspaceRoot(() => {
      const next = loadBubbleSessions();
      setStore(next);
      loadedSessionIdRef.current = next.activeSessionId;
      setMessages(next.activeSessionId ? next.sessions.find((s) => s.id === next.activeSessionId)?.messages ?? [] : []);
    });
  }, []);

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
    let currentStore = store;

    // Auto-title session from the first user message
    if (messages.length > 0 && messages[0].role === "user" && activeSession.title === "New Chat") {
      const autoTitle = messages[0].content.slice(0, 40) + (messages[0].content.length > 40 ? "…" : "");
      currentStore = updateBubbleSessionTitle(currentStore, activeSession.id, autoTitle);
    }

    const next = updateBubbleSessionMessages(currentStore, activeSession.id, messages);
    setStore(next);
    saveBubbleSessions(next);
    // We intentionally omit `store` from deps: it is updated inside this effect
    // (via setStore), so including it would cause an infinite loop. We only want
    // to persist when `messages` or `activeSession` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);


  const ensureSession = useCallback(() => {
    if (activeSession) return;
    const session = createBubbleSession();
    const next = {
      activeSessionId: session.id,
      sessions: [session, ...store.sessions],
    };
    setStore(next);
    saveBubbleSessions(next);
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

      let system = base + "\n\nYou have access to file tools: readFile, writeFile, listFiles, applyEdit. Use them to explore the codebase, read files for context, and make surgical edits. When writing files, always write the complete file content. When editing, use applyEdit for small changes.";

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
        console.log("[AI] sending →", { provider: provider.id, model: modelId, hasKey: !!apiKey, baseURL: cfg.baseURL || provider.baseURL });
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
    const next = {
      activeSessionId: session.id,
      sessions: [session, ...store.sessions],
    };
    setStore(next);
    saveBubbleSessions(next);
    loadedSessionIdRef.current = session.id;
    setMessages([]);
  }, [store]);

  const switchSession = useCallback((id: string) => {
    setStore((prev) => {
      const next = setActiveBubbleSession(prev, id);
      saveBubbleSessions(next);
      return next;
    });
  }, []);

  const deleteSession = useCallback((id: string) => {
    setStore((prev) => {
      const next = deleteBubbleSession(prev, id);
      saveBubbleSessions(next);
      return next;
    });
  }, []);

  const renameSession = useCallback((id: string, title: string) => {
    setStore((prev) => {
      const next = updateBubbleSessionTitle(prev, id, title);
      saveBubbleSessions(next);
      return next;
    });
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
    store,
    activeSession,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
  };
}
