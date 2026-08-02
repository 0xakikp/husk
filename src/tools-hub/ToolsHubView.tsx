import { cn } from "@/lib/utils";
import { InformationCircleIcon } from "@hugeicons/core-free-icons";
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
};

export function ToolsHubView({ onSelectView }: Props) {
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex h-full flex-col">
        <div className="flex h-8 shrink-0 items-center border-b border-border/40 px-3">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-primary">Integrations</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="What is this?"
                >
                  <HugeiconsIcon icon={InformationCircleIcon} size={12} strokeWidth={1.75} />
                </button>
              </TooltipTrigger>
              <TooltipContent
                side="right"
                sideOffset={6}
                className="max-w-[220px] border border-border/60 bg-zinc-950 text-zinc-100 text-[10.5px] p-2 shadow-lg"
              >
                Connect to infrastructure tools: Kubernetes, Docker, Terraform, CI/CD, and Tailscale.
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* gap-1 and py-1.5: five rows of two lines each had gap-2 between
              them plus py-2.5 inside, which spread the list over more height
              than it had content for. */}
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
                  className={cn(
                    "group flex items-start gap-2.5 rounded-lg border px-2.5 py-1.5 text-left transition-colors",
                    disabled
                      ? "border-border/20 bg-card/20 opacity-50 cursor-not-allowed"
                      : "border-border/40 bg-card/30 hover:border-border/60 hover:bg-card/50",
                  )}
                >
                  <div
                    className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md"
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
                      size={15}
                      color={disabled ? "currentColor" : tool.brand}
                      className={disabled ? "text-muted-foreground" : undefined}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-foreground">{tool.name}</span>
                      {disabled && (
                        <span className="rounded bg-muted/30 px-1.5 py-0 text-[9px] text-muted-foreground uppercase tracking-wide">
                          Soon
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      {tool.description}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
