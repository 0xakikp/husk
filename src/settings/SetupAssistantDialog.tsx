import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  ToolsIcon,
  ComputerTerminal02Icon,
  Cancel01Icon,
  ArrowRight01Icon,
  Search01Icon,
  CommandLineIcon,
  GitCompareIcon,
  ContainerIcon,
  FallingStarIcon,
  Settings02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { detectInstalled } from "@/tools";
import { IS_MAC, IS_WINDOWS } from "@/lib/platform";
import { usePrefs, setPrefs } from "@/settings/preferences";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export type ToolGroup = {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentProps<typeof HugeiconsIcon>["icon"];
  style: { bg: string; text: string; border: string };
  tools: ToolInfo[];
};

export type ToolInfo = {
  id: string;
  name: string;
  description: string;
  commands: Record<Platform, string | null>;
  tags?: string[];
  notes?: string;
};

type Platform = "macos" | "linux" | "windows";

const PLATFORM: Platform = IS_MAC ? "macos" : IS_WINDOWS ? "windows" : "linux";

const BREW_PREFIX = '[ -x /opt/homebrew/bin/brew ] \u0026\u0026 eval "$(/opt/homebrew/bin/brew shellenv)"; [ -x /usr/local/bin/brew ] \u0026\u0026 eval "$(/usr/local/bin/brew shellenv)"';
void BREW_PREFIX; // referenced by future background installer

export const SETUP_GROUPS: ToolGroup[] = [
  {
    id: "shell",
    title: "Shell",
    description: "zsh ecosystem and prompt themes",
    icon: CommandLineIcon,
    style: { bg: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/20" },
    tools: [
      {
        id: "zsh",
        name: "zsh",
        description: "Modern shell with completion and plugin support. Default on macOS.",
        tags: ["shell"],
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
        tags: ["framework"],
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
        tags: ["plugin"],
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
        tags: ["plugin"],
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
        tags: ["theme"],
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
        tags: ["prompt"],
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
    title: "Essentials",
    description: "Drop-in replacements for core Unix tools",
    icon: CommandLineIcon,
    style: { bg: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/20" },
    tools: [
      {
        id: "eza",
        name: "eza",
        description: "Modern ls replacement with icons, colors, and git integration.",
        tags: ["ls", "listing"],
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
        tags: ["cat", "preview"],
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
        tags: ["search", "fuzzy"],
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
        tags: ["cd", "navigation"],
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
        tags: ["grep", "search"],
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
        tags: ["find", "search"],
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
        tags: ["git", "diff"],
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
    description: "Terminal UIs for git, containers, and orchestration",
    icon: ContainerIcon,
    style: { bg: "bg-emerald-500/10", text: "text-emerald-500", border: "border-emerald-500/20" },
    tools: [
      {
        id: "lazygit",
        name: "lazygit",
        description: "Terminal UI for git with intuitive keybindings.",
        tags: ["git", "tui"],
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
        tags: ["docker", "tui"],
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
        tags: ["kubernetes", "tui"],
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
        tags: ["runner", "build"],
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
        tags: ["versions", "languages"],
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
        tags: ["env", "shell"],
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
    title: "Extras",
    description: "Nice-to-have utilities for daily terminal work",
    icon: FallingStarIcon,
    style: { bg: "bg-violet-500/10", text: "text-violet-500", border: "border-violet-500/20" },
    tools: [
      {
        id: "atuin",
        name: "atuin",
        description: "Magical shell history with sync, search, and stats.",
        tags: ["history"],
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
        tags: ["monitor"],
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
        tags: ["docs"],
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
        tags: ["markdown"],
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
        tags: ["json"],
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

export function SetupAssistantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<"All" | ToolGroup["id"]>("All");
  const [lastOp, setLastOp] = useState<{ message: string; ok: boolean } | null>(null);

  const check = useCallback(async () => {
    setLoading(true);
    const allIds = SETUP_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
    const detected = await detectInstalled(allIds);
    setInstalled(detected);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (open) {
      setLastOp(null);
      void check();
    }
  }, [open, check]);

  const allTools = useMemo(() => SETUP_GROUPS.flatMap((g) => g.tools), []);
  const installedCount = allTools.filter((t) => installed.has(t.id)).length;
  const totalCount = allTools.length;
  const missingCount = totalCount - installedCount;

  const visibleGroups = useMemo(() => {
    if (activeCategory === "All") return SETUP_GROUPS;
    return SETUP_GROUPS.filter((g) => g.id === activeCategory);
  }, [activeCategory]);

  const filteredGroups = useMemo(() => {
    if (!query.trim()) return visibleGroups;
    const q = query.toLowerCase();
    return visibleGroups
      .map((g) => ({ ...g, tools: g.tools.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.tags?.some((tag) => tag.toLowerCase().includes(q))) }))
      .filter((g) => g.tools.length > 0);
  }, [visibleGroups, query]);

  const platformLabel = PLATFORM === "macos" ? "Homebrew" : PLATFORM === "linux" ? "apt" : "winget";
  const categories = ["All", ...SETUP_GROUPS.map((g) => g.id)];

  const copyCommand = (tool: ToolInfo, platform: Platform) => {
    const cmd = getCommand(tool, platform);
    if (!cmd) {
      setLastOp({ message: `No install command available for ${tool.name} on ${platform}.`, ok: false });
      return;
    }
    navigator.clipboard
      .writeText(cmd)
      .then(() => setLastOp({ message: `Copied ${tool.name} install command to clipboard.`, ok: true }))
      .catch(() => setLastOp({ message: `Failed to copy ${tool.name} install command.`, ok: false }));
  };

  const installAll = () => {
    setLastOp({ message: "Background install is not yet available. Copy commands and run them in your terminal.", ok: false });
  };

  const installGroup = (group: ToolGroup) => {
    setLastOp({ message: `Background install for ${group.title} is not yet available.`, ok: false });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[85vh] max-h-[760px] w-[90vw] max-w-[900px] flex-col overflow-hidden p-0 sm:max-w-[900px]"
      >
        <DialogHeader className="shrink-0 border-b border-border/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <HugeiconsIcon icon={ToolsIcon} size={16} strokeWidth={1.75} />
              Setup Assistant
            </DialogTitle>
            {!loading && (
              <span className="text-[11px] text-muted-foreground">
                {installedCount}/{totalCount} installed · {missingCount} missing · {platformLabel}
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-col gap-2">
            <div className="relative">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search tools…"
                className="h-8 text-[12px] pl-8"
              />
              <HugeiconsIcon
                icon={Search01Icon}
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {categories.map((cat) => {
                const isAll = cat === "All";
                const group = SETUP_GROUPS.find((g) => g.id === cat);
                return (
                  <button
                    type="button"
                    key={cat}
                    onClick={() => setActiveCategory(cat as typeof activeCategory)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors",
                      activeCategory === cat
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {isAll ? "All" : group?.title}
                  </button>
                );
              })}
              <div className="ml-auto flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="default"
                  onClick={installAll}
                  disabled={missingCount === 0 || loading}
                  className="h-7 text-[11px]"
                >
                  <HugeiconsIcon icon={ComputerTerminal02Icon} size={11} className="mr-1" />
                  Install all missing
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={check}
                  disabled={loading}
                  className="h-7 text-[11px]"
                >
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </DialogHeader>

        <div className="relative flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {filteredGroups.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={Search01Icon} size={32} className="opacity-40" />
                <p className="text-[13px]">No tools match your search</p>
              </div>
            ) : (
              <div className="space-y-8">
                {filteredGroups.map((group) => {
                  const groupMissing = group.tools.filter((t) => !installed.has(t.id));
                  return (
                    <section key={group.id} className="scroll-mt-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div
                            className={cn(
                              "flex size-7 items-center justify-center rounded-lg border",
                              group.style.bg,
                              group.style.border,
                            )}
                          >
                            <HugeiconsIcon icon={group.icon} size={14} className={group.style.text} />
                          </div>
                          <div>
                            <h3 className="text-[13px] font-semibold text-foreground">{group.title}</h3>
                            <p className="text-[11px] text-muted-foreground">{group.description}</p>
                          </div>
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
                            group={group}
                            platform={PLATFORM}
                            isInstalled={installed.has(tool.id)}
                            onCopyCommand={copyCommand}
                          />
                        ))}
                      </div>
                    </section>
                  );
                })}
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-border/50 px-6 py-3">
            {lastOp ? (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-[11px]",
                  lastOp.ok
                    ? "bg-emerald-500/10 text-emerald-500"
                    : "bg-amber-500/10 text-amber-500",
                )}
              >
                <HugeiconsIcon
                  icon={lastOp.ok ? CheckmarkCircle02Icon : ComputerTerminal02Icon}
                  size={12}
                />
                {lastOp.message}
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Tip: Copy a command and paste it into your terminal to install a tool. Detection runs automatically.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolCard({
  tool,
  group,
  platform,
  isInstalled,
  onCopyCommand,
}: {
  tool: ToolInfo;
  group: ToolGroup;
  platform: Platform;
  isInstalled: boolean;
  onCopyCommand: (tool: ToolInfo, platform: Platform) => void;
}) {
  const cmd = getCommand(tool, platform);
  const unsupported = cmd === null;

  return (
    <div
      className={cn(
        "group relative flex flex-col gap-2 rounded-xl border bg-card/40 p-4 transition-all",
        "hover:border-primary/30 hover:bg-card/60",
        isInstalled && "border-emerald-500/20 bg-emerald-500/5",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg border",
            group.style.bg,
            group.style.border,
          )}
        >
          <HugeiconsIcon icon={group.icon} size={18} className={group.style.text} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-foreground">{tool.name}</span>
            {isInstalled && (
              <HugeiconsIcon icon={CheckmarkCircle02Icon} size={13} className="shrink-0 text-emerald-500" />
            )}
            {unsupported && !isInstalled && (
              <span className="text-[9px] text-muted-foreground">Unsupported</span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-1">
        {tool.tags?.map((tag) => (
          <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {tag}
          </span>
        ))}
      </div>

      {!isInstalled && !unsupported && (
        <div className="flex flex-col gap-1.5 pt-1">
          <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2 py-1.5">
            <code className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {cmd}
            </code>
            <button
              type="button"
              onClick={() => onCopyCommand(tool, platform)}
              className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              title="Copy install command"
            >
              <HugeiconsIcon icon={Copy01Icon} size={11} />
            </button>
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
          <HugeiconsIcon icon={Settings02Icon} size={16} strokeWidth={1.75} className="text-primary" />
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

// Keep unused imports referenced to avoid removal
void GitCompareIcon;