import { useCallback, useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";
import { InformationCircleIcon, PlusSignIcon, AlertCircleIcon, PuzzleIcon, SecurityCheckIcon, ComputerTerminal02Icon, CodeIcon } from "@hugeicons/core-free-icons";
import { usePrefs, setPrefs } from "../settings/preferences";
import { loadPlugins, type LoadedPlugin } from "../plugins/loader";
import { PluginPanel } from "../plugins/PluginPanel";
import type { Plugin } from "../plugins/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  SiKubernetes,
  SiDocker,
  SiTerraform,
  SiTailscale,
  SiGithubactions,
} from "@icons-pack/react-simple-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SidebarViewId } from "../sidebar/SidebarRail";
import { PanelHeader } from "../shell/PanelHeader";
import { PortsView } from "../ports/PortsView";
import { DevToolsView } from "../dev-tools/DevToolsView";

/**
 * Real brand marks, from simple-icons via @icons-pack/react-simple-icons —
 * the official paths rather than a generic glyph standing in for each tool
 * (Kubernetes and Terraform were both showing the same database icon).
 *
 * SVG rather than PNG on purpose: these render at 15px in a sidebar, where a
 * raster would soften on a HiDPI display and be stuck at one colour. Paths stay
 * sharp at any size and take `brand` below as their fill.
 */
type ToolCard = {
  id: SidebarViewId;
  name: string;
  description: string;
  Icon: typeof SiKubernetes;
  /** Official brand colour, also tinting the icon tile behind it. */
  brand: string;
  status: "ready" | "coming-soon";
};

const TOOLS: ToolCard[] = [
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Switch contexts, view pods, and stream logs",
    Icon: SiKubernetes,
    brand: "#326CE5",
    status: "ready",
  },
  {
    id: "ci-cd",
    name: "CI / CD",
    description: "Monitor GitHub Actions and GitLab pipelines",
    Icon: SiGithubactions,
    brand: "#2088FF",
    status: "ready",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Manage containers and images",
    Icon: SiDocker,
    brand: "#2496ED",
    status: "ready",
  },
  {
    id: "terraform",
    name: "Terraform",
    description: "View workspaces, state, and resources",
    Icon: SiTerraform,
    brand: "#844FBA",
    status: "ready",
  },
  {
    id: "tailscale",
    name: "Tailscale",
    /* Tailscale's mark is monochrome black-on-white, which disappears on a dark
       sidebar, so it follows the theme's foreground instead of its brand hex. */
    description: "List tailnet devices and connect via SSH",
    Icon: SiTailscale,
    brand: "currentColor",
    status: "ready",
  },
];

type Props = {
  onSelectView: (view: SidebarViewId) => void;
  onTypeCommand: (cmd: string) => void;
  onRunCommand: (cmd: string) => void;
  onOpenTotp: () => void;
  onOpenBrowser: (url: string) => void;
};

export function ToolsHubView({ onSelectView, onTypeCommand, onRunCommand, onOpenTotp, onOpenBrowser }: Props) {
  const dir = usePrefs().pluginsDir;
  const [loaded, setLoaded] = useState<LoadedPlugin[]>([]);
  const [active, setActive] = useState<Plugin | null>(null);
  const [utility, setUtility] = useState<"ports" | "dev-tools" | null>(null);

  const reload = useCallback(() => {
    void loadPlugins(dir).then(setLoaded);
  }, [dir]);
  useEffect(reload, [reload]);

  const pickDir = useCallback(async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (selected && typeof selected === "string") setPrefs({ pluginsDir: selected });
  }, []);

  /* A plugin fills the panel, the same way the workflow editor does — not a
     dialog. It was opened from inside the sidebar, so it belongs here. */
  if (active) {
    return (
      <PluginPanel
        plugin={active}
        onBack={() => setActive(null)}
        onTypeCommand={onTypeCommand}
        onRunCommand={onRunCommand}
      />
    );
  }

  if (utility === "ports") {
    return <PortsView onBack={() => setUtility(null)} onTypeCommand={onTypeCommand} onOpenBrowser={onOpenBrowser} />;
  }

  if (utility === "dev-tools") {
    return <DevToolsView onBack={() => setUtility(null)} />;
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col">
        <PanelHeader
          icon={PuzzleIcon}
          title="Plugins"
          context={`${TOOLS.length + 3} built-in`}
          actions={
            <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex size-6 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground"
                    aria-label="What is this?"
                  >
                    <HugeiconsIcon icon={InformationCircleIcon} size={14} strokeWidth={1.75} />
                  </button>
                </TooltipTrigger>
                <TooltipContent
                  side="bottom"
                  sideOffset={6}
                  className="max-w-[220px] border border-border/60 bg-zinc-950 text-zinc-100 text-[10.5px] p-2 shadow-lg"
                >
                  Local utilities, infrastructure tools, and 2FA codes. Support for your own plugins is planned.
                </TooltipContent>
              </Tooltip>
              <button
                type="button"
                onClick={pickDir}
                title={dir ? `Plugins folder: ${dir}` : "Choose a plugins folder"}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              >
                <HugeiconsIcon icon={PlusSignIcon} size={14} strokeWidth={2} />
              </button>
            </>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="px-0.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
            Utilities
          </div>
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onOpenTotp}
              title="Open 2FA Codes"
              className="group flex w-full items-start gap-2 rounded-lg border border-border/40 bg-card/30 px-2 py-1.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.05]"
            >
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
                <HugeiconsIcon icon={SecurityCheckIcon} size={13} strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[11.5px] font-medium text-foreground">2FA Codes</span>
                <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">Generate and copy locally stored time-based codes.</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setUtility("ports")}
              title="Inspect local ports"
              className="group flex w-full items-start gap-2 rounded-lg border border-border/40 bg-card/30 px-2 py-1.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.05]"
            >
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-cyan-500/10 text-cyan-300">
                <HugeiconsIcon icon={ComputerTerminal02Icon} size={13} strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[11.5px] font-medium text-foreground">Ports</span>
                <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">Inspect local listeners, open localhost, and stop dev servers.</span>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setUtility("dev-tools")}
              title="Open local developer tools"
              className="group flex w-full items-start gap-2 rounded-lg border border-border/40 bg-card/30 px-2 py-1.5 text-left transition-colors hover:border-primary/45 hover:bg-primary/[0.05]"
            >
              <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-500/10 text-violet-300">
                <HugeiconsIcon icon={CodeIcon} size={13} strokeWidth={1.75} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-[11.5px] font-medium text-foreground">Dev Tools</span>
                <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">Format, decode, convert, and generate locally.</span>
              </div>
            </button>
          </div>

          {/* gap-1 and py-1.5: five rows of two lines each had gap-2 between
              them plus py-2.5 inside, which spread the list over more height
              than it had content for. */}
          {/* Labelled "Built-in" deliberately. These five ship with Husk and
              cannot be added or removed, so presenting them under a bare
              "Plugins" heading — with nothing to install — would promise a
              capability that does not exist yet. */}
          <div className="mt-3 px-0.5 pb-1 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground/50 uppercase">
            Built-in
          </div>
          <div className="flex flex-col gap-1">
            {TOOLS.map((tool) => {
              const disabled = tool.status !== "ready";
              const { Icon } = tool;
              return (
                <button
                  key={tool.name}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelectView(tool.id)}
                  title={tool.description}
                  className={cn(
                    /* Keep the sidebar narrow without hiding what a tool does:
                       its name gets a line and the description may use two. */
                    "group flex items-start gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors",
                    disabled
                      ? "border-border/20 bg-card/20 opacity-50 cursor-not-allowed"
                      : "border-border/40 bg-card/30 hover:border-border/60 hover:bg-card/50",
                  )}
                >
                  <div
                    className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md"
                    /* Tile tinted from the mark's own colour, so each row reads
                       as that product rather than as five identical green
                       chips. color-mix keeps it subtle at 14%. */
                    style={
                      disabled
                        ? undefined
                        : { backgroundColor: `color-mix(in srgb, ${tool.brand} 14%, transparent)` }
                    }
                  >
                    <Icon
                      size={13}
                      color={disabled ? "currentColor" : tool.brand}
                      className={disabled ? "text-muted-foreground" : undefined}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-[11.5px] font-medium text-foreground">{tool.name}</span>
                      {disabled && (
                        <span className="shrink-0 rounded bg-muted/30 px-1.5 py-0 text-[9px] text-muted-foreground uppercase tracking-wide">
                          Soon
                        </span>
                      )}
                    </div>
                    <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                      {tool.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {/* User plugins. Broken ones are listed with their reason rather than
              omitted: a plugin that simply fails to appear gives its author
              nothing to debug. */}
          <div className="mt-3 px-0.5 pb-1 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground/50 uppercase">
            Installed
          </div>
          {!dir ? (
            <button
              type="button"
              onClick={pickDir}
              className="w-full rounded-lg border border-dashed border-border/40 px-2.5 py-2 text-left text-[10.5px] text-muted-foreground transition-colors hover:border-border/70 hover:text-foreground"
            >
              Choose a folder of plugin files to load them here.
            </button>
          ) : loaded.length === 0 ? (
            <p className="px-1 py-2 text-[10.5px] text-muted-foreground">No plugin files in that folder.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {loaded.map((entry) =>
                "plugin" in entry ? (
                  <button
                    key={entry.plugin.id}
                    type="button"
                    onClick={() => setActive(entry.plugin)}
                    className="group flex items-start gap-2.5 rounded-lg border border-border/40 bg-card/30 px-2.5 py-1.5 text-left transition-colors hover:border-border/60 hover:bg-card/50"
                  >
                    <div
                      className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
                      style={{
                        backgroundColor: `color-mix(in srgb, ${entry.plugin.brand ?? "var(--primary)"} 14%, transparent)`,
                      }}
                    >
                      <HugeiconsIcon
                        icon={PuzzleIcon}
                        size={15}
                        strokeWidth={1.75}
                        style={{ color: entry.plugin.brand ?? "var(--primary)" }}
                      />
                    </div>
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-[12.5px] font-medium text-foreground">{entry.plugin.name}</span>
                      <span className="text-[11px] leading-snug text-muted-foreground">
                        {entry.plugin.description ??
                          `${entry.plugin.views.length} view${entry.plugin.views.length === 1 ? "" : "s"}`}
                      </span>
                    </div>
                  </button>
                ) : (
                  <div
                    key={entry.id}
                    className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-2.5 py-1.5"
                  >
                    <HugeiconsIcon
                      icon={AlertCircleIcon}
                      size={13}
                      strokeWidth={2}
                      className="mt-0.5 shrink-0 text-destructive"
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-[11.5px] font-medium text-foreground">{entry.id}</span>
                      <span className="text-[10px] leading-snug text-muted-foreground">{entry.error}</span>
                    </div>
                  </div>
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
