import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, getKey } from "../store";
import { getProvider } from "../providers";
import { streamChat } from "../client";
import { useAgents, useActiveAgentId } from "../agents";
import { buildEditorContext, formatContextForPrompt } from "./context";
import { parseEdits, applyAiEdit } from "./editorStore";
import type { EditorChatMessage, CodeEdit } from "./types";
import { EDITOR_SYSTEM_PROMPT } from "./types";

let msgId = 0;
function nextId() {
  return `m${++msgId}`;
}

export function useAiEditorChat(
  activePath: string | null,
  openFiles: string[],
) {
  const [messages, setMessages] = useState<EditorChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingEdits, setPendingEdits] = useState<CodeEdit[]>([]);
  const [appliedCount, setAppliedCount] = useState(0);
  const abortRef = useRef(false);

  // Ref so send() always reads latest messages even across resets
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const resetMessages = useCallback((msgs: EditorChatMessage[]) => {
    messagesRef.current = msgs;
    setMessages(msgs);
    setPendingEdits([]);
    setAppliedCount(0);
  }, []);

  const agents = useAgents();
  const activeAgentId = useActiveAgentId();
  const agent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  // Parse edits when streaming completes (busy → false)
  useEffect(() => {
    if (busy) {
      setPendingEdits([]);
      setAppliedCount(0);
      return;
    }
    const last = messages[messages.length - 1];
    if (last?.role === "assistant" && last.content) {
      const edits = parseEdits(last.content);
      setPendingEdits(edits);
    }
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || busy) return;

      const cfg = loadConfig();
      const provider = getProvider(cfg.providerId);
      const apiKey = getKey(provider.id);
      if (!provider.keyless && !apiKey) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `⚠️ Set a ${provider.label} API key in Settings → Models.` },
        ]);
        return;
      }

      const userMsg: EditorChatMessage = { id: nextId(), role: "user", content: text };
      const assistantMsg: EditorChatMessage = { id: nextId(), role: "assistant", content: "" };
      const currentMessages = messagesRef.current;
      const history: EditorChatMessage[] = [...currentMessages, userMsg];

      setMessages([...history, assistantMsg]);
      setInput("");
      setBusy(true);
      abortRef.current = false;

      try {
        const ctx = await buildEditorContext(activePath, openFiles.map((f) => f));
        const contextBlock = formatContextForPrompt(ctx);
        const system = `${agent.systemPrompt}\n\n${contextBlock}`;

        await streamChat(
          { provider, model: agent.model || cfg.model, apiKey, baseURL: cfg.baseURL },
          EDITOR_SYSTEM_PROMPT + "\n\n" + system,
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
          }
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
      }
    },
    // messagesRef is stable; read from it inside callback
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [input, busy, activePath, openFiles, agent]
  );

  const applyAll = useCallback(() => {
    let count = 0;
    for (const edit of pendingEdits) {
      if (applyAiEdit(edit.search, edit.replace)) count++;
    }
    setAppliedCount(count);
    setPendingEdits([]);
  }, [pendingEdits]);

  const rejectAll = useCallback(() => {
    setPendingEdits([]);
  }, []);

  const applyOne = useCallback((index: number) => {
    setPendingEdits((prev) => {
      const edit = prev[index];
      if (edit && applyAiEdit(edit.search, edit.replace)) {
        setAppliedCount((c) => c + 1);
      }
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  const rejectOne = useCallback((index: number) => {
    setPendingEdits((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const stop = useCallback(() => {
    abortRef.current = true;
    setBusy(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setInput("");
    setPendingEdits([]);
    setAppliedCount(0);
  }, []);

  return {
    messages,
    input,
    setInput,
    busy,
    send,
    stop,
    clear,
    resetMessages,
    pendingEdits,
    appliedCount,
    applyAll,
    rejectAll,
    applyOne,
    rejectOne,
  };
}
