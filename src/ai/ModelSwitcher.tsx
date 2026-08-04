import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { PROVIDERS, getProvider } from "./providers";
import { MODELS } from "./models";
import { loadConfig, saveConfig, useConfig, getKey } from "./store";
import { claudeCliAvailable } from "./claudeCli";

/**
 * Switch provider and model from the chat itself.
 *
 * Attached to the footer's existing `provider · model · connected` line rather
 * than added as new chrome: that line already says what you are talking to, so
 * making it the control puts the switch exactly where you look to check. The
 * composer is dense enough that another button would cost more than it gives.
 *
 * Only providers you can actually use are listed — a configured key, or keyless
 * (local endpoints, and the Claude Code CLI when it is installed). Offering a
 * provider that cannot answer is the mistake the MCP marketplace made.
 */
/** What CLI mode cannot do, in the order people notice it. */
const CLI_LIMITS =
  "Claude Code mode is read-only: it can read and search your code, but cannot stage file edits for review, and Husk's MCP servers are not available (the CLI loads its own). Switch to an API provider for those.";

export function ModelSwitcher({ busy }: { busy?: boolean }) {
  const cfg = useConfig();
  const [open, setOpen] = useState(false);
  const [cliReady, setCliReady] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  /* Room above the button, so the menu cannot be taller than the panel.
     .composer-dock-side sets overflow:hidden, and this menu opens upward from a
     footer inside it — so on a short dock the top would be silently clipped and
     providers would vanish off the top edge rather than scroll. */
  const [maxHeight, setMaxHeight] = useState(320);

  useEffect(() => {
    void claudeCliAvailable().then(setCliReady);
  }, []);

  useEffect(() => {
    if (!open) return;
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      // 16px clear of the panel's top edge so it never touches the header.
      setMaxHeight(Math.max(140, Math.min(320, rect.top - 16)));
    }
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      // Stops here: Escape would otherwise close the whole composer behind it.
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const provider = getProvider(cfg.providerId);
  const usable = PROVIDERS.filter((p) => {
    if (p.kind === "cli") return cliReady;
    return p.keyless || !!getKey(p.id);
  });

  const pick = (providerId: string, model: string) => {
    const p = getProvider(providerId);
    saveConfig({ ...loadConfig(), providerId, model, baseURL: p.baseURL ?? "" });
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Change provider or model"
        className="inline-flex items-center gap-1 rounded px-1 -mx-1 transition-colors hover:text-foreground"
      >
        <span className={cn("wb-status-dot", provider.kind === "cli" && "text-primary")}>●</span>
        {provider.kind === "cli" ? "claude code" : provider.label.toLowerCase()}
        {" · "}
        {(cfg.model || provider.defaultModel).toLowerCase()}
        {" · "}
        {busy ? "streaming" : "connected"}
        {/* Stated in the status line, because the degradation is otherwise
            invisible: the model was never given Husk's tools, so it cannot fail
            to use them — it just answers in prose and never stages an edit, with
            nothing on screen to say why. */}
        {provider.kind === "cli" && (
          <span
            className="rounded bg-amber-500/10 px-1 text-[9px] text-amber-500/90"
            title={CLI_LIMITS}
          >
            read-only
          </span>
        )}
      </button>

      {open && (
        /* Upward: the footer sits at the bottom of the panel, so a downward menu
           would open off-screen. */
        <div
          className="absolute bottom-full left-0 z-50 mb-1.5 min-w-[240px] overflow-y-auto rounded-lg border border-border/60 bg-background/95 py-1 shadow-lg backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ maxHeight }}
        >
          {usable.length === 0 ? (
            <p className="px-2.5 py-2 text-[10.5px] text-muted-foreground">
              No provider configured — add a key in Settings → Models.
            </p>
          ) : (
            usable.map((p) => {
              const models = MODELS.filter((m) => m.provider.id === p.id);
              return (
                <div key={p.id} className="py-0.5">
                  <div className="px-2.5 py-1 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground/50 uppercase">
                    {p.kind === "cli" ? "Claude Code · your subscription" : p.label}
                  </div>
                  {p.kind === "cli" && (
                    <p className="px-2.5 pb-1 text-[9.5px] leading-snug text-amber-500/80">
                      Read-only: no staged file edits, and Husk's MCP servers are
                      not available in this mode.
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
          {!cliReady && (
            /* Said plainly rather than showing a disabled row: the reason it is
               missing is actionable, and a greyed entry does not explain itself. */
            <p className="border-t border-border/40 px-2.5 py-1.5 text-[9.5px] leading-snug text-muted-foreground/70">
              Install the <span className="font-mono">claude</span> CLI and run{" "}
              <span className="font-mono">claude login</span> to use your Claude subscription
              without an API key.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
