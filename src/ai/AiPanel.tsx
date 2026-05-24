import { useEffect, useMemo, useRef, useState } from "react";
import { PROVIDERS, getProvider } from "./providers";
import { loadConfig, saveConfig, useKey, setKey, type StoredConfig } from "./store";
import { streamChat, type ChatMessage } from "./client";
import { readActiveTerminal } from "./terminalContext";
import { buildMcpTools } from "../mcp/tools";
import { ModelDetect } from "./ModelDetect";
import { useAgents, useActiveAgentId, setActiveAgent } from "./agents";

export function AiPanel({ onClose }: { onClose: () => void }) {
  const [config, setConfig] = useState<StoredConfig>(() => loadConfig());
  const [showSettings, setShowSettings] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const provider = useMemo(() => getProvider(config.providerId), [config.providerId]);
  const apiKey = useKey(provider.id);
  const needsKey = !provider.keyless && !apiKey;
  const agents = useAgents();
  const activeAgentId = useActiveAgentId();
  const agent = agents.find((a) => a.id === activeAgentId) ?? agents[0];

  useEffect(() => saveConfig(config), [config]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const selectProvider = (id: string) => {
    const p = getProvider(id);
    setConfig((c) => ({
      ...c,
      providerId: id,
      model: p.defaultModel,
      baseURL: p.baseURL ?? "",
    }));
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (needsKey) {
      setShowSettings(true);
      return;
    }

    const history: ChatMessage[] = [...messages, { role: "user", content: text }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);

    const ctx = readActiveTerminal();
    const base = agent.systemPrompt;
    const system = ctx ? `${base}\n\nActive terminal output:\n\`\`\`\n${ctx}\n\`\`\`` : base;

    try {
      const tools = await buildMcpTools().catch(() => ({}));
      await streamChat(
        { provider, model: agent.model || config.model, apiKey, baseURL: config.baseURL },
        system,
        history,
        (delta) => {
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
  };

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <select
          className="ai-agent"
          value={activeAgentId}
          onChange={(e) => setActiveAgent(e.target.value)}
          title="Agent"
        >
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          className="ai-provider"
          value={config.providerId}
          onChange={(e) => selectProvider(e.target.value)}
          title="Provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input
          className="ai-model"
          value={config.model}
          onChange={(e) => setConfig((c) => ({ ...c, model: e.target.value }))}
          placeholder="model id"
          title="Model"
        />
        <button
          type="button"
          className="ai-icon"
          title="Settings"
          onClick={() => setShowSettings((s) => !s)}
        >
          ⚙
        </button>
        <button type="button" className="ai-icon" title="Close" onClick={onClose}>
          ×
        </button>
      </div>

      {showSettings || needsKey ? (
        <div className="ai-settings">
          {!provider.keyless ? (
            <label className="ai-field">
              <span>{provider.label} API key</span>
              <input
                type="password"
                value={apiKey}
                placeholder="stored in your OS keychain"
                onChange={(e) => setKey(provider.id, e.target.value)}
              />
            </label>
          ) : null}
          {provider.configurableBaseURL ? (
            <label className="ai-field">
              <span>Base URL</span>
              <input
                value={config.baseURL}
                placeholder="http://localhost:1234/v1"
                onChange={(e) => setConfig((c) => ({ ...c, baseURL: e.target.value }))}
              />
            </label>
          ) : null}
          {provider.kind === "openai-compatible" ? (
            <ModelDetect
              baseURL={config.baseURL || provider.baseURL || ""}
              apiKey={apiKey}
              current={config.model}
              onPick={(m) => setConfig((c) => ({ ...c, model: m }))}
            />
          ) : null}
        </div>
      ) : null}

      <div className="ai-messages" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="ai-empty">
            Ask about your terminal — errors, commands, anything. The active
            tab's recent output goes along with your question.
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`ai-msg ai-${m.role}`}>
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          ))
        )}
      </div>

      <div className="ai-input">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={needsKey ? `Set a ${provider.label} key to start…` : "Ask huskv2…"}
          rows={2}
        />
        <button type="button" onClick={() => void send()} disabled={busy}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
