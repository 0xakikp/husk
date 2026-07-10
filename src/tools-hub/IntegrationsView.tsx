import { Modal } from "../components/Modal";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DashboardSquare01Icon,
  Rocket01Icon,
  ContainerIcon,
  Layers01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** husk v1's Integrations view: cards for the infra integrations, each opening
 *  its panel. (The CLI-tool installer is separate — palette "Install CLI tools".) */
export function IntegrationsView({
  onKubernetes,
  onCiCd,
  onDocker,
  onTerraform,
  inline,
}: {
  onKubernetes: () => void;
  onCiCd: () => void;
  onDocker: () => void;
  onTerraform: () => void;
  inline?: boolean;
}) {
  const items = [
    {
      icon: DashboardSquare01Icon,
      name: "Kubernetes",
      desc: "Switch contexts, view pods, and stream logs",
      onClick: onKubernetes,
    },
    {
      icon: Rocket01Icon,
      name: "CI / CD",
      desc: "Monitor GitHub Actions and GitLab pipelines",
      onClick: onCiCd,
    },
    {
      icon: ContainerIcon,
      name: "Docker",
      desc: "Manage containers and images",
      onClick: onDocker,
    },
    {
      icon: Layers01Icon,
      name: "Terraform",
      desc: "View workspaces, state, and resources",
      onClick: onTerraform,
    },
  ];

  return (
    <TooltipProvider delayDuration={200}>
      <Modal
        title={
          <div className="flex items-center gap-1.5">
            <span>Integrations</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                  aria-label="What is this?"
                >
                  <HugeiconsIcon icon={InformationCircleIcon} size={13} strokeWidth={1.75} />
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
        }
        inline={inline}
      >
        <div className="flex flex-col gap-2">
          {items.map((it) => (
            <button
              key={it.name}
              type="button"
              onClick={it.onClick}
              className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/30 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-muted/30"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10">
                <HugeiconsIcon icon={it.icon} size={16} strokeWidth={1.75} className="text-primary" />
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium text-primary">{it.name}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{it.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    </TooltipProvider>
  );
}