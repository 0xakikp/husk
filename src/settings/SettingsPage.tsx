import { useMemo, useState, type ReactNode } from "react";
import { PROVIDERS, getProvider } from "../ai/providers";
import { ModelDetect } from "../ai/ModelDetect";
import { useAgents, upsertAgent, removeAgent, newAgentId, type Agent } from "../ai/agents";
import { loadConfig, saveConfig, useKey, setKey, type StoredConfig } from "../ai/store";
import {
  loadMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  type McpServerConfig,
} from "../mcp/store";
import { McpMarketplaceDialog } from "../mcp/McpMarketplaceDialog";
import { GeneralSection } from "./GeneralSection";
import { AboutSection } from "./AboutSection";

type SectionId = "about" | "general" | "models" | "agents" | "mcp";

const SECTIONS: { id: SectionId; label: string; keywords: string[] }[] = [
  { id: "about", label: "Manifest", keywords: ["about", "version", "build", "license"] },
  {
    id: "general",
    label: "General",
    keywords: ["terminal", "font", "size", "cursor", "blink", "appearance", "theme"],
  },
  {
    id: "models",
    label: "Models",
    keywords: ["model", "provider", "api", "key", "ai", "anthropic", "openai", "local"],
  },
  {
    id: "agents",
    label: "Agents",
    keywords: ["agent", "persona", "prompt", "system", "assistant"],
  },
  {
    id: "mcp",
    label: "MCP",
    keywords: ["mcp", "server", "tool", "context", "protocol", "external"],
  },
];

function scrollToSection(id: SectionId) {
  document
    .getElementById(`settings-section-${id}`)
    ?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState("");

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.filter(
      (s) => s.label.toLowerCase().includes(q) || s.keywords.some((k) => k.includes(q)),
    );
  }, [search]);
  const show = (id: SectionId) => visible.some((s) => s.id === id);

  return (
    <div className="settings-page">
      <div className="settings-nav">
        <div className="settings-tabs">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="settings-tab"
              onClick={() => scrollToSection(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          className="settings-search"
          placeholder="Find setting…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button type="button" className="ai-icon" onClick={onClose} aria-label="Close settings">
          ×
        </button>
      </div>

      <main className="settings-main">
        <div className="settings-content">
          {visible.length === 0 ? (
            <div className="settings-empty">No settings match “{search}”</div>
          ) : null}
          {show("about") ? (
            <div id="settings-section-about">
              <AboutSection />
            </div>
          ) : null}
          {show("general") ? (
            <>
              <SectionDivider />
              <div id="settings-section-general">
                <GeneralSection />
              </div>
            </>
          ) : null}
          {show("models") ? (
            <>
              <SectionDivider />
              <div id="settings-section-models">
                <ModelsSection />
              </div>
            </>
          ) : null}
          {show("agents") ? (
            <>
              <SectionDivider />
              <div id="settings-section-agents">
                <AgentsSection />
              </div>
            </>
          ) : null}
          {show("mcp") ? (
            <>
              <SectionDivider />
              <div id="settings-section-mcp">
                <McpSection />
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="settings-section-head">
      <h2>{title}</h2>
      {subtitle ? <p>{subtitle}</p> : null}
    </div>
  );
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-row">
      <div className="setting-row-meta">
        <span className="setting-row-title">{title}</span>
        {description ? <span className="setting-row-desc">{description}</span> : null}
      </div>
      <div className="setting-row-control">{children}</div>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="settings-divider">
      <div className="settings-divider-line" />
      <div className="settings-divider-dot" />
      <div className="settings-divider-line" />
    </div>
  );
}

function ModelsSection() {
  const [config, setConfig] = useState<StoredConfig>(() => loadConfig());
  const provider = getProvider(config.providerId);
  const apiKey = useKey(provider.id);

  const update = (patch: Partial<StoredConfig>) =>
    setConfig((c) => {
      const next = { ...c, ...patch };
      saveConfig(next);
      return next;
    });

  return (
    <div>
      <SectionHeader title="Models" subtitle="AI provider and credentials" />
      <SettingRow title="Provider" description="Which service powers the AI panel.">
        <select
          className="setting-select"
          value={config.providerId}
          onChange={(e) => {
            const p = getProvider(e.target.value);
            update({ providerId: e.target.value, model: p.defaultModel, baseURL: p.baseURL ?? "" });
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow title="Model" description="Model id (editable).">
        <input
          className="setting-input"
          value={config.model}
          onChange={(e) => update({ model: e.target.value })}
        />
      </SettingRow>
      {!provider.keyless ? (
        <SettingRow title={`${provider.label} API key`} description="Stored in your OS keychain.">
          <input
            type="password"
            className="setting-input"
            value={apiKey}
            placeholder="sk-…"
            onChange={(e) => setKey(provider.id, e.target.value)}
          />
        </SettingRow>
      ) : null}
      {provider.configurableBaseURL ? (
        <SettingRow title="Base URL" description="Endpoint for local / compatible providers.">
          <input
            className="setting-input"
            value={config.baseURL}
            placeholder="http://localhost:1234/v1"
            onChange={(e) => update({ baseURL: e.target.value })}
          />
        </SettingRow>
      ) : null}
      {provider.kind === "openai-compatible" ? (
        <SettingRow title="Available models" description="Detect models served by this endpoint.">
          <ModelDetect
            baseURL={config.baseURL || provider.baseURL || ""}
            apiKey={apiKey}
            current={config.model}
            onPick={(m) => update({ model: m })}
          />
        </SettingRow>
      ) : null}
    </div>
  );
}

function AgentsSection() {
  const agents = useAgents();
  const [editing, setEditing] = useState<Agent | null>(null);

  const save = () => {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name || !editing.systemPrompt.trim()) return;
    upsertAgent({
      id: editing.id,
      name,
      systemPrompt: editing.systemPrompt.trim(),
      model: editing.model?.trim() || undefined,
    });
    setEditing(null);
  };

  return (
    <div>
      <SectionHeader title="Agents" subtitle="Named assistant personas for the AI panel" />
      {agents.map((a) => (
        <SettingRow key={a.id} title={a.name} description={a.builtIn ? "Built-in preset" : "Custom"}>
          {a.builtIn ? (
            <span className="agent-tag">preset</span>
          ) : (
            <div className="agent-row-actions">
              <button type="button" onClick={() => setEditing(a)}>
                Edit
              </button>
              <button type="button" onClick={() => removeAgent(a.id)}>
                Delete
              </button>
            </div>
          )}
        </SettingRow>
      ))}
      {editing ? (
        <div className="agent-editor">
          <input
            className="setting-input"
            placeholder="Agent name"
            value={editing.name}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
          <input
            className="setting-input"
            placeholder="Model id override (optional)"
            value={editing.model ?? ""}
            onChange={(e) => setEditing({ ...editing, model: e.target.value })}
          />
          <textarea
            className="agent-prompt"
            placeholder="System prompt"
            rows={5}
            value={editing.systemPrompt}
            onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
          />
          <div className="agent-row-actions">
            <button type="button" onClick={save}>
              Save
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="settings-add"
          onClick={() => setEditing({ id: newAgentId(), name: "", systemPrompt: "", model: "" })}
        >
          + New agent
        </button>
      )}
    </div>
  );
}

function McpSection() {
  const [servers, setServers] = useState<McpServerConfig[]>(() => loadMcpServers());
  const [adding, setAdding] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("");

  const refresh = () => setServers(loadMcpServers());

  const add = () => {
    if (!name.trim() || !command.trim()) return;
    addMcpServer({
      name: name.trim(),
      command: command.trim(),
      args: argsText.trim() ? argsText.trim().split(/\s+/) : [],
      env: {},
      enabled: true,
    });
    setName("");
    setCommand("npx");
    setArgsText("");
    setAdding(false);
    refresh();
  };

  return (
    <div>
      <SectionHeader title="MCP" subtitle="Model Context Protocol servers — extra tools for the AI" />
      <div className="mcp-body">
        {servers.length === 0 && !adding ? (
          <p className="setting-row-desc">
            No servers yet. Add one (e.g. command <code>npx</code>, args{" "}
            <code>-y @modelcontextprotocol/server-filesystem ~/</code>) to give the AI extra
            tools.
          </p>
        ) : null}

        {servers.map((s) => (
          <div key={s.id} className="rb-item">
            <input
              type="checkbox"
              className="setting-check"
              checked={s.enabled}
              title="Enabled"
              onChange={(e) => {
                updateMcpServer(s.id, { enabled: e.target.checked });
                refresh();
              }}
            />
            <div className="rb-meta">
              <span className="rb-name">{s.name}</span>
              <span className="rb-steps">
                {s.command} {s.args.join(" ")}
              </span>
            </div>
            <button
              type="button"
              className="ai-icon"
              aria-label={`Remove ${s.name}`}
              onClick={() => {
                removeMcpServer(s.id);
                refresh();
              }}
            >
              🗑
            </button>
          </div>
        ))}

        {adding ? (
          <div className="mcp-add">
            <label className="rb-field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Filesystem" />
            </label>
            <label className="rb-field">
              <span>Command</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" />
            </label>
            <label className="rb-field">
              <span>Arguments</span>
              <input
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                placeholder="-y @modelcontextprotocol/server-filesystem ~/"
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
              <button type="button" className="primary" onClick={add}>
                Add server
              </button>
            </div>
          </div>
        ) : (
          <div className="mcp-actions">
            <button type="button" className="rb-new" onClick={() => setAdding(true)}>
              + Add server
            </button>
            <button type="button" className="rb-new" onClick={() => setBrowsing(true)}>
              Browse catalog
            </button>
          </div>
        )}
      </div>
      {browsing ? (
        <McpMarketplaceDialog onClose={() => setBrowsing(false)} onAdded={refresh} />
      ) : null}
    </div>
  );
}
