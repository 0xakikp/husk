import { useEffect, useState } from "react";
import { MODELS } from "../../ai/models";
import { CLI_SUBSCRIPTION_MODE, PROVIDERS, type Provider } from "../../ai/providers";
import { loadConfig, saveConfig, useKey, setKey } from "../../ai/store";
import { claudeCliAvailable } from "../../ai/claudeCli";
import { codexCliAvailable, codexCliModels, type CodexCliModel } from "../../ai/codexCli";
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

function maskKey(k: string): string {
  if (!k) return "";
  if (k.length <= 10) return "••••••••";
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}

/** This appears at the decision point, rather than expecting a person to
    infer the trade-off from the provider's technical configuration below. */
function SubscriptionModeNotice({ provider }: { provider: Provider }) {
  return (
    <aside className="settings-subscription-notice" role="note">
      <div className="settings-subscription-heading">
        <span className="settings-subscription-dot" aria-hidden="true">!</span>
        <div>
          <strong>{CLI_SUBSCRIPTION_MODE.title}</strong>
          <p>{provider.label}{" — "}{CLI_SUBSCRIPTION_MODE.summary}</p>
        </div>
      </div>
      <div className="settings-subscription-details">
        <p><span>Works</span>{CLI_SUBSCRIPTION_MODE.works}</p>
        <p><span>Unavailable</span>{CLI_SUBSCRIPTION_MODE.unavailable}</p>
      </div>
      <p className="settings-subscription-unlock">
        {CLI_SUBSCRIPTION_MODE.unlock}{" "}
        <button
          type="button"
          onClick={() => document.getElementById("api-provider-access")?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          [ set up API access ]
        </button>
      </p>
    </aside>
  );
}

/** One provider's config block with keychain-backed API key editing. */
function ProviderBlock({ provider }: { provider: Provider }) {
  const apiKey = useKey(provider.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  /* The CLI provider needs no key but is not therefore usable — it needs the
     binary. Reporting `configured = true` because it is keyless would promise a
     provider that cannot answer, which is what made the MCP marketplace worth
     deleting. */
  const isCli = provider.kind === "cli";
  const isCodexCli = provider.cli === "codex";
  const cliName = isCodexCli ? "Codex" : "Claude Code";
  const cliCommand = isCodexCli ? "codex" : "claude";
  const [cliReady, setCliReady] = useState(false);
  useEffect(() => {
    if (!isCli) return;
    void (isCodexCli ? codexCliAvailable() : claudeCliAvailable()).then(setCliReady);
  }, [isCli, isCodexCli]);

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
      <CfgSection name={`providers.${provider.id}`} />
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
              : isCodexCli
                ? "Not found. Install the codex CLI and sign in with your ChatGPT account, then reopen settings."
                : "Not found. Install the claude CLI and run `claude login`, then reopen settings."
          }
        >
          <CfgStr>{cliReady ? `${cliCommand} CLI detected` : `${cliCommand} CLI not on PATH`}</CfgStr>
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
            ? `Whether the ${cliCommand} CLI was found on PATH.`
            : "Whether a key is stored for this provider in your OS keychain."
        }
      >
        <CfgBool value={isCli ? cliReady : provider.keyless || !!apiKey} onChange={() => {}} />
      </CfgRow>
      {isCli ? (
        <CfgComment>Subscription mode is read-only. Its available and unavailable features are shown above when selected.</CfgComment>
      ) : null}
      <CfgBlank />
    </>
  );
}

export function ModelsFile() {
  const [config, setConfig] = useState(() => loadConfig());
  const [codexModels, setCodexModels] = useState<CodexCliModel[]>([]);
  const subscriptionProvider = PROVIDERS.find((provider) => provider.id === config.providerId && provider.kind === "cli");

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
      {subscriptionProvider ? <SubscriptionModeNotice provider={subscriptionProvider} /> : null}
      <CfgBlank />

      {PROVIDERS.filter((p) => p.kind === "cli").map((provider) => (
        <ProviderBlock key={provider.id} provider={provider} />
      ))}

      <div id="api-provider-access" className="settings-provider-anchor" aria-hidden="true" />
      {PROVIDERS.filter((p) => p.id !== "local" && p.kind !== "cli").map((provider) => (
        <ProviderBlock key={provider.id} provider={provider} />
      ))}

      <CfgSection name="providers.local" />
      <CfgComment>LM Studio, Ollama, or any OpenAI-compatible server. No key needed.</CfgComment>
      <CfgRow name="baseURL" comment="Endpoint for the local server, e.g. http://localhost:11434 for Ollama.">
        <CfgText
          value={config.baseURL}
          onChange={(baseURL) => updateConfig({ baseURL })}
          placeholder="http://localhost:1234/v1"
          widthCh={30}
        />
      </CfgRow>
      <CfgRow name="model" comment="Model sent with each request. Must match a model the provider actually serves.">
        <CfgText
          value={config.providerId === "local" ? config.model : ""}
          onChange={(model) => updateConfig({ model, providerId: "local" })}
          placeholder="model id"
          widthCh={22}
        />
      </CfgRow>
      <CfgBlank />
      <CfgComment>keys never leave the OS keychain; nothing is synced</CfgComment>
    </ConfigEditor>
  );
}
