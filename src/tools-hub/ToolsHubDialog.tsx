import { runInActiveTerminal } from "../ai/terminalContext";
import { toast } from "../toast";

type Tool = {
  id: string;
  name: string;
  description: string;
  /** Homebrew install command. */
  install: string;
};

const TOOLS: Tool[] = [
  { id: "eza", name: "eza", description: "A modern, colorful replacement for ls", install: "brew install eza" },
  { id: "bat", name: "bat", description: "cat with syntax highlighting and git integration", install: "brew install bat" },
  { id: "ripgrep", name: "ripgrep (rg)", description: "Extremely fast recursive search", install: "brew install ripgrep" },
  { id: "fd", name: "fd", description: "A fast, user-friendly alternative to find", install: "brew install fd" },
  { id: "fzf", name: "fzf", description: "Command-line fuzzy finder", install: "brew install fzf" },
  { id: "zoxide", name: "zoxide", description: "A smarter cd that learns your habits", install: "brew install zoxide" },
  { id: "delta", name: "delta", description: "A syntax-highlighting pager for git diffs", install: "brew install git-delta" },
  { id: "jq", name: "jq", description: "Command-line JSON processor", install: "brew install jq" },
  { id: "btop", name: "btop", description: "Resource monitor with a rich TUI", install: "brew install btop" },
  { id: "tldr", name: "tldr", description: "Simplified, community-driven man pages", install: "brew install tldr" },
  { id: "gh", name: "GitHub CLI", description: "GitHub from the command line", install: "brew install gh" },
  { id: "zellij", name: "zellij", description: "A terminal workspace and multiplexer", install: "brew install zellij" },
];

export function ToolsHubDialog({ onClose }: { onClose: () => void }) {
  const install = (t: Tool) => {
    if (runInActiveTerminal(t.install)) {
      toast({ title: `Installing ${t.name}…`, variant: "info" });
      onClose();
    } else {
      toast({ title: "No active terminal", variant: "error" });
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Tools" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Tools</span>
          <button type="button" className="ai-icon" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          <p className="rb-empty" style={{ margin: 0 }}>
            Popular CLI tools — “Install” runs the Homebrew command in the active terminal.
          </p>
          <div className="rb-list">
            {TOOLS.map((t) => (
              <div key={t.id} className="rb-item">
                <div className="rb-meta">
                  <span className="rb-name">{t.name}</span>
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
                <button type="button" className="rb-run" title="Install" onClick={() => install(t)}>
                  ▶
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
