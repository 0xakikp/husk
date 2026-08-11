import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { CLI_SUBSCRIPTION_MODE, PROVIDERS, getProvider, type Provider } from "./providers";
import { MODELS } from "./models";
import { loadConfig, saveConfig, useConfig, getKey } from "./store";
import { codexCliModels, type CodexCliModel } from "./codexCli";
import {
  CLI_PROVIDER_IDS,
  EMPTY_CLI_AVAILABILITY,
  cliAvailable,
  cliDisplayName,
  cliLoginHelp as cliLoginHelpText,
  type CliAvailability,
} from "./cliProvider";

/**
 * Switch provider and model from the chat itself.
 *
 * Attached to the footer's existing `provider · model · connected` line rather
 * than added as new chrome: that line already says what you are talking to, so
 * making it the control puts the switch exactly where you look to check. The
 * composer is dense enough that another button would cost more than it gives.
 *
 * Only providers you can actually use are listed — a configured key, or keyless
 * (local endpoints, and installed subscription CLIs). Offering a
 * provider that cannot answer is the mistake the MCP marketplace made.
 */
function cliReady(provider: Provider, availability: CliAvailability): boolean {
  return provider.cli ? availability[provider.cli] : false;
}

function cliLabel(provider: Provider): string {
  return provider.cli ? cliDisplayName(provider.cli) : "CLI";
}

function cliLoginHelp(provider: Provider): string {
  return provider.cli ? cliLoginHelpText(provider.cli) : "This CLI provider is unavailable.";
}

export function ModelSwitcher({ busy }: { busy?: boolean }) {
  const cfg = useConfig();
  const [open, setOpen] = useState(false);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [cliAvailability, setCliAvailability] = useState<CliAvailability>(EMPTY_CLI_AVAILABILITY);
  const [codexModels, setCodexModels] = useState<CodexCliModel[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);
  /* Room above the button, so the menu cannot be taller than the panel.
     .composer-dock-side sets overflow:hidden, and this menu opens upward from a
     footer inside it — so on a short dock the top would be silently clipped and
     providers would vanish off the top edge rather than scroll. */
  const [maxHeight, setMaxHeight] = useState(320);

  useEffect(() => {
    const refreshCliAvailability = (refresh = false) => {
      void Promise.all(CLI_PROVIDER_IDS.map((cli) => cliAvailable(cli, refresh))).then((results) => {
        setCliAvailability(Object.fromEntries(CLI_PROVIDER_IDS.map((cli, index) => [cli, results[index]])) as CliAvailability);
      });
    };
    refreshCliAvailability();
    void codexCliModels().then(setCodexModels);
    const onAvailabilityChanged = () => refreshCliAvailability();
    const onWindowFocus = () => refreshCliAvailability(true);
    window.addEventListener("husk-cli-availability-changed", onAvailabilityChanged);
    window.addEventListener("focus", onWindowFocus);
    return () => {
      window.removeEventListener("husk-cli-availability-changed", onAvailabilityChanged);
      window.removeEventListener("focus", onWindowFocus);
    };
  }, []);

  useEffect(() => {
    if (!open && !limitsOpen) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      // 16px clear of the panel's top edge so it never touches the header.
      setMaxHeight(Math.max(140, Math.min(320, rect.top - 16)));
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setLimitsOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      // Stops here: Escape would otherwise close the whole composer behind it.
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        setLimitsOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, limitsOpen]);

  const provider = getProvider(cfg.providerId);
  const usable = PROVIDERS.filter((p) => {
    if (p.kind === "cli") return cliReady(p, cliAvailability);
    return p.keyless || !!getKey(p.id);
  });

  const pick = (providerId: string, model: string) => {
    const p = getProvider(providerId);
    saveConfig({ ...loadConfig(), providerId, model, baseURL: p.baseURL ?? "" });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="model-switcher relative inline-flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          setLimitsOpen(false);
        }}
        title={`${provider.label} · ${cfg.model || provider.defaultModel} · ${busy ? "streaming" : "connected"} — change provider or model`}
        className="model-switcher-select inline-flex min-w-0 items-center gap-1 rounded px-1 -mx-1 transition-colors hover:text-foreground"
      >
        <span className={cn("wb-status-dot shrink-0", provider.kind === "cli" && "text-primary")}>●</span>
        <span className="model-switcher-full-label truncate">
          {provider.kind === "cli" ? cliLabel(provider).toLowerCase() : provider.label.toLowerCase()}
          {" · "}
          {(cfg.model || provider.defaultModel).toLowerCase()}
          {" · "}
          {busy ? "streaming" : "connected"}
        </span>
        <span className="model-switcher-compact-label" aria-hidden="true">
          {provider.kind === "cli" ? cliLabel(provider).toLowerCase() : provider.label.toLowerCase()}
        </span>
      </button>

      {/* A distinct button avoids nesting an interactive control inside the
          provider picker. It keeps the reminder compact but makes the actual
          trade-off available where people notice it: while composing. */}
      {provider.kind === "cli" && (
        <button
          type="button"
          onClick={() => {
            setLimitsOpen((v) => !v);
            setOpen(false);
          }}
          aria-expanded={limitsOpen}
        title="How your signed-in plan works in Husk"
          className="model-switcher-plan-info rounded bg-amber-500/10 px-1 text-[9px] text-amber-500/90 transition-colors hover:bg-amber-500/20"
        >
          <span className="model-switcher-plan-info-full">how it works</span>
          <span className="model-switcher-plan-info-compact" aria-hidden="true">i</span>
        </button>
      )}

      {open && (
        /* Upward: the footer sits at the bottom of the panel, so a downward menu
           would open off-screen. */
        <div
          className="model-switcher-menu absolute bottom-full left-0 z-50 mb-1.5 min-w-[240px] overflow-y-auto rounded-lg border border-border/60 bg-background/95 py-1 shadow-lg backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight }}
        >
          {usable.length === 0 ? (
            <p className="px-2.5 py-2 text-[10.5px] text-muted-foreground">
              No provider configured — add a key in Settings → Models.
            </p>
          ) : (
            usable.map((p) => {
              const models = p.cli === "codex"
                ? [
                    { id: p.defaultModel, label: "Codex default" },
                    ...codexModels.filter((model) => model.id !== p.defaultModel),
                  ]
                : MODELS.filter((model) => model.provider.id === p.id);
              return (
                <div key={p.id} className="py-0.5">
                  <div className="px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground/50 uppercase">
                    {p.kind === "cli" ? `${cliLabel(p)} · your subscription` : p.label}
                  </div>
                  {p.kind === "cli" && (
                    <p className="px-2.5 pb-1 text-[9.5px] leading-snug text-amber-500/80">
                      Same Husk action policy — the signed-in CLI proposes,
                      then Husk validates and runs enabled actions.
                    </p>
                  )}
                  {/* A provider with no registered models still needs to be
                      selectable — custom gateways carry user-typed model ids. */}
                  {(models.length > 0 ? models : [{ id: p.defaultModel, label: p.defaultModel }]).map((m) => {
                    const active = cfg.providerId === p.id && (cfg.model || p.defaultModel) === m.id;
                    return (
                      <button
                        key={`${p.id}:${m.id}`}
                        type="button"
                        onClick={() => pick(p.id, m.id)}
                        className={cn(
                          "flex w-full items-center gap-2 px-2.5 py-1 text-left text-[11.5px] transition-colors",
                          active ? "text-primary" : "text-foreground hover:bg-white/[0.05]",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">{m.label}</span>
                        {active ? <span className="shrink-0 text-[10px]">✓</span> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
          {PROVIDERS.filter((p) => p.kind === "cli" && !cliReady(p, cliAvailability)).map((p) => (
            /* Said plainly rather than showing a disabled row: the reason it is
               missing is actionable, and a greyed entry does not explain itself. */
            <p key={p.id} className="border-t border-border/40 px-2.5 py-1.5 text-[9.5px] leading-snug text-muted-foreground/70">
              {cliLoginHelp(p)}
            </p>
          ))}
        </div>
      )}

      {limitsOpen && provider.kind === "cli" && (
        <div
          role="status"
          className="model-switcher-limits absolute bottom-full left-0 z-50 mb-1.5 w-72 overflow-y-auto border border-border/60 bg-background/95 p-3 shadow-lg backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight }}
        >
          <p className="m-0 text-[11px] font-semibold text-foreground">{CLI_SUBSCRIPTION_MODE.title}</p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{CLI_SUBSCRIPTION_MODE.summary}</p>
          <p className="mt-2 text-[10px] leading-snug text-muted-foreground"><span className="text-foreground">You can: </span>{CLI_SUBSCRIPTION_MODE.works}</p>
          <p className="mt-1 text-[10px] leading-snug text-muted-foreground"><span className="text-foreground">Kept safe: </span>{CLI_SUBSCRIPTION_MODE.safety}</p>
          <p className="mt-2 text-[10px] leading-snug text-amber-500/90">{CLI_SUBSCRIPTION_MODE.apiNote}</p>
        </div>
      )}
    </div>
  );
}
