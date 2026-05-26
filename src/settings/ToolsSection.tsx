import { cn } from "@/lib/utils";
import {
  CheckmarkCircle02Icon,
  Copy01Icon,
  DownloadCircle01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useCallback, useEffect, useState } from "react";
import { detectInstalled } from "@/tools";
import { SectionHeader } from "./components/SectionHeader";

type ToolInfo = {
  id: string;
  name: string;
  description: string;
  installCommand: string;
};

const TOOLS: ToolInfo[] = [
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
  {
    id: "jq",
    name: "jq",
    description: "Lightweight command-line JSON processor.",
    installCommand: "brew install jq",
  },
  {
    id: "btop",
    name: "btop",
    description: "Beautiful colorful system monitor with graphs, process tree, and network stats. Replaces top.",
    installCommand: "brew install btop",
  },
  {
    id: "eza",
    name: "eza",
    description: "Modern ls replacement with icons and git integration.",
    installCommand: "brew install eza",
  },
  {
    id: "ripgrep",
    name: "ripgrep",
    description: "Blazing fast recursive search with smart defaults.",
    installCommand: "brew install ripgrep",
  },
  {
    id: "bat",
    name: "bat",
    description: "Syntax-highlighting cat replacement with git integration.",
    installCommand: "brew install bat",
  },
  {
    id: "tldr",
    name: "tldr",
    description: "Simplified community-driven man pages with practical examples.",
    installCommand: "brew install tldr",
  },
  {
    id: "zoxide",
    name: "zoxide",
    description: "Smarter cd — remembers your most used directories.",
    installCommand: "brew install zoxide",
  },
  {
    id: "zellij",
    name: "zellij",
    description: "Terminal workspace with panes, tabs, and layouts — alternative to tmux.",
    installCommand: "brew install zellij",
  },
];

export function ToolsSection() {
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  const check = useCallback(async () => {
    setLoading(true);
    const detected = await detectInstalled(TOOLS.map((t) => t.id));
    setInstalled(detected);
    setLoading(false);
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        title="Recommended Tools"
        description="Extra CLI tools that enhance the terminal experience."
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {TOOLS.map((tool) => (
          <ToolCard
            key={tool.id}
            tool={tool}
            isInstalled={installed.has(tool.id)}
            loading={loading}
          />
        ))}
      </div>
    </div>
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
        "flex flex-col gap-2.5 rounded-xl border p-4 transition-colors",
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
                "text-[13px] font-semibold",
                isInstalled ? "text-emerald-500" : "text-foreground",
              )}
            >
              {tool.name}
            </span>
            {isInstalled && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-500">
                <HugeiconsIcon icon={CheckmarkCircle02Icon} size={10} />
                Installed
              </span>
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {tool.description}
          </p>
        </div>
        {!isInstalled && !loading && (
          <HugeiconsIcon
            icon={DownloadCircle01Icon}
            size={18}
            className="mt-0.5 shrink-0 text-muted-foreground/50"
          />
        )}
      </div>

      {!isInstalled && (
        <div className="flex flex-col gap-1.5">
          {showCommand ? (
            <div className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2.5 py-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
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
                    size={12}
                    className="text-emerald-500"
                  />
                ) : (
                  <HugeiconsIcon icon={Copy01Icon} size={12} />
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowCommand(true)}
              className="self-start text-[11px] text-emerald-500 underline-offset-2 hover:underline"
            >
              Show install command
            </button>
          )}
        </div>
      )}
    </div>
  );
}
