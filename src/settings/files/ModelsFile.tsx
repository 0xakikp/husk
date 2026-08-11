import { useEffect, useState } from "react";
import { MODELS } from "../../ai/models";
import { CLI_SUBSCRIPTION_MODE, PROVIDERS, type Provider } from "../../ai/providers";
import { loadConfig, saveConfig, useKey, setKey } from "../../ai/store";
import { codexCliModels, type CodexCliModel } from "../../ai/codexCli";
import { cliAvailable, cliCommand, cliDisplayName, cliLoginHelp } from "../../ai/cliProvider";
import {
  ConfigEditor,
  CfgArt,
  CfgAct,
  CfgBlank,
  CfgBool,
  CfgComment,
  CfgEnum,
  CfgRow,
  CfgSection,
  CfgStr,
  CfgText,
} from "../config/controls";
import { BANNERS } from "../config/banners";

type ModelsView = { kind: "overview" } | { kind: "provider"; id: string };

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 10) return "••••••••";
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

/** This appears at the decision point, rather than expecting a person to
    infer the trade-off from the provider's technical configuration below. */
function SubscriptionModeNotice({ provider }: { provider: Provider }) {
  const providerName = provider.label.replace(/\s*\(my subscription\)\s*$/i, "");
  return (
    <aside className="settings-subscription-notice" role="note">
      <div className="settings-subscription-heading">
        <span className="settings-subscription-dot" aria-hidden="true">!</span>
        <div>
          <strong>Using your {providerName} subscription</strong>
          <p>{CLI_SUBSCRIPTION_MODE.summary}</p>
        </div>
      </div>
      <div className="settings-subscription-details">
        <p><strong>You can:</strong> {CLI_SUBSCRIPTION_MODE.works}</p>
        <p><strong>Kept safe:</strong> {CLI_SUBSCRIPTION_MODE.safety}</p>
      </div>
      <p className="settings-subscription-unlock">
        {CLI_SUBSCRIPTION_MODE.apiNote}{" "}
        <button
          type="button"
          onClick={() => document.getElementById("api-provider-access")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          [ choose an API provider ]
        </button>
      </p>
    </aside>
  );
}

/** One provider's inspector content with keychain-backed API key editing. */
function ProviderBlock({ provider }: { provider: Provider }) {
  const apiKey = useKey(provider.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  /* The CLI provider needs no key but is not therefore usable — it needs the
     binary. Reporting `configured = true` because it is keyless would promise a
     provider that cannot answer, which is what made the MCP marketplace worth
     deleting. */
  const isCli = provider.kind === "cli";
  const cli = provider.cli;
  const cliName = cli ? cliDisplayName(cli) : "CLI";
  const command = cli ? cliCommand(cli) : "cli";
  const [cliReady, setCliReady] = useState(false);
  const [checkingCli, setCheckingCli] = useState(false);
  useEffect(() => {
    if (!isCli || !cli) return;
    void cliAvailable(cli).then(setCliReady);
  }, [isCli, cli]);

  const refreshCli = () => {
    if (!isCli || !cli) return;
    setCheckingCli(true);
    void cliAvailable(cli, true)
      .then((ready) => {
        setCliReady(ready);
        window.dispatchEvent(new Event("husk-cli-availability-changed"));
      })
      .finally(() => setCheckingCli(false));
  };

  const startEdit = () => {
    setDraft(apiKey || "");
    setEditing(true);
  };
  const save = () => {
    const v = draft.trim();
    if (v) setKey(provider.id, v);
    setEditing(false);
    setDraft("");
  };
  const clear = () => {
    setKey(provider.id, "");
    setEditing(false);
    setDraft("");
  };

  return (
    <>
      <CfgRow name="label" comment="Display name for this provider in the model picker.">
        <CfgStr>{provider.label}</CfgStr>
      </CfgRow>
      {provider.baseURL ? (
        <CfgRow name="baseURL" comment="Override the API endpoint. Leave empty unless using a proxy or self-hosted gateway.">
          <CfgStr>{provider.baseURL}</CfgStr>
        </CfgRow>
      ) : null}
      {isCli ? (
        <CfgRow
          name="login"
          comment={
            cliReady
              ? `Uses the ${cliName} CLI you are already signed into. No API key; usage draws on that account instead of per-token billing.`
              : cli ? `Not found. ${cliLoginHelp(cli)} Then press refresh.` : "This CLI provider is not configured correctly."
          }
        >
          <CfgStr>{cliReady ? `${command} CLI detected` : `${command} CLI not on PATH`}</CfgStr>
          <CfgAct onClick={refreshCli}>{checkingCli ? "checking…" : "refresh"}</CfgAct>
        </CfgRow>
      ) : provider.keyless ? (
        <CfgRow name="keyless" comment="This provider needs no API key.">
          <CfgBool value={true} onChange={() => {}} />
        </CfgRow>
      ) : editing ? (
        <>
          <CfgRow name="apiKey" comment="Stored in your OS keychain.">
            <CfgText secret value={draft} onChange={setDraft} placeholder={`${provider.label} API key`} widthCh={34} />
          </CfgRow>
          <CfgRow>
            <CfgAct onClick={save}>save</CfgAct>
            <CfgAct onClick={() => { setEditing(false); setDraft(""); }}>cancel</CfgAct>
            {apiKey ? <CfgAct onClick={clear} danger>clear</CfgAct> : null}
          </CfgRow>
        </>
      ) : (
        <CfgRow name="apiKey" comment={apiKey ? "Stored in your OS keychain." : "No key set."}>
          <CfgStr>{apiKey ? maskKey(apiKey) : ""}</CfgStr>
          <CfgAct onClick={startEdit}>{apiKey ? "edit" : "add key"}</CfgAct>
        </CfgRow>
      )}
      <CfgRow
        name="configured"
        comment={
          isCli
            ? `Whether the ${command} CLI was found on PATH.`
            : "Whether a key is stored for this provider in your OS keychain."
        }
      >
        <CfgBool value={isCli ? cliReady : provider.keyless || !!apiKey} onChange={() => {}} />
      </CfgRow>
      {isCli ? (
        <CfgComment>Signed-in CLI models propose actions; Husk validates and runs enabled workspace and integration actions under the same review rules as API models.</CfgComment>
      ) : null}
    </>
  );
}

function useProviderAvailability(provider: Provider) {
  const apiKey = useKey(provider.id);
  const isCli = provider.kind === "cli";
  const cli = provider.cli;
  const command = cli ? cliCommand(cli) : "cli";
  const [cliReady, setCliReady] = useState(false);

  useEffect(() => {
    if (!isCli || !cli) return;
    void cliAvailable(cli).then(setCliReady);
  }, [isCli, cli]);

  if (isCli) {
    return {
      ready: cliReady,
      state: cliReady ? `${command} CLI detected` : `${command} CLI not found`,
    };
  }
  if (provider.id === "local") return { ready: true, state: "local endpoint" };
  if (provider.keyless) return { ready: true, state: "ready" };
  return { ready: !!apiKey, state: apiKey ? "API key configured" : "API key needed" };
}

function ModelProviderCard({
  provider,
  active,
  onOpen,
}: {
  provider: Provider;
  active: boolean;
  onOpen: () => void;
}) {
  const availability = useProviderAvailability(provider);
  const detail = provider.kind === "cli"
    ? "Uses your signed-in subscription"
    : provider.id === "local"
      ? "LM Studio, Ollama, or compatible server"
      : provider.baseURL ?? "API-key model access";

  return (
    <button
      type="button"
      className={`model-provider-card ${active ? "is-active" : ""}`}
      onClick={onOpen}
    >
      <span className={`model-provider-dot ${availability.ready ? "is-ready" : ""}`} aria-hidden="true" />
      <span className="model-provider-copy">
        <strong>{provider.label}</strong>
        <small>{detail}</small>
        <em className={availability.ready ? "is-ready" : ""}>{availability.state}</em>
      </span>
      {active ? <span className="model-provider-active">default</span> : null}
      <span className="model-provider-chevron" aria-hidden="true">›</span>
    </button>
  );
}

function ProviderDirectory({
  config,
  onOpen,
}: {
  config: ReturnType<typeof loadConfig>;
  onOpen: (id: string) => void;
}) {
  const cliProviders = PROVIDERS.filter((provider) => provider.kind === "cli");
  const apiProviders = PROVIDERS.filter((provider) => provider.kind !== "cli");

  return (
    <>
      <CfgSection name="providers" />
      <section className="model-provider-directory" aria-label="AI providers">
        <div className="model-provider-directory-head">
          <div>
            <p>Provider access <span>{PROVIDERS.length}</span></p>
            <small>Open a provider to manage its connection and credentials.</small>
          </div>
        </div>

        <div className="model-provider-group">
          <p className="model-provider-group-label">Subscription / CLI</p>
          <div className="model-provider-grid">
            {cliProviders.map((provider) => (
              <ModelProviderCard
                key={provider.id}
                provider={provider}
                active={config.providerId === provider.id}
                onOpen={() => onOpen(provider.id)}
              />
            ))}
          </div>
        </div>

        <div id="api-provider-access" className="settings-provider-anchor" aria-hidden="true" />
        <div className="model-provider-group">
          <p className="model-provider-group-label">API and local</p>
          <div className="model-provider-grid">
            {apiProviders.map((provider) => (
              <ModelProviderCard
                key={provider.id}
                provider={provider}
                active={config.providerId === provider.id}
                onOpen={() => onOpen(provider.id)}
              />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function LocalProviderBlock({
  config,
  onUpdate,
}: {
  config: ReturnType<typeof loadConfig>;
  onUpdate: (patch: Partial<ReturnType<typeof loadConfig>>) => void;
}) {
  return (
    <>
      <CfgComment>LM Studio, Ollama, or any OpenAI-compatible server. No key needed.</CfgComment>
      <CfgRow name="baseURL" comment="Endpoint for the local server, e.g. http://localhost:11434 for Ollama.">
        <CfgText
          value={config.baseURL}
          onChange={(baseURL) => onUpdate({ baseURL })}
          placeholder="http://localhost:1234/v1"
          widthCh={30}
        />
      </CfgRow>
      <CfgRow name="model" comment="Model sent with each request. Must match a model the provider actually serves.">
        <CfgText
          value={config.providerId === "local" ? config.model : ""}
          onChange={(model) => onUpdate({ model, providerId: "local" })}
          placeholder="model id"
          widthCh={22}
        />
      </CfgRow>
    </>
  );
}

function ModelProviderInspector({
  provider,
  config,
  onUpdate,
  onBack,
}: {
  provider: Provider;
  config: ReturnType<typeof loadConfig>;
  onUpdate: (patch: Partial<ReturnType<typeof loadConfig>>) => void;
  onBack: () => void;
}) {
  return (
    <section className="model-provider-inspector" aria-label={`${provider.label} provider settings`}>
      <header className="model-provider-inspector-head">
        <button type="button" onClick={onBack}>← all providers</button>
        <div>
          <h2>{provider.label}</h2>
          <p>{provider.kind === "cli" ? "Subscription CLI connection" : provider.id === "local" ? "Local model connection" : "API provider connection"}</p>
        </div>
      </header>
      <CfgSection name="connection" />
      {provider.id === "local" ? (
        <LocalProviderBlock config={config} onUpdate={onUpdate} />
      ) : (
        <ProviderBlock provider={provider} />
      )}
    </section>
  );
}

export function ModelsFile() {
  const [config, setConfig] = useState(() => loadConfig());
  const [codexModels, setCodexModels] = useState<CodexCliModel[]>([]);
  const [view, setView] = useState<ModelsView>({ kind: "overview" });
  const subscriptionProvider = PROVIDERS.find((provider) => provider.id === config.providerId && provider.kind === "cli");
  const selectedProvider = view.kind === "provider"
    ? PROVIDERS.find((provider) => provider.id === view.id) ?? null
    : null;

  useEffect(() => {
    void codexCliModels().then(setCodexModels);
  }, []);

  const updateConfig = (patch: Partial<ReturnType<typeof loadConfig>>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);
  };

  const modelOptions = [
    ...MODELS.map((model) => ({
      value: model.id,
      label: `${model.label} · ${model.provider.label}`,
      providerId: model.provider.id,
    })),
    // Keep a stable escape hatch when Codex has not created its local cache
    // yet, and let the CLI choose the account's default model.
    { value: "codex", label: "Codex default · Codex (my subscription)", providerId: "codex" },
    ...codexModels.map((model) => ({
      value: model.id,
      label: `${model.label} · Codex (my subscription)`,
      providerId: "codex",
    })),
  ];

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.models} />
      <CfgBlank />

      {view.kind === "overview" ? (
        <>
          <CfgSection name="ai" />
          <CfgRow name="defaultModel" comment="Used by the composer, suggestions, and quick actions.">
            <CfgEnum
              value={config.model}
              options={modelOptions}
              onChange={(model) => {
                const option = modelOptions.find((item) => item.value === model);
                if (option) updateConfig({ model, providerId: option.providerId });
              }}
            />
          </CfgRow>
          <CfgComment>An agent can optionally override this model in Settings → Agents. Leave its model blank to use this default.</CfgComment>
          {subscriptionProvider ? <SubscriptionModeNotice provider={subscriptionProvider} /> : null}
          <CfgBlank />
          <ProviderDirectory config={config} onOpen={(id) => setView({ kind: "provider", id })} />
          <CfgComment>Keys never leave the OS keychain; nothing is synced.</CfgComment>
        </>
      ) : selectedProvider ? (
        <ModelProviderInspector
          provider={selectedProvider}
          config={config}
          onUpdate={updateConfig}
          onBack={() => setView({ kind: "overview" })}
        />
      ) : (
        <CfgRow><CfgAct onClick={() => setView({ kind: "overview" })}>back to providers</CfgAct></CfgRow>
      )}
    </ConfigEditor>
  );
}
