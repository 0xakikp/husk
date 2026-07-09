import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  DownloadCircle01Icon,
  ToolsIcon,
  ComputerTerminal02Icon,
  Cancel01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { detectInstalled } from "@/tools";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { typeInActiveTerminal } from "@/ai/terminalContext";
import { usePrefs, setPrefs } from "@/settings/preferences";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
  commands: Record<Platform, string | null>;
};

type Platform = "macos" | "linux" | "windows";

const PLATFORM: Platform = IS_MAC ? "macos" : IS_WINDOWS ? "windows" : "linux";

const BREW_PREFIX = '[ -x /opt/homebrew/bin/brew ] \u0026\u0026 eval "$(/opt/homebrew/bin/brew shellenv)"; [ -x /usr/local/bin/brew ] \u0026\u0026 eval "$(/usr/local/bin/brew shellenv)"';

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
        commands: {
          macos: "brew install zsh",
          linux: "sudo apt update \u0026\u0026 sudo apt install -y zsh",
          windows: "winget install --id zsh-org.zsh -e",
        },
      },
      {
        id: "oh-my-zsh",
        name: "oh-my-zsh",
        description: "Framework for managing zsh configuration, plugins, and themes.",
        commands: {
          macos: 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"',
          linux: 'sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"',
          windows: null,
        },
      },
      {
        id: "zsh-autosuggestions",
        name: "zsh-autosuggestions",
        description: "Suggests commands as you type based on history.",
        commands: {
          macos: "git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions",
          linux: "git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions",
          windows: null,
        },
      },
      {
        id: "zsh-syntax-highlighting",
        name: "zsh-syntax-highlighting",
        description: "Fish-like syntax highlighting for the zsh shell.",
        commands: {
          macos: "git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting",
          linux: "git clone https://github.com/zsh-users/zsh-syntax-highlighting.git ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-syntax-highlighting",
          windows: null,
        },
      },
      {
        id: "powerlevel10k",
        name: "powerlevel10k",
        description: "Highly customizable, fast zsh prompt theme with git status.",
        commands: {
          macos: "git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k",
          linux: "git clone --depth=1 https://github.com/romkatv/powerlevel10k.git ${ZSH_CUSTOM:-$HOME/.oh-my-zsh/custom}/themes/powerlevel10k",
          windows: null,
        },
      },
      {
        id: "starship",
        name: "starship",
        description: "Minimal, fast, cross-shell prompt written in Rust.",
        commands: {
          macos: "brew install starship",
          linux: "curl -sS https://starship.rs/install.sh | sh",
          windows: "winget install --id Starship.Starship -e",
        },
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
        commands: {
          macos: "brew install eza",
          linux: "sudo apt install -y eza",
          windows: "winget install --id eza-community.eza -e",
        },
      },
      {
        id: "bat",
        name: "bat",
        description: "Syntax-highlighting cat replacement with git integration.",
        commands: {
          macos: "brew install bat",
          linux: "sudo apt install -y bat",
          windows: "winget install --id sharkdp.bat -e",
        },
      },
      {
        id: "fzf",
        name: "fzf",
        description: "Fuzzy finder for files, command history, and directories.",
        commands: {
          macos: "brew install fzf",
          linux: "sudo apt install -y fzf",
          windows: "winget install --id junegunn.fzf -e",
        },
      },
      {
        id: "zoxide",
        name: "zoxide",
        description: "Smarter cd — remembers your most used directories.",
        commands: {
          macos: "brew install zoxide",
          linux: "sudo apt install -y zoxide",
          windows: "winget install --id ajeetdsouza.zoxide -e",
        },
      },
      {
        id: "ripgrep",
        name: "ripgrep",
        description: "Blazing fast recursive search with smart defaults.",
        commands: {
          macos: "brew install ripgrep",
          linux: "sudo apt install -y ripgrep",
          windows: "winget install --id BurntSushi.ripgrep.MSVC -e",
        },
      },
      {
        id: "fd",
        name: "fd",
        description: "Fast and user-friendly find alternative with intuitive syntax.",
        commands: {
          macos: "brew install fd",
          linux: "sudo apt install -y fd-find",
          windows: "winget install --id sharkdp.fd -e",
        },
      },
      {
        id: "delta",
        name: "delta",
        description: "Beautiful syntax-highlighted git diffs with side-by-side view.",
        commands: {
          macos: "brew install git-delta",
          linux: "sudo apt install -y git-delta",
          windows: "winget install --id dandavison.delta -e",
        },
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
        commands: {
          macos: "brew install lazygit",
          linux: "sudo apt install -y lazygit",
          windows: "winget install --id JesseDuffield.lazygit -e",
        },
      },
      {
        id: "lazydocker",
        name: "lazydocker",
        description: "Terminal UI for Docker containers and images.",
        commands: {
          macos: "brew install lazydocker",
          linux: "curl https://raw.githubusercontent.com/jesseduffield/lazydocker/master/scripts/install_update_linux.sh | bash",
          windows: "winget install --id JesseDuffield.lazydocker -e",
        },
      },
      {
        id: "k9s",
        name: "k9s",
        description: "Terminal UI for managing Kubernetes clusters.",
        commands: {
          macos: "brew install k9s",
          linux: "curl -sS https://webinstall.dev/k9s | bash",
          windows: "winget install --id derailed.k9s -e",
        },
      },
      {
        id: "just",
        name: "just",
        description: "Command runner — a better Make for project-specific tasks.",
        commands: {
          macos: "brew install just",
          linux: "sudo apt install -y just",
          windows: "winget install --id Casey.Just -e",
        },
      },
      {
        id: "mise",
        name: "mise",
        description: "Manage language versions and tools in one place.",
        commands: {
          macos: "brew install mise",
          linux: "curl https://mise.run | sh",
          windows: "winget install --id jdx.mise -e",
        },
      },
      {
        id: "direnv",
        name: "direnv",
        description: "Auto-load and unload environment variables per directory.",
        commands: {
          macos: "brew install direnv",
          linux: "sudo apt install -y direnv",
          windows: "winget install --id direnv.direnv -e",
        },
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
        commands: {
          macos: "brew install atuin",
          linux: "curl --proto '=https' --tlsv1.2 -sSf https://setup.atuin.sh | sh",
          windows: "winget install --id Atuin.Atuin -e",
        },
      },
      {
        id: "btop",
        name: "btop",
        description: "Beautiful system monitor with graphs, process tree, and network stats.",
        commands: {
          macos: "brew install btop",
          linux: "sudo apt install -y btop",
          windows: "winget install --id aristocratos.btop4windows -e",
        },
      },
      {
        id: "tldr",
        name: "tldr",
        description: "Simplified community-driven man pages with practical examples.",
        commands: {
          macos: "brew install tldr",
          linux: "sudo apt install -y tldr",
          windows: "winget install --id tldr-pages.tldr -e",
        },
      },
      {
        id: "glow",
        name: "glow",
        description: "Render Markdown files directly in the terminal.",
        commands: {
          macos: "brew install glow",
          linux: "sudo mkdir -p /etc/apt/keyrings && curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg && echo \"deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *\" | sudo tee /etc/apt/sources.list.d/charm.list && sudo apt update && sudo apt install -y glow",
          windows: "winget install --id charmbracelet.glow -e",
        },
      },
      {
        id: "jq",
        name: "jq",
        description: "Lightweight command-line JSON processor.",
        commands: {
          macos: "brew install jq",
          linux: "sudo apt install -y jq",
          windows: "winget install --id jqlang.jq -e",
        },
      },
    ],
  },
];

function getCommand(tool: ToolInfo, platform: Platform): string | null {
  return tool.commands[platform] ?? tool.commands.macos ?? null;
}

function formatGroupInstall(tools: ToolInfo[], platform: Platform): string | null {
  const brewTools: string[] = [];
  const scripts: string[] = [];
  for (const tool of tools) {
    const cmd = getCommand(tool, platform);
    if (!cmd) continue;
    if (platform === "macos" && cmd.startsWith("brew install ")) {
      brewTools.push(tool.id);
    } else if (platform === "linux" && cmd.startsWith("sudo apt ")) {
      brewTools.push(tool.id === "fd" ? "fd-find" : tool.id === "bat" ? "bat" : tool.id === "git-delta" ? "git-delta" : tool.id);
    } else {
      scripts.push(cmd);
    }
  }

  if (platform === "macos" && brewTools.length > 0) {
    scripts.unshift(`${BREW_PREFIX} && brew install ${brewTools.join(" ")}`);
  } else if (platform === "linux") {
    const aptNames = brewTools.filter((n) => n !== "glow" && n !== "lazygit");
    if (aptNames.length > 0) scripts.unshift(`sudo apt update && sudo apt install -y ${aptNames.join(" ")}`);
    // Add non-apt tools individually
    for (const tool of tools) {
      const cmd = getCommand(tool, platform);
      if (cmd && !cmd.startsWith("sudo apt ")) scripts.push(cmd);
    }
  }

  if (scripts.length === 0) return null;
  return scripts.join("\n\n");
}

export function SetupAssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sentHint, setSentHint] = useState(false);

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

  const allTools = useMemo(() => SETUP_GROUPS.flatMap((g) => g.tools), []);
  const installedCount = allTools.filter((t) => installed.has(t.id)).length;
  const totalCount = allTools.length;
  const missingCount = totalCount - installedCount;

  const runInTerminal = (cmd: string) => {
    if (typeInActiveTerminal(cmd)) {
      setSentHint(true);
      setTimeout(() => setSentHint(false), 2500);
    }
  };

  const installAll = () => {
    const missing = allTools.filter((t) => !installed.has(t.id));
    const script = formatGroupInstall(missing, PLATFORM);
    if (script) runInTerminal(script);
  };

  const installGroup = (group: ToolGroup) => {
    const missing = group.tools.filter((t) => !installed.has(t.id));
    const script = formatGroupInstall(missing, PLATFORM);
    if (script) runInTerminal(script);
  };

  const platformLabel = PLATFORM === "macos" ? "Homebrew" : PLATFORM === "linux" ? "apt" : "winget";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-2">
          <DialogTitle className="flex items-center gap-2 text-base">
            <HugeiconsIcon icon={ToolsIcon} size={18} strokeWidth={1.75} />
            Setup Assistant
          </DialogTitle>
          <DialogDescription className="space-y-1">
            <p>
              These tools are <span className="font-medium text-foreground">optional</span>. Husk works without them,
              but they enhance the terminal experience.
            </p>
            {!loading && (
              <p className="text-muted-foreground">
                {installedCount}/{totalCount} installed · {missingCount} missing · commands use {platformLabel}
              </p>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4 space-y-6">
          {sentHint && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-500">
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} className="inline mr-1" />
              Command pasted into the active terminal. Press Enter to run it.
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="default"
              onClick={installAll}
              disabled={missingCount === 0 || loading}
              className="text-[11px]"
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} className="mr-1" />
              Install all missing
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={check}
              disabled={loading}
              className="text-[11px]"
            >
              Refresh
            </Button>
          </div>

          {SETUP_GROUPS.map((group) => {
            const groupMissing = group.tools.filter((t) => !installed.has(t.id));
            return (
              <div key={group.id}>
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
                    <p className="text-[11px] text-muted-foreground">{group.description}</p>
                  </div>
                  {groupMissing.length > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => installGroup(group)}
                      className="text-[10px] h-7"
                    >
                      Install {groupMissing.length}
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {group.tools.map((tool) => (
                    <ToolCard
                      key={tool.id}
                      tool={tool}
                      platform={PLATFORM}
                      isInstalled={installed.has(tool.id)}
                      loading={loading}
                      onRunInTerminal={runInTerminal}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolCard({
  tool,
  platform,
  isInstalled,
  loading,
  onRunInTerminal,
}: {
  tool: ToolInfo;
  platform: Platform;
  isInstalled: boolean;
  loading: boolean;
  onRunInTerminal: (cmd: string) => void;
}) {
  const [showCommand, setShowCommand] = useState(false);
  const [copied, setCopied] = useState(false);
  const cmd = getCommand(tool, platform);
  const unsupported = cmd === null;

  const copy = async () => {
    if (!cmd) return;
    try {
      await navigator.clipboard.writeText(cmd);
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
            {unsupported && !isInstalled && (
              <span className="text-[9px] text-muted-foreground">Unsupported on {platform}</span>
            )}
          </div>
          <p className="text-[10.5px] leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
        </div>
        {!isInstalled && !loading && !unsupported && (
          <HugeiconsIcon
            icon={DownloadCircle01Icon}
            size={16}
            className="mt-0.5 shrink-0 text-muted-foreground/50"
          />
        )}
      </div>

      {!isInstalled && !unsupported && (
        <div className="flex flex-col gap-1.5">
          {showCommand ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1">
              <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
                {cmd}
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
          <div className="flex flex-wrap gap-1.5">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => cmd && onRunInTerminal(cmd)}
              className="h-6 text-[10px] gap-1"
            >
              <HugeiconsIcon icon={ComputerTerminal02Icon} size={11} />
              Run in terminal
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function SetupAssistantBanner({ onOpen }: { onOpen: () => void }) {
  const prefs = usePrefs();
  if (prefs.setupAssistantDismissed) return null;

  return (
    <div className="mb-6 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <HugeiconsIcon icon={ToolsIcon} size={14} strokeWidth={1.75} className="text-primary" />
            Enhance your terminal
          </div>
          <p className="text-[11px] text-muted-foreground">
            Husk works best with a modern shell setup. Install optional tools like eza, fzf, starship, and zoxide to get the most out of the terminal.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onOpen}
              className="h-7 text-[11px]"
            >
              Open Setup Assistant
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setPrefs({ setupAssistantDismissed: true })}
              className="h-7 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Remind me later
            </Button>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setPrefs({ setupAssistantDismissed: true })}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Dismiss"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
