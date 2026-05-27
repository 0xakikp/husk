import { useCallback, useEffect, useRef, useState } from "react";
import { loadConfig, getKey } from "../store";
import { getProvider } from "../providers";
import { streamChat } from "../client";
import { useAgents, useActiveAgentId } from "../agents";
import { buildEditorContext, formatContextForPrompt } from "./context";
import { parseEdits, applyAiEdit } from "./editorStore";
import type { EditorChatMessage, CodeEdit, SessionModelOverride } from "./types";
import { EDITOR_SYSTEM_PROMPT, supportsVision } from "./types";

let msgId = 0;
function nextId() {
  return `m${++msgId}`;
}

export function useAiEditorChat(
  activePath: string | null,
  openFiles: string[],
  modelOverride?: SessionModelOverride,
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
    async (opts?: { text?: string; image?: string }) => {
      const text = (opts?.text ?? input).trim();
      if (!text || busy) return;

      // Resolve model: session override > agent override > global default
      const cfg = loadConfig();
      const resolvedProviderId = modelOverride?.providerId ?? cfg.providerId;
      const resolvedModel = modelOverride?.model ?? agent.model ?? cfg.model;
      const provider = getProvider(resolvedProviderId);
      const apiKey = getKey(provider.id);

      if (!provider.keyless && !apiKey) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `⚠️ Set a ${provider.label} API key in Settings → Models.` },
        ]);
        return;
      }

      // Vision warning
      if (opts?.image && !supportsVision(resolvedModel)) {
        setMessages((prev) => [
          ...prev,
          { id: nextId(), role: "assistant", content: `⚠️ The selected model (${resolvedModel}) does not support image input. Switch to Claude Sonnet/Opus, GPT-4o, or Gemini for vision.` },
        ]);
        return;
      }

      const userMsg: EditorChatMessage = {
        id: nextId(),
        role: "user",
        content: text,
        image: opts?.image,
      };
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
          { provider, model: resolvedModel, apiKey, baseURL: cfg.baseURL },
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
    [input, busy, activePath, openFiles, agent, modelOverride]
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
