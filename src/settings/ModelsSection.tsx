import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Key01Icon,
  ArrowDown01Icon,
  ViewIcon,
  ViewOffIcon,
  Delete02Icon,
  PencilEdit01Icon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMemo, useState, useRef } from "react";
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
import { Label } from "./parts";

// ── Provider Logo Components ───────────────────────────────────────────────

function AnthropicLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.304 3.541h-3.671l6.696 16.918h3.672L17.304 3.541zm-10.608 0L0 20.459h3.744l1.369-3.6h6.737l1.369 3.6h3.744L10.696 3.541H6.696zm-1.544 10.2l2.288-6.012 2.288 6.012H5.152z" />
    </svg>
  );
}

function OpenAILogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.484 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 3.998A6.046 6.046 0 0 0 2.89 14.59a6.065 6.065 0 0 0 4.457 10.005 5.985 5.985 0 0 0 4.484.516 6.046 6.046 0 0 0 6.51 2.9 6.065 6.065 0 0 0 10.275-4.744 5.985 5.985 0 0 0 3.998-3.998 6.046 6.046 0 0 0-2.9-6.51 5.985 5.985 0 0 0-4.433-.936zM13.13 20.87a4.065 4.065 0 0 1-5.478-1.767 3.984 3.984 0 0 1-.516-2.984 3.984 3.984 0 0 1 1.767-5.478 4.065 4.065 0 0 1 5.478 1.767 3.984 3.984 0 0 1 .516 2.984 3.984 3.984 0 0 1-1.767 5.478z" />
    </svg>
  );
}

function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}

function GroqLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-2h2v2zm0-4h-2V7h2v6zm4 4h-2v-2h2v2zm0-4h-2V7h2v6z" />
    </svg>
  );
}

function DeepSeekLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
    </svg>
  );
}

function OpenRouterLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v6m0 6v6m11-7h-6m-6 0H1" />
    </svg>
  );
}

function XAILogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function MistralLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2L2 22h20L12 2zm0 4l6.5 14h-13L12 6z" />
    </svg>
  );
}

function MoonshotLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z" />
      <path d="M12 6a6 6 0 0 0 0 12 6 6 0 0 0 0-12z" opacity="0.5" />
    </svg>
  );
}

function KimiLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

const LOGO_COMPONENTS: Record<string, React.FC<{ className?: string }>> = {
  anthropic: AnthropicLogo,
  openai: OpenAILogo,
  google: GoogleLogo,
  groq: GroqLogo,
  deepseek: DeepSeekLogo,
  openrouter: OpenRouterLogo,
  xai: XAILogo,
  mistral: MistralLogo,
  moonshot: MoonshotLogo,
  kimi: KimiLogo,
};

// ── Provider Colors ────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  anthropic: { bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/30" },
  openai: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/30" },
  google: { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/30" },
  groq: { bg: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/30" },
  deepseek: { bg: "bg-sky-500/10", text: "text-sky-500", border: "border-sky-500/30" },
  openrouter: { bg: "bg-violet-500/10", text: "text-violet-500", border: "border-violet-500/30" },
  xai: { bg: "bg-rose-500/10", text: "text-rose-500", border: "border-rose-500/30" },
  mistral: { bg: "bg-cyan-500/10", text: "text-cyan-500", border: "border-cyan-500/30" },
  moonshot: { bg: "bg-indigo-500/10", text: "text-indigo-500", border: "border-indigo-500/30" },
  kimi: { bg: "bg-fuchsia-500/10", text: "text-fuchsia-500", border: "border-fuchsia-500/30" },
  local: { bg: "bg-zinc-500/10", text: "text-zinc-500", border: "border-zinc-500/30" },
};

// ── Categories ─────────────────────────────────────────────────────────────

const CATEGORIES: { id: string; label: string; providers: string[] }[] = [
  {
    id: "cloud",
    label: "Cloud LLMs",
    providers: ["anthropic", "openai", "google", "xai", "mistral"],
  },
  {
    id: "fast",
    label: "Fast Inference",
    providers: ["groq", "deepseek", "moonshot", "kimi"],
  },
  {
    id: "aggregator",
    label: "Aggregators",
    providers: ["openrouter"],
  },
];

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

  const configuredCount = cloudProviders.filter((p) => {
    const key = useKey(p.id);
    return !!key;
  }).length;

  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        title="Models"
        description="Choose your AI provider, configure API keys, and set up local models."
      />

      {/* ── Default model ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2">
        <Label>Default model</Label>
        <ModelDropdown
          value={config.model}
          onChange={(model, providerId) => updateConfig({ model, providerId })}
        />
      </div>

      {/* ── Cloud providers ──────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <Label>Cloud providers</Label>
            <span className="text-[10.5px] text-muted-foreground">
              API keys stored in your OS keychain
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {configuredCount} of {cloudProviders.length} configured
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${(configuredCount / cloudProviders.length) * 100}%` }}
              />
            </div>
          </div>
        </div>

        {CATEGORIES.map((cat) => {
          const catProviders = cloudProviders.filter((p) =>
            cat.providers.includes(p.id as typeof cat.providers[number]),
          );
          if (catProviders.length === 0) return null;

          return (
            <div key={cat.id} className="flex flex-col gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {cat.label}
              </span>
              <div className="grid min-w-0 grid-cols-2 gap-2">
                {catProviders.map((p) => (
                  <ProviderKeyCard key={p.id} provider={p as Provider} />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Local models ─────────────────────────────────────────────── */}
      <div className="pt-4">
        <LocalModelBlock
          config={config}
          onUpdate={updateConfig}
        />
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
  onChange: (model: string, providerId: string) => void;
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
          <ProviderLogo provider={current.provider} />
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
                      <ProviderLogo provider={p} size={14} />
                      {p.label}
                    </div>
                    {models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onChange(m.id, p.id);
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

// ── Provider Logo ──────────────────────────────────────────────────────────

function ProviderLogo({
  provider,
  size = 14,
}: {
  provider: Provider;
  size?: number;
}) {
  const colors = PROVIDER_COLORS[provider.id] ?? PROVIDER_COLORS.local;
  const Logo = LOGO_COMPONENTS[provider.id];

  return (
    <span
      className={cn(
        "inline-flex items-center justify-center rounded-md",
        size <= 14 ? "size-4" : "size-5",
        colors.bg,
        colors.text,
      )}
    >
      {Logo ? <Logo className={size <= 14 ? "size-2.5" : "size-3"} /> : (
        <span className="text-[7px] font-bold">{provider.label.charAt(0).toUpperCase()}</span>
      )}
    </span>
  );
}

// ── Provider Key Card ──────────────────────────────────────────────────────

function ProviderKeyCard({ provider }: { provider: Provider }) {
  const apiKey = useKey(provider.id);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
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

  const startEdit = () => {
    setDraft(apiKey || "");
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  return (
    <div
      className={cn(
        "group relative flex min-w-0 flex-col gap-1.5 overflow-hidden rounded-lg border border-border/40 bg-muted/20 px-3 py-2 transition-all",
        "hover:border-border/60",
        hasKey && "ring-1 ring-inset ring-emerald-500/20",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ProviderLogo provider={provider} />
          <span className="text-[12px] font-medium text-foreground">{provider.label}</span>
        </div>
        {hasKey && !editing ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={9} />
            Configured
          </span>
        ) : null}
      </div>

      {/* Body */}
      {editing ? (
        <div className="flex min-w-0 flex-col gap-1.5 overflow-hidden">
          <div className="relative">
            <Input
              ref={inputRef}
              type={revealed ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={`${provider.label} API key`}
              className="h-7 pr-8 text-[11px]"
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft("");
                }
              }}
            />
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon
                icon={revealed ? ViewOffIcon : ViewIcon}
                size={12}
              />
            </button>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" className="h-6 px-2 text-[10px]" onClick={save}>
              <HugeiconsIcon icon={ShieldKeyIcon} size={10} className="mr-1" />
              Save
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px]"
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
          <div className="group/key relative flex items-center gap-1">
            <span className="font-mono text-[10px] text-muted-foreground">
              {maskKey(apiKey)}
            </span>
            <button
              type="button"
              onClick={() => setRevealed((r) => !r)}
              className="opacity-0 transition-opacity group-hover/key:opacity-100 text-muted-foreground hover:text-foreground"
            >
              <HugeiconsIcon
                icon={revealed ? ViewOffIcon : ViewIcon}
                size={10}
              />
            </button>
            {revealed && (
              <span className="font-mono text-[10px] text-foreground">
                {apiKey}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={startEdit}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={10} className="mr-0.5" />
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px] text-destructive hover:text-destructive"
              onClick={clear}
            >
              <HugeiconsIcon icon={Delete02Icon} size={10} className="mr-0.5" />
              Clear
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-fit gap-1 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => setEditing(true)}
        >
          <HugeiconsIcon icon={Key01Icon} size={10} />
          Add key
        </Button>
      )}
    </div>
  );
}

function maskKey(key: string): string {
  if (key.length <= 12) return "••••••••••••";
  return key.slice(0, 3) + "•••••••••••••••••" + key.slice(-4);
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
        <Label>Self-hosted AI</Label>
        <span className="text-[10.5px] leading-relaxed text-muted-foreground">
          Connect to a model running on your own machine or network. Works with LM Studio, Ollama, or any OpenAI-compatible API server.
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
