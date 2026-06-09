import { useRef, useState, useCallback, useMemo, type MouseEvent } from "react";
import { streamChat, type ChatMessage } from "./client";
import { loadConfig, getKey } from "./store";
import { getProvider } from "./providers";
import { getActiveAgent } from "./agents";
import { readActiveTerminal } from "./terminalContext";
import { AiThinkingIndicator } from "./AiThinkingIndicator";
import { usePrefs } from "../settings/preferences";

const QUICK_PROMPTS = [
  "Explain this error",
  "Fix my code",
  "Write a test",
  "Refactor this",
];

interface MsgPart {
  type: "text" | "code";
  content: string;
  lang?: string;
}

function parseParts(content: string): MsgPart[] {
  const parts: MsgPart[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0;
  for (const m of content.matchAll(regex)) {
    if (m.index! > last) parts.push({ type: "text", content: content.slice(last, m.index) });
    parts.push({ type: "code", content: m[2], lang: m[1] || "plaintext" });
    last = m.index! + m[0].length;
  }
  if (last < content.length) parts.push({ type: "text", content: content.slice(last) });
  return parts;
}

export function AiMiniWindow({ onClose }: { onClose: () => void }) {
  const prefs = usePrefs();
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, window.innerWidth - 372),
    y: Math.max(12, window.innerHeight - 440),
  }));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef(false);
  const abortCtrlRef = useRef<AbortController | null>(null);

  const startDrag = (e: MouseEvent) => {
    e.preventDefault();
    const ox = e.clientX - pos.x;
    const oy = e.clientY - pos.y;
    const onMove = (ev: globalThis.MouseEvent) => {
      setPos({
        x: Math.min(window.innerWidth - 80, Math.max(0, ev.clientX - ox)),
        y: Math.min(window.innerHeight - 40, Math.max(0, ev.clientY - oy)),
      });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const stop = useCallback(() => {
    abortRef.current = true;
    abortCtrlRef.current?.abort();
    setBusy(false);
  }, []);

  const send = useCallback(async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || busy) return;
    const cfg = loadConfig();
    const provider = getProvider(cfg.providerId);
    const apiKey = getKey(provider.id);
    if (!provider.keyless && !apiKey) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Set an API key in the AI panel settings first." },
      ]);
      return;
    }
    const agent = getActiveAgent();
    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    abortRef.current = false;
    abortCtrlRef.current?.abort();
    abortCtrlRef.current = new AbortController();
    const ctx = readActiveTerminal();
    const system = ctx
      ? `${agent.systemPrompt}\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``
      : agent.systemPrompt;
    const append = (delta: string) => {
      if (abortRef.current) return;
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      });
    };
    try {
      await streamChat(
        { provider, model: agent.model || cfg.model, apiKey, baseURL: cfg.baseURL },
        system,
        history,
        append,
        undefined,
        abortCtrlRef.current?.signal,
      );
    } catch (e) {
      if (!abortRef.current) append(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  }, [input, busy, messages]);

  const handleQuick = (prompt: string) => {
    setInput("");
    void send(prompt);
  };

  const reset = () => {
    abortCtrlRef.current?.abort();
    setMessages([]);
    setInput("");
    abortRef.current = true;
    setBusy(false);
  };

  const miniBg = prefs.aiMiniBgEnabled && prefs.aiMiniBgPath
    ? {
        backgroundImage: `url("${prefs.aiMiniBgPath}")`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        opacity: prefs.aiMiniBgOpacity / 100,
        filter: prefs.aiMiniBgBlur > 0 ? `blur(${prefs.aiMiniBgBlur}px)` : undefined,
      }
    : undefined;

  return (
    <div
      className="ai-mini"
      style={{
        left: pos.x,
        top: pos.y,
        background: `rgba(30, 30, 45, ${prefs.aiMiniOpacity / 100})`,
      }}
      data-ai-mini
    >
      {miniBg ? (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={miniBg}
        />
      ) : null}
      {miniBg ? (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{ background: `rgba(0,0,0,${prefs.aiMiniBgDim / 100})` }}
        />
      ) : null}
      <div className="relative z-10 flex h-full flex-col">
        {/* Header */}
        <div className="ai-mini-head" onMouseDown={startDrag}>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-foreground/80">✦ Quick AI</span>
          {messages.length > 0 && (
            <button
              type="button"
              className="ai-mini-reset"
              onClick={reset}
              title="New chat"
            >
              ⊕
            </button>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={stop}
            disabled={!busy}
            title={busy ? "Stop generating" : "Idle"}
            className={
              "flex size-6 shrink-0 items-center justify-center rounded-md transition-all " +
              (busy
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20 animate-pulse"
                : "text-muted-foreground/20 cursor-not-allowed")
            }
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="shrink-0">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
            </svg>
          </button>
          <button type="button" className="ai-mini-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="ai-mini-body font-ai" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col gap-2">
            <div className="ai-empty">Ask a quick question. Drag the header to move me.</div>
            <div className="flex flex-wrap gap-1.5">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="ai-mini-chip"
                  onClick={() => handleQuick(p)}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <MiniMessage
              key={i}
              msg={m}
              isStreaming={busy && i === messages.length - 1 && m.role === "assistant"}
            />
          ))
        )}
      </div>

      {/* Input */}
      <div className="ai-mini-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={busy ? "Generating…" : "Ask…"}
          rows={2}
          disabled={busy}
        />
        <button type="button" onClick={() => void send()} disabled={busy || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </div>
      </div>
    </div>
  );
}

function MiniMessage({ msg, isStreaming }: { msg: ChatMessage; isStreaming?: boolean }) {
  const parts = useMemo(() => parseParts(msg.content), [msg.content]);

  return (
    <div className={`ai-mini-msg ai-mini-${msg.role}`}>
      <div className="ai-mini-avatar">{msg.role === "user" ? "You" : "AI"}</div>
      <div className="ai-mini-bubble">
        {parts.map((part, i) =>
          part.type === "code" ? (
            <MiniCodeBlock key={i} lang={part.lang} value={part.content} />
          ) : (
            <span key={i} className="whitespace-pre-wrap">{part.content}</span>
          ),
        )}
        {isStreaming && <AiThinkingIndicator label="AI is thinking…" />}
      </div>
    </div>
  );
}

function MiniCodeBlock({ lang, value }: { lang?: string; value: string }) {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch { /* ignore */ }
  };

  return (
    <div className="ai-mini-code">
      <div className="ai-mini-codebar">
        <span className="text-[10px] text-muted-foreground">{lang || "code"}</span>
        <button type="button" className="ai-mini-copy" onClick={handleCopy} title="Copy">
          Copy
        </button>
      </div>
      <pre className="text-[11px]"><code>{value}</code></pre>
    </div>
  );
}
