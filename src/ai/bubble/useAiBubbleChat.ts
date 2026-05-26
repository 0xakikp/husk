import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, getKey } from "../store";
import { getProvider } from "../providers";
import { streamChat, type ChatMessage } from "../client";
import { getActiveAgent } from "../agents";
import { readActiveTerminal } from "../terminalContext";
import { buildMcpTools } from "../../mcp/tools";
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
  const cfg = loadConfig();
  const [store, setStore] = useState<BubbleSessionStore>(() => loadBubbleSessions());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [includeContext, setIncludeContext] = useState(true);
  const [selectedProviderId, setSelectedProviderId] = useState(cfg.providerId);
  const [selectedModel, setSelectedModel] = useState(cfg.model);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const abortRef = useRef(false);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const activeSession = store.sessions.find((s) => s.id === store.activeSessionId) ?? null;
  const loadedSessionIdRef = useRef<string | null>(null);

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

      const provider = getProvider(selectedProviderId);
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

      const agent = getActiveAgent();
      const ctx = includeContext ? readActiveTerminal() : "";
      const base = agent.systemPrompt;

      let system = base;
      if (ctx) {
        system += `\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``;
      }
      if (attachedFiles.length > 0) {
        const fileBlock = attachedFiles.map((f) => `--- ${f.name} ---\n\`\`\`\n${f.content}\n\`\`\``).join("\n\n");
        system += `\n\nAttached files:\n${fileBlock}`;
      }

      try {
        const tools = await buildMcpTools().catch(() => ({}));
        await streamChat(
          { provider, model: selectedModel || agent.model || cfg.model, apiKey, baseURL: cfg.baseURL },
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
          tools
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, busy, includeContext, selectedProviderId, selectedModel, attachedFiles]
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
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
    selectedProviderId,
    setSelectedProviderId,
    selectedModel,
    setSelectedModel,
    attachedFiles,
    setAttachedFiles,
    // Session management
    store,
    activeSession,
    newSession,
    switchSession,
    deleteSession,
    renameSession,
  };
}
