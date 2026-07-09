import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  DownloadCircle01Icon,
  ToolsIcon,
  ComputerTerminal02Icon,
  Cancel01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { detectInstalled } from "@/tools";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { typeInActiveTerminal, focusActiveTerminal } from "@/ai/terminalContext";
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
  notes?: string;
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
        description: "Modern shell with completion and plugin support. Default on macOS.",
        commands: {
          macos: "brew install zsh",
          linux: "sudo apt update \u0026\u0026 sudo apt install -y zsh",
          windows: "winget install --id zsh-org.zsh -e",
        },
      },
      {
        id: "oh-my-zsh",
        name: "oh-my-zsh",
        description: "Framework for managing zsh config, plugins, and themes.",
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
        description: "Fast, customizable zsh prompt theme with git status.",
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
    description: "Drop-in replacements for core Unix tools that make output look better.",
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
          linux: "sudo mkdir -p /etc/apt/keyrings \u0026\u0026 curl -fsSL https://repo.charm.sh/apt/gpg.key | sudo gpg --dearmor -o /etc/apt/keyrings/charm.gpg \u0026\u0026 echo \"deb [signed-by=/etc/apt/keyrings/charm.gpg] https://repo.charm.sh/apt/ * *\" | sudo tee /etc/apt/sources.list.d/charm.list \u0026\u0026 sudo apt update \u0026\u0026 sudo apt install -y glow",
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
  if (platform === "macos") {
    const brewPackages: string[] = [];
    const scripts: string[] = [];
    for (const tool of tools) {
      const cmd = getCommand(tool, platform);
      if (!cmd) continue;
      if (cmd.startsWith("brew install ")) {
        brewPackages.push(cmd.replace("brew install ", ""));
      } else {
        scripts.push(cmd);
      }
    }
    const parts: string[] = [];
    if (brewPackages.length > 0) {
      parts.push(`${BREW_PREFIX} \u0026\u0026 brew install ${[...new Set(brewPackages)].join(" ")}`);
    }
    parts.push(...scripts);
    return parts.length ? parts.join("\n\n") : null;
  }

  if (platform === "linux") {
    const aptNames: string[] = [];
    const scripts: string[] = [];
    for (const tool of tools) {
      const cmd = getCommand(tool, platform);
      if (!cmd) continue;
      if (cmd.startsWith("sudo apt install -y ")) {
        aptNames.push(cmd.replace("sudo apt install -y ", ""));
      } else if (cmd.startsWith("sudo apt update ")) {
        aptNames.push(cmd);
      } else {
        scripts.push(cmd);
      }
    }
    const parts: string[] = [];
    const uniqueApt = [...new Set(aptNames)];
    if (uniqueApt.length > 0) {
      parts.push(`sudo apt update \u0026\u0026 sudo apt install -y ${uniqueApt.join(" ")}`);
    }
    parts.push(...scripts);
    return parts.length ? parts.join("\n\n") : null;
  }

  const scripts = tools
    .map((t) => getCommand(t, platform))
    .filter((c): c is string => c !== null);
  return scripts.length ? scripts.join("\n\n") : null;
}

export function SetupAssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; action?: () => void; actionLabel?: string } | null>(null);

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

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const allTools = useMemo(() => SETUP_GROUPS.flatMap((g) => g.tools), []);
  const installedCount = allTools.filter((t) => installed.has(t.id)).length;
  const totalCount = allTools.length;
  const missingCount = totalCount - installedCount;

  const runInTerminal = (cmd: string) => {
    if (typeInActiveTerminal(cmd)) {
      setToast({
        message: "Command pasted into the active terminal. Press Enter there to run it.",
        action: () => {
          onOpenChange(false);
          focusActiveTerminal();
        },
        actionLabel: "Focus terminal",
      });
    } else {
      setToast({ message: "No active terminal found. Open a terminal tab first." });
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
      <DialogContent
        overlayClassName="bg-black/60 backdrop-blur-none"
        className="fixed top-1/2 left-1/2 flex h-[92vh] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col gap-0 overflow-hidden rounded-2xl border border-border/50 bg-background p-0 shadow-2xl"
      >
        <DialogHeader className="shrink-0 border-b border-border/40 px-6 py-5">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-base">
              <HugeiconsIcon icon={ToolsIcon} size={18} strokeWidth={1.75} />
              Setup Assistant
            </DialogTitle>
            {!loading && (
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-emerald-500">
                  <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} />
                  {installedCount} installed
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {missingCount} missing
                </span>
                <span className="rounded-full bg-muted px-2 py-0.5">
                  {platformLabel}
                </span>
              </div>
            )}
          </div>
          <DialogDescription className="mt-1">
            These tools are optional. Husk works without them, but they enhance the terminal experience.
            Commands are generated for your current platform.
          </DialogDescription>
        </DialogHeader>

        <div className="relative flex flex-1 flex-col overflow-hidden">
          {toast && (
            <div className="absolute left-1/2 top-4 z-10 w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 animate-in fade-in slide-in-from-top-2">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 shadow-lg">
                <span className="text-[11px] text-emerald-500">
                  <HugeiconsIcon icon={ComputerTerminal02Icon} size={12} className="inline mr-1" />
                  {toast.message}
                </span>
                {toast.action && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={toast.action}
                    className="h-6 text-[10px] text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-500"
                  >
                    {toast.actionLabel}
                  </Button>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto px-6 py-5">
            <div className="mb-5 flex flex-wrap items-center gap-2">
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
                Refresh status
              </Button>
            </div>

            <div className="space-y-8">
              {SETUP_GROUPS.map((group) => {
                const groupMissing = group.tools.filter((t) => !installed.has(t.id));
                return (
                  <section key={group.id} className="scroll-mt-4">
                    <div className="mb-3 flex items-center justify-between">
                      <div>
                        <h3 className="text-[14px] font-semibold text-foreground">{group.title}</h3>
                        <p className="text-[11px] text-muted-foreground">{group.description}</p>
                      </div>
                      {groupMissing.length > 0 && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => installGroup(group)}
                          className="h-7 text-[10px]"
                        >
                          Install {groupMissing.length}
                        </Button>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                  </section>
                );
              })}
            </div>
          </div>
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
        "group flex flex-col gap-2 rounded-xl border p-3 transition-colors",
        isInstalled
          ? "border-emerald-500/20 bg-emerald-500/[0.03]"
          : "border-border/60 bg-card/40 hover:border-border",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "text-[12px] font-semibold",
                isInstalled ? "text-emerald-500" : "text-foreground",
              )}
            >
              {tool.name}
            </span>
            {isInstalled ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-medium text-emerald-500">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={9} />
                Installed
              </span>
            ) : unsupported ? (
              <span className="text-[9px] text-muted-foreground">Unsupported on {platform}</span>
            ) : null}
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
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5">
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => cmd && onRunInTerminal(cmd)}
            className="h-7 w-full justify-start gap-1.5 text-[10px]"
          >
            <HugeiconsIcon icon={ComputerTerminal02Icon} size={11} />
            Run in terminal
          </Button>
        </div>
      )}
    </div>
  );
}

export function SetupAssistantBanner({ onOpen }: { onOpen: () => void }) {
  const prefs = usePrefs();
  if (prefs.setupAssistantDismissed) return null;

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-border/60 bg-card/40">
      <div className="flex items-start justify-between gap-4 p-5">
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <HugeiconsIcon icon={ToolsIcon} size={16} strokeWidth={1.75} className="text-primary" />
            Enhance your terminal
          </div>
          <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
            Husk works best with a modern shell setup. Install optional tools like eza, fzf, starship, and zoxide to get the most out of the terminal.
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onOpen}
              className="h-7 gap-1 text-[11px]"
            >
              Open Setup Assistant
              <HugeiconsIcon icon={ArrowRight01Icon} size={11} />
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

export function ToolsSetupCard({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/40 p-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
          <HugeiconsIcon icon={ToolsIcon} size={16} strokeWidth={1.75} className="text-primary" />
          Recommended tools
        </div>
        <p className="max-w-xl text-[11px] leading-relaxed text-muted-foreground">
          Browse a curated list of optional CLI tools — eza, bat, fzf, zoxide, lazygit, starship, and more. Husk detects what you already have and can paste install commands into the active terminal.
        </p>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onOpen}
          className="h-8 gap-1.5 text-[11px]"
        >
          <HugeiconsIcon icon={ToolsIcon} size={13} strokeWidth={1.75} />
          Open Setup Assistant
        </Button>
      </div>
    </div>
  );
}
