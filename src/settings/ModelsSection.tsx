import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Key01Icon,
  ArrowDown01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState } from "react";
import {
  getModel,
  modelsForProvider,
  needsKey,
} from "@/ai/models";
import {
  PROVIDERS,
  type Provider,
} from "@/ai/providers";
import {
  loadConfig,
  saveConfig,
  useKey,
  setKey,
  type StoredConfig,
} from "@/ai/store";
import { SectionHeader } from "./components/SectionHeader";
import { SettingRow } from "./components/SettingRow";
import { Label } from "./parts";

// ── Main Section ───────────────────────────────────────────────────────────

export function ModelsSection() {
  const [config, setConfig] = useState<StoredConfig>(() => loadConfig());

  const updateConfig = (patch: Partial<StoredConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    saveConfig(next);
  };

  // Cloud providers that need keys (excluding local)
  const cloudProviders = useMemo(
    () => PROVIDERS.filter((p) => needsKey(p) && p.id !== "local"),
    [],
  );

  return (
    <div className="flex flex-col gap-7">
      <SectionHeader
        title="Models"
        description="Choose your AI provider, configure API keys, and set up local models."
      />

      {/* ── Default model ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <Label>Default model</Label>
        <ModelDropdown
          value={config.model}
          onChange={(model) => updateConfig({ model })}
        />
      </div>

      {/* ── Cloud providers ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <Label>Cloud providers</Label>
          <span className="text-[10.5px] text-muted-foreground">
            API keys stored in your OS keychain
          </span>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
          {cloudProviders.map((p) => (
            <ProviderKeyCard
              key={p.id}
              provider={p}
            />
          ))}
        </div>
      </div>

      {/* ── Local models ─────────────────────────────────────────────── */}
      <LocalModelBlock
        config={config}
        onUpdate={updateConfig}
      />

      {/* ── Terminal AI features ─────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <Label>Terminal AI</Label>
        <SettingRow
          className="rounded-lg border border-border/40 bg-muted/20 py-2"
          title="Error assistance"
          description="When a command fails, offer an AI explanation of the error."
        >
          <Switch checked={false} onCheckedChange={() => {}} />
        </SettingRow>
        <SettingRow
          className="rounded-lg border border-border/40 bg-muted/20 py-2"
          title="Command suggestions"
          description="Suggest next commands based on terminal history."
        >
          <Switch checked={false} onCheckedChange={() => {}} />
        </SettingRow>
      </div>
    </div>
  );
}

// ── Model Dropdown ─────────────────────────────────────────────────────────

function ModelDropdown({
  value,
  onChange,
}: {
  value: string;
  onChange: (model: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = getModel(value);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 text-[12px] transition-colors hover:bg-muted/30"
      >
        <span className="flex items-center gap-2">
          <ProviderBadge provider={current.provider} />
          <span className="font-medium text-foreground">{current.label}</span>
          <span className="text-muted-foreground">· {current.description}</span>
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          size={12}
          className={cn("opacity-60 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute top-full z-50 mt-1 w-full rounded-lg border border-border/40 bg-popover shadow-lg">
            <div className="max-h-[320px] overflow-y-auto py-1">
              {PROVIDERS.map((p) => {
                const models = modelsForProvider(p.id);
                if (models.length === 0) return null;
                return (
                  <div key={p.id} className="px-1">
                    <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      <ProviderBadge provider={p} size={10} />
                      {p.label}
                    </div>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange(m.id);
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1.5 text-[12px] transition-colors hover:bg-accent/50",
                          m.id === value && "bg-accent/30",
                        )}
                      >
                        <span className="flex min-w-0 flex-1 flex-col items-start">
                          <span className="text-foreground">{m.label}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {m.description}
                            {m.contextWindow ? ` · ${m.contextWindow}` : ""}
                          </span>
                        </span>
                        {m.id === value && (
                          <HugeiconsIcon
                            icon={CheckmarkCircle02Icon}
                            size={14}
                            className="shrink-0 text-primary"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Provider Badge ─────────────────────────────────────────────────────────

function ProviderBadge({
  provider,
  size = 12,
}: {
  provider: Provider;
  size?: number;
}) {
  const colors: Record<string, string> = {
    anthropic: "bg-amber-500/15 text-amber-500",
    openai: "bg-emerald-500/15 text-emerald-500",
    google: "bg-blue-500/15 text-blue-500",
    groq: "bg-orange-500/15 text-orange-500",
    deepseek: "bg-sky-500/15 text-sky-500",
    openrouter: "bg-violet-500/15 text-violet-500",
    xai: "bg-rose-500/15 text-rose-500",
    mistral: "bg-cyan-500/15 text-cyan-500",
    moonshot: "bg-indigo-500/15 text-indigo-500",
    kimi: "bg-fuchsia-500/15 text-fuchsia-500",
    local: "bg-zinc-500/15 text-zinc-500",
  };
  const style = colors[provider.id] ?? colors.local;
  const initial = provider.label.charAt(0).toUpperCase();

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded font-bold",
        size <= 10 ? "size-3.5 text-[8px]" : "size-4 text-[9px]",
        style,
      )}
    >
      {initial}
    </span>
  );
}

// ── Provider Key Card ──────────────────────────────────────────────────────

function ProviderKeyCard({ provider }: { provider: Provider }) {
  const apiKey = useKey(provider.id);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const hasKey = !!apiKey;

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
    <div className="flex min-w-0 flex-col gap-2 overflow-hidden rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ProviderBadge provider={provider} />
          <span className="text-[12.5px] font-medium text-foreground">{provider.label}</span>
        </div>
        {hasKey && !editing ? (
          <span className="inline-flex items-center gap-1 text-[10px] text-emerald-500">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} />
            Ready
          </span>
        ) : null}
      </div>

      {editing ? (
        <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
          <Input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`${provider.label} API key`}
            className="h-8 text-[12px]"
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <Button size="sm" className="h-7 text-[11px]" onClick={save}>
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setEditing(false);
                setDraft("");
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : hasKey ? (
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[11px] text-muted-foreground">
            {maskKey(apiKey)}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setDraft(apiKey);
                setEditing(true);
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-[11px] text-destructive hover:text-destructive"
              onClick={clear}
            >
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-fit gap-1.5 text-[11px]"
          onClick={() => setEditing(true)}
        >
          <HugeiconsIcon icon={Key01Icon} size={12} />
          Add key
        </Button>
      )}
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••••••";
  return key.slice(0, 4) + "••••••••••••••••" + key.slice(-4);
}

// ── Local Model Block ──────────────────────────────────────────────────────

function LocalModelBlock({
  config,
  onUpdate,
}: {
  config: StoredConfig;
  onUpdate: (patch: Partial<StoredConfig>) => void;
}) {
  const [urlDraft, setUrlDraft] = useState(config.baseURL || "");
  const [modelDraft, setModelDraft] = useState(config.model || "");
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");

  const dirty =
    urlDraft.trim() !== (config.baseURL || "") ||
    modelDraft.trim() !== config.model;

  const save = () => {
    onUpdate({
      baseURL: urlDraft.trim() || undefined,
      model: modelDraft.trim(),
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <Label>Local — LM Studio / OpenAI-compatible</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Run any model on your machine. Enable the server in LM Studio → Developer tab, or use any OpenAI-compatible endpoint.
        </span>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-lg border border-border/40 bg-muted/20 px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Base URL</span>
          <Input
            value={urlDraft}
            onChange={(e) => setUrlDraft(e.target.value)}
            placeholder="http://localhost:1234/v1"
            spellCheck={false}
            className="h-8 font-mono text-[11.5px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">Model ID</span>
          <Input
            value={modelDraft}
            onChange={(e) => setModelDraft(e.target.value)}
            placeholder="e.g. llama-3.2-1b-instruct"
            spellCheck={false}
            className="h-8 text-[11.5px]"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-[11px]"
            disabled={!urlDraft.trim()}
            onClick={() => {
              setTestStatus("testing");
              fetch(urlDraft.trim().replace(/\/$/, "") + "/models", {
                method: "GET",
                headers: { "Content-Type": "application/json" },
              })
                .then((r) => setTestStatus(r.ok ? "ok" : "fail"))
                .catch(() => setTestStatus("fail"));
            }}
          >
            {testStatus === "testing" ? (
              <span className="inline-block size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
            ) : (
              "Test connection"
            )}
          </Button>
          {testStatus === "ok" && (
            <span className="text-[11px] text-emerald-500">Connected</span>
          )}
          {testStatus === "fail" && (
            <span className="text-[11px] text-destructive">Failed</span>
          )}
          {dirty && (
            <Button size="sm" className="h-7 text-[11px]" onClick={save}>
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
