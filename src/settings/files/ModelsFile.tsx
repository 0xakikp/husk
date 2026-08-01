import { useState } from "react";
import { MODELS, getModel } from "../../ai/models";
import { PROVIDERS, type Provider } from "../../ai/providers";
import { loadConfig, saveConfig, useKey, setKey } from "../../ai/store";
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

/** One provider's config block with keychain-backed API key editing. */
function ProviderBlock({ provider }: { provider: Provider }) {
  const apiKey = useKey(provider.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

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
      {provider.keyless ? (
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
      <CfgRow name="configured" comment="Whether a key is stored for this provider in your OS keychain.">
        <CfgBool value={provider.keyless || !!apiKey} onChange={() => {}} />
      </CfgRow>
      <CfgBlank />
    </>
  );
}

export function ModelsFile() {
  const [config, setConfig] = useState(() => loadConfig());

  const updateConfig = (patch: Partial<ReturnType<typeof loadConfig>>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);
  };

  const modelOptions = MODELS.map((m) => ({
    value: m.id,
    label: `${m.label} · ${m.provider.label}`,
  }));

  return (
    <ConfigEditor>
      <CfgArt lines={BANNERS.models} />
      <CfgBlank />

      <CfgSection name="ai" />
      <CfgRow name="defaultModel" comment="Used by the composer, suggestions, and quick actions.">
        <CfgEnum
          value={config.model}
          options={modelOptions}
          onChange={(model) => updateConfig({ model, providerId: getModel(model).provider.id })}
        />
      </CfgRow>
      <CfgBlank />

      {PROVIDERS.filter((p) => p.id !== "local").map((provider) => (
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
