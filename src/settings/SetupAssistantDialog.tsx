import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  DownloadCircle01Icon,
  ToolsIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { detectInstalled } from "@/tools";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

export type ToolGroup = {
  id: string;
  title: string;
  description: string;
  tools: ToolInfo[];
};

export type ToolInfo = {
  id: string;
  name: string;
  description: string;
  installCommand: string;
};

export const SETUP_GROUPS: ToolGroup[] = [
  {
    id: "shell",
    title: "Shell Setup",
    description: "Recommended zsh ecosystem for the best Husk terminal experience.",
    tools: [
      {
        id: "zsh",
        name: "zsh",
        description: "Modern shell with great completion and plugin support. (Default on macOS.)",
        installCommand: "brew install zsh",
      },
      {
        id: "oh-my-zsh",
        name: "oh-my-zsh",
        description: "Framework for managing zsh configuration, plugins, and themes.",
        installCommand: 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"',
      },
      {
        id: "zsh-autosuggestions",
        name: "zsh-autosuggestions",
        description: "Suggests commands as you type based on history.",
        installCommand: "git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions",
      },
      {
        id: "zsh-syntax-highlighting",
        name: "zsh-syntax-highlighting",
        description: "Fish-like syntax highlighting for the zsh shell.",
        installCommand: "git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting",
      },
      {
        id: "powerlevel10k",
        name: "powerlevel10k",
        description: "Highly customizable, fast zsh prompt theme with git status.",
        installCommand: "git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k",
      },
      {
        id: "starship",
        name: "starship",
        description: "Minimal, fast, cross-shell prompt written in Rust.",
        installCommand: "brew install starship",
      },
    ],
  },
  {
    id: "essentials",
    title: "Terminal Essentials",
    description: "Drop-in replacements for core Unix tools.",
    tools: [
      {
        id: "eza",
        name: "eza",
        description: "Modern ls replacement with icons, colors, and git integration.",
        installCommand: "brew install eza",
      },
      {
        id: "bat",
        name: "bat",
        description: "Syntax-highlighting cat replacement with git integration.",
        installCommand: "brew install bat",
      },
      {
        id: "fzf",
        name: "fzf",
        description: "Fuzzy finder for files, command history, and directories.",
        installCommand: "brew install fzf",
      },
      {
        id: "zoxide",
        name: "zoxide",
        description: "Smarter cd — remembers your most used directories.",
        installCommand: "brew install zoxide",
      },
      {
        id: "ripgrep",
        name: "ripgrep",
        description: "Blazing fast recursive search with smart defaults.",
        installCommand: "brew install ripgrep",
      },
      {
        id: "fd",
        name: "fd",
        description: "Fast and user-friendly find alternative with intuitive syntax.",
        installCommand: "brew install fd",
      },
      {
        id: "delta",
        name: "delta",
        description: "Beautiful syntax-highlighted git diffs with side-by-side view.",
        installCommand: "brew install git-delta",
      },
    ],
  },
  {
    id: "devops",
    title: "Dev / DevOps",
    description: "Terminal UIs and helpers for git, containers, and orchestration.",
    tools: [
      {
        id: "lazygit",
        name: "lazygit",
        description: "Terminal UI for git with intuitive keybindings.",
        installCommand: "brew install lazygit",
      },
      {
        id: "lazydocker",
        name: "lazydocker",
        description: "Terminal UI for Docker containers and images.",
        installCommand: "brew install lazydocker",
      },
      {
        id: "k9s",
        name: "k9s",
        description: "Terminal UI for managing Kubernetes clusters.",
        installCommand: "brew install k9s",
      },
      {
        id: "just",
        name: "just",
        description: "Command runner — a better Make for project-specific tasks.",
        installCommand: "brew install just",
      },
      {
        id: "mise",
        name: "mise",
        description: "Manage language versions and tools in one place.",
        installCommand: "brew install mise",
      },
      {
        id: "direnv",
        name: "direnv",
        description: "Auto-load and unload environment variables per directory.",
        installCommand: "brew install direnv",
      },
    ],
  },
  {
    id: "extras",
    title: "Nice-to-have",
    description: "Extra utilities that improve day-to-day terminal work.",
    tools: [
      {
        id: "atuin",
        name: "atuin",
        description: "Magical shell history with sync, search, and stats.",
        installCommand: "brew install atuin",
      },
      {
        id: "btop",
        name: "btop",
        description: "Beautiful system monitor with graphs, process tree, and network stats.",
        installCommand: "brew install btop",
      },
      {
        id: "tldr",
        name: "tldr",
        description: "Simplified community-driven man pages with practical examples.",
        installCommand: "brew install tldr",
      },
      {
        id: "glow",
        name: "glow",
        description: "Render Markdown files directly in the terminal.",
        installCommand: "brew install glow",
      },
      {
        id: "jq",
        name: "jq",
        description: "Lightweight command-line JSON processor.",
        installCommand: "brew install jq",
      },
    ],
  },
];

export function SetupAssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    setLoading(true);
    const allIds = SETUP_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
    const detected = await detectInstalled(allIds);
    setInstalled(detected);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) void check();
  }, [open, check]);

  const installedCount = SETUP_GROUPS.flatMap((g) => g.tools).filter((t) => installed.has(t.id)).length;
  const totalCount = SETUP_GROUPS.flatMap((g) => g.tools).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={ToolsIcon} size={18} strokeWidth={1.75} />
            Setup Assistant
          </DialogTitle>
          <DialogDescription>
            These tools are <span className="font-medium text-foreground">optional</span>. Husk works without them,
            but they enhance the terminal experience.
            {loading ? null : (
              <span className="ml-1 text-muted-foreground">
                {installedCount}/{totalCount} installed
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-6 space-y-6">
          {SETUP_GROUPS.map((group) => (
            <div key={group.id}>
              <div className="mb-3">
                <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
                <p className="text-[11px] text-muted-foreground">{group.description}</p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {group.tools.map((tool) => (
                  <ToolCard
                    key={tool.id}
                    tool={tool}
                    isInstalled={installed.has(tool.id)}
                    loading={loading}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolCard({
  tool,
  isInstalled,
  loading,
}: {
  tool: ToolInfo;
  isInstalled: boolean;
  loading: boolean;
}) {
  const [showCommand, setShowCommand] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(tool.installCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border p-3 transition-colors",
        isInstalled
          ? "border-emerald-500/20 bg-emerald-500/[0.03]"
          : "border-border/60 bg-card/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[12px] font-semibold",
                isInstalled ? "text-emerald-500" : "text-foreground",
              )}
            >
              {tool.name}
            </span>
            {isInstalled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={9} />
                Installed
              </span>
            )}
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
        </div>
        {!isInstalled && !loading && (
          <HugeiconsIcon
            icon={DownloadCircle01Icon}
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground/50"
          />
        )}
      </div>

      {!isInstalled && (
        <div className="flex flex-col gap-1.5">
          {showCommand ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {tool.installCommand}
              </code>
              <button
                type="button"
                onClick={copy}
                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                title="Copy"
              >
                {copied ? (
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    size={11}
                    className="text-emerald-500"
                  />
                ) : (
                  <HugeiconsIcon icon={Copy01Icon} size={11} />
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCommand(true)}
              className="self-start text-[10px] text-emerald-500 underline-offset-2 hover:underline"
            >
              Show install command
            </button>
          )}
        </div>
      )}
    </div>
  );
}
