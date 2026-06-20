import { cn } from "@/lib/utils";
import {
  ContainerIcon,
  Database01Icon,
  Rocket01Icon,
  CloudIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SidebarViewId } from "../sidebar/SidebarRail";

type ToolCard = {
  id: SidebarViewId;
  name: string;
  description: string;
  icon: typeof Rocket01Icon;
  status: "ready" | "coming-soon";
};

const TOOLS: ToolCard[] = [
  {
    id: "kubernetes",
    name: "Kubernetes",
    description: "Switch contexts, view pods, and stream logs",
    icon: Database01Icon,
    status: "ready",
  },
  {
    id: "ci-cd",
    name: "CI / CD",
    description: "Monitor GitHub Actions and GitLab pipelines",
    icon: Rocket01Icon,
    status: "ready",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Manage containers and images",
    icon: ContainerIcon,
    status: "ready",
  },
  {
    id: "terraform",
    name: "Terraform",
    description: "View workspaces, state, and resources",
    icon: Database01Icon,
    status: "ready",
  },
  {
    id: "tailscale",
    name: "Tailscale",
    description: "List tailnet devices and connect via SSH",
    icon: CloudIcon,
    status: "ready",
  },
];

type Props = {
  onSelectView: (view: SidebarViewId) => void;
};

export function ToolsHubView({ onSelectView }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center border-b border-border/40 px-3">
        <span className="text-xs font-semibold text-primary">Integrations</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-2">
          {TOOLS.map((tool) => {
            const disabled = tool.status !== "ready";
            return (
              <button
                key={tool.name}
                type="button"
                disabled={disabled}
                onClick={() => onSelectView(tool.id)}
                className={cn(
                  "group flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                  disabled
                    ? "border-border/20 bg-card/20 opacity-50 cursor-not-allowed"
                    : "border-border/40 bg-card/30 hover:border-border/60 hover:bg-card/50",
                )}
              >
                <div
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-md",
                    disabled ? "bg-muted/20" : "bg-primary/10",
                  )}
                >
                  <HugeiconsIcon
                    icon={tool.icon}
                    size={16}
                    strokeWidth={1.5}
                    className={disabled ? "text-muted-foreground" : "text-primary"}
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
  );
}
