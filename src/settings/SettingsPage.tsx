import { useMemo, useState, type ReactNode } from "react";
import { PROVIDERS, getProvider } from "../ai/providers";
import { loadConfig, saveConfig, useKey, setKey, type StoredConfig } from "../ai/store";
import {
  loadMcpServers,
  addMcpServer,
  updateMcpServer,
  removeMcpServer,
  type McpServerConfig,
} from "../mcp/store";
import { McpMarketplaceDialog } from "../mcp/McpMarketplaceDialog";
import { usePrefs, setPrefs } from "./preferences";
import { TERMINAL_THEME_PRESETS, type TerminalThemePreset } from "../styles/terminalTheme";

const VERSION = "0.1.0";

type SectionId = "about" | "general" | "models" | "mcp";

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

function AboutSection() {
  return (
    <div>
      <SectionHeader title="Manifest" />
      <div className="settings-about">
        <img src="/logo.png" alt="huskv2" className="settings-logo" />
        <div>
          <div className="settings-about-name">huskv2</div>
          <div className="settings-about-ver">Version {VERSION}</div>
          <div className="settings-about-tag">A terminal with AI and a built-in editor.</div>
        </div>
      </div>
    </div>
  );
}

function GeneralSection() {
  const prefs = usePrefs();
  return (
    <div>
      <SectionHeader title="General" subtitle="Appearance" />
      <SettingRow title="Appearance" description="Light or dark mode (also in the title bar).">
        <select
          className="setting-select"
          value={prefs.theme}
          onChange={(e) => setPrefs({ theme: e.target.value as "dark" | "light" })}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </SettingRow>
      <SettingRow title="Terminal theme" description="Color preset for the terminal.">
        <select
          className="setting-select"
          value={prefs.terminalTheme}
          onChange={(e) => setPrefs({ terminalTheme: e.target.value as TerminalThemePreset })}
        >
          {Object.entries(TERMINAL_THEME_PRESETS).map(([id, t]) => (
            <option key={id} value={id}>
              {t.name}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow title="Terminal font size" description="Size of text in the terminal.">
        <select
          className="setting-select"
          value={prefs.terminalFontSize}
          onChange={(e) => setPrefs({ terminalFontSize: Number(e.target.value) })}
        >
          {[11, 12, 13, 14, 15, 16, 18].map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow title="Cursor blink" description="Blink the terminal cursor.">
        <input
          type="checkbox"
          className="setting-check"
          checked={prefs.cursorBlink}
          onChange={(e) => setPrefs({ cursorBlink: e.target.checked })}
        />
      </SettingRow>
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
