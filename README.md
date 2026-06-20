# Husk

> A terminal-centric IDE with built-in AI, a code editor, and deep shell integration. Husk brings your terminal, editor, and AI assistant into a single, cohesive workspace — no context switching required.

Built with [Tauri](https://tauri.app/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Monaco Editor](https://microsoft.github.io/monaco-editor/).

---

## What is Husk?

Husk is a desktop application that reimagines the developer workspace. Instead of juggling a separate terminal, code editor, and browser-based AI chat, Husk unifies all three:

- **Terminal-first** — Your terminal is always visible and interactive. Run commands, review output, and ask the AI about what you see without leaving the app.
- **Inline AI** — Two AI chat interfaces: a floating bubble for quick terminal questions and a dedicated editor panel for code refactoring, generation, and review.
- **Real editor** — Full Monaco-based code editor with syntax highlighting, Vim mode, file tree, tabs, and inline diff views.
- **Deep shell integration** — OSC 133 sequences track prompt boundaries, enabling features like click-to-edit on the current command line and automatic error detection.

---

## Features

### Terminal
- **Multi-tab terminal** with draggable tabs and session restore
- **Pane splitting** — Split terminal tabs horizontally or vertically
- **Shell integration** — OSC 133 support for bash, zsh, fish, and PowerShell
- **Click-to-edit** — Click anywhere on the current command line to position the cursor (Warp-like behavior)
- **Command history** — Searchable history panel
- **Terminal themes** — Customizable color presets and font settings
- **SSH remotes** — Connect to remote hosts directly from the sidebar
- **Bottom bar vitals** — Real-time terminal context badges and environment info

### Code Editor
- **Monaco Editor** — Full-featured editing with IntelliSense, go-to-definition, and more
- **File explorer** — Tree view with create, rename, delete, and hidden file toggle
- **Tab system** — Open multiple files with drag-to-reorder and color-coded tabs
- **Vim mode** — Optional Vim keybindings
- **Diff viewer** — Side-by-side and inline diff for comparing files or reviewing AI edits
- **Git integration** — Status bar branch indicator, source control panel, commit graph, and history view

### AI Integration
- **Multiple providers** — OpenAI, Anthropic, Google Gemini, Azure OpenAI, and local models (Ollama, LM Studio)
- **Editor AI panel** — Right-side chat with workspace-scoped sessions, inline code edits with approval/reject flow, and file context awareness
- **Floating AI bubble** — Overlay chat for quick terminal questions with quick actions:
  - Explain Error — Find and explain the last terminal error
  - Make Script — Turn recent commands into a reusable shell script
  - Summarize — Recap recent terminal activity
  - Find Issues — Scan output for errors and warnings
- **Vision support** — Attach images to prompts for models that support vision
- **Model Context Protocol (MCP)** — Browse and install MCP servers from the marketplace

### Customization
- **Themes** — Dark/light mode with customizable accent colors
- **Background images** — Set custom wallpapers behind the terminal and editor with opacity, blur, and dim controls
- **AI panel styling** — Independent opacity, blur, dim, and font size controls for both the editor AI panel and floating bubble
- **Animations** — Toggle smooth transitions, frosted glass effects, and neon border glows
- **Fonts** — Choose from multiple monospace font families (JetBrains Mono, Fira Code, Cascadia Code, MesloLGS NF)

### Additional Tools
- **Command palette** — Quick file switcher and command runner
- **Snippets** — Save and insert reusable code snippets
- **TOTP** — Time-based one-time password manager
- **Docker & Kubernetes** — Basic container and pod management views
- **CI/CD** — Pipeline status viewer
- **Terraform** — Infrastructure view support

---

## Screenshots

### Terminal with File Explorer and Background Image

The main workspace with the file explorer sidebar, multi-tab terminal, and a custom background image with configurable blur and dim overlay.

![Husk Terminal](public/images/screenshot-terminal.png)

### AI Floating Bubble

The floating AI chat bubble that appears over the terminal for quick questions. Features quick actions for explaining errors, summarizing output, and more.

![Husk AI Floating Bubble](public/images/screenshot-bubble.png)

### Editor with AI Panel

The Monaco-based code editor alongside the AI panel. The AI panel provides context-aware chat with workspace-scoped sessions and inline code edit suggestions.

![Husk Editor with AI](public/images/screenshot-editor.png)

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or later)
- [pnpm](https://pnpm.io/) (v9 or later)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- macOS, Linux, or Windows

### Installation

```bash
# Clone the repository
git clone https://github.com/0xakikp/husk.git
cd husk

# Install dependencies
pnpm install

# Install Tauri CLI (if not already installed)
cargo install tauri-cli
```

### Development

```bash
# Start the dev server with hot reload
pnpm tauri dev
```

This will launch the Vite dev server and the Tauri application window.

### Building

```bash
# Build for production
pnpm tauri build
```

The compiled application will be available in `src-tauri/target/release/bundle/`.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl + 1-9` | Switch to terminal/file tab by index |
| `Cmd/Ctrl + P` | Open command palette / quick switcher |
| `Cmd/Ctrl + Shift + P` | Open AI command palette |
| `Cmd/Ctrl + ,` | Open settings |
| `Cmd/Ctrl + W` | Close active tab |
| `Cmd/Ctrl + T` | New terminal tab |
| `Cmd/Ctrl + S` | Save current file |

*Full shortcuts list available in-app via Settings → Shortcuts.*

---

## AI Providers

Husk supports multiple AI providers out of the box:

| Provider | Setup |
|----------|-------|
| OpenAI | Add your API key in Settings → Models |
| Anthropic (Claude) | Add your API key in Settings → Models |
| Google (Gemini) | Add your API key in Settings → Models |
| Azure OpenAI | Configure endpoint and API key |
| Local (Ollama / LM Studio) | Run locally and configure base URL |

---

## Terminal Shell Integration

Husk automatically installs shell integration scripts on first launch. Supported shells:

- **Bash** — `~/.cache/huskv2/shell-integration/bash/bashrc`
- **Zsh** — `~/.cache/huskv2/shell-integration/zsh/`
- **Fish** — `~/.cache/huskv2/shell-integration/fish/init.fish`
- **PowerShell** — `~/.cache/huskv2/shell-integration/powershell/profile.ps1`

These scripts emit OSC 133 sequences that enable:
- Prompt boundary tracking
- Current command detection
- Exit code reporting
- Automatic AI error assistance

---

## Contributing

We welcome contributions! Please see [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

Quick start:
1. Fork the repository
2. Create a branch from `main`: `git checkout -b feat/your-feature`
3. Make your changes and test with `pnpm tauri dev`
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
5. Open a Pull Request

---

## License

This project is licensed under the [MIT License](LICENSE).
