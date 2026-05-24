import { useRef, useState, type MouseEvent } from "react";
import { streamChat, type ChatMessage } from "./client";
import { loadConfig, getKey } from "./store";
import { getProvider } from "./providers";
import { getActiveAgent } from "./agents";
import { readActiveTerminal } from "./terminalContext";

/**
 * A compact, draggable floating AI chat for quick questions without opening the
 * full panel. Reuses the configured provider/model/key and the active agent,
 * and includes the active terminal's output as context.
 */
export function AiMiniWindow({ onClose }: { onClose: () => void }) {
  const [pos, setPos] = useState(() => ({
    x: Math.max(12, window.innerWidth - 372),
    y: Math.max(12, window.innerHeight - 440),
  }));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const send = async () => {
    const text = input.trim();
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
    const ctx = readActiveTerminal();
    const system = ctx
      ? `${agent.systemPrompt}\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\``
      : agent.systemPrompt;
    const append = (delta: string) =>
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = { ...last, content: last.content + delta };
        return next;
      });
    try {
      await streamChat(
        { provider, model: agent.model || cfg.model, apiKey, baseURL: cfg.baseURL },
        system,
        history,
        append,
      );
    } catch (e) {
      append(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }),
      );
    }
  };

  return (
    <div className="ai-mini" style={{ left: pos.x, top: pos.y }} data-ai-mini>
      <div className="ai-mini-head" onMouseDown={startDrag}>
        <span>✦ Quick AI</span>
        <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
          ×
        </button>
      </div>
      <div className="ai-mini-body" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="ai-empty">Ask a quick question. Drag the header to move me.</div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-${m.role}`}>
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          ))
        )}
      </div>
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
          placeholder="Ask…"
          rows={2}
        />
        <button type="button" onClick={() => void send()} disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
