import { useEffect, useState } from "react";
import { runInActiveTerminal } from "../ai/terminalContext";
import { detectInstalled } from "../tools";
import { toast } from "../toast";
import { Modal } from "../components/Modal";

type Tool = {
  id: string;
  /** Executable name to probe for on PATH. */
  bin: string;
  name: string;
  description: string;
  /** Homebrew install command. */
  install: string;
};

const TOOLS: Tool[] = [
  { id: "eza", bin: "eza", name: "eza", description: "A modern, colorful replacement for ls", install: "brew install eza" },
  { id: "bat", bin: "bat", name: "bat", description: "cat with syntax highlighting and git integration", install: "brew install bat" },
  { id: "ripgrep", bin: "rg", name: "ripgrep (rg)", description: "Extremely fast recursive search", install: "brew install ripgrep" },
  { id: "fd", bin: "fd", name: "fd", description: "A fast, user-friendly alternative to find", install: "brew install fd" },
  { id: "fzf", bin: "fzf", name: "fzf", description: "Command-line fuzzy finder", install: "brew install fzf" },
  { id: "zoxide", bin: "zoxide", name: "zoxide", description: "A smarter cd that learns your habits", install: "brew install zoxide" },
  { id: "delta", bin: "delta", name: "delta", description: "A syntax-highlighting pager for git diffs", install: "brew install git-delta" },
  { id: "jq", bin: "jq", name: "jq", description: "Command-line JSON processor", install: "brew install jq" },
  { id: "btop", bin: "btop", name: "btop", description: "Resource monitor with a rich TUI", install: "brew install btop" },
  { id: "tldr", bin: "tldr", name: "tldr", description: "Simplified, community-driven man pages", install: "brew install tldr" },
  { id: "gh", bin: "gh", name: "GitHub CLI", description: "GitHub from the command line", install: "brew install gh" },
  { id: "zellij", bin: "zellij", name: "zellij", description: "A terminal workspace and multiplexer", install: "brew install zellij" },
];

export function ToolsHubDialog({ onClose, inline }: { onClose?: () => void; inline?: boolean }) {
  const [installed, setInstalled] = useState<Set<string> | null>(null);

  useEffect(() => {
    let alive = true;
    void detectInstalled(TOOLS.map((t) => t.bin)).then((s) => {
      if (alive) setInstalled(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const install = (t: Tool) => {
    if (runInActiveTerminal(t.install)) {
      toast({ title: `Installing ${t.name}…`, variant: "info" });
      onClose?.();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <Modal title="Plugins" onClose={onClose} inline={inline}>
          <p className="rb-empty" style={{ margin: 0 }}>
            Popular CLI tools — “Install” runs the Homebrew command in the active terminal.
          </p>
          <div className="rb-list">
            {TOOLS.map((t) => {
              const isInstalled = installed?.has(t.bin) ?? false;
              return (
                <div key={t.id} className="rb-item">
                  <div className="rb-meta">
                    <span className="rb-name">
                      {t.name}
                      {isInstalled ? <span className="tool-installed">✓ installed</span> : null}
                    </span>
                    <span className="rb-steps">{t.description}</span>
                  </div>
                  <button
                    type="button"
                    className="ai-icon"
                    title={`Copy: ${t.install}`}
                    onClick={() => {
                      void navigator.clipboard.writeText(t.install);
                      toast({ title: "Copied install command", variant: "info" });
                    }}
                  >
                    ⧉
                  </button>
                  {!isInstalled ? (
                    <button type="button" className="rb-run" title="Install" onClick={() => install(t)}>
                      ▶
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
    </Modal>
  );
}
