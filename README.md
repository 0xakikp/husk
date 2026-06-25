# Husk

> The terminal-native IDE that brings your shell, editor, and AI into a single, seamless workspace. No browser tabs. No context switching. Just flow.

<p align="center">
  <img src="public/images/screenshot-terminal.png" alt="Husk Terminal" width="100%" />
</p>

---

## What is Husk?

Husk is a **desktop IDE built around the terminal**. Instead of treating the terminal as a second-class citizen tucked in a panel, Husk elevates it to the center of your workspace — and wraps it with a real code editor, native AI assistance, and deep shell integration that understands what you're doing.

- **Terminal-first** — Your terminal is always live, interactive, and context-aware. Run commands, review output, and ask AI about errors without leaving the app.
- **Inline AI** — Two AI interfaces: a floating bubble for quick terminal questions and a dedicated editor panel for code generation, refactoring, and review.
- **Real editor** — Full Monaco-based code editor with syntax highlighting, IntelliSense, Vim mode, file tree, tabs, and inline diff views.
- **Deep shell integration** — OSC 133 sequences track prompt boundaries, enabling click-to-edit on the current command line, automatic error detection, and AI-assisted debugging.

Built with [Tauri](https://tauri.app/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), and [Monaco Editor](https://microsoft.github.io/monaco-editor/).

---

## Features

### Terminal
- **Multi-tab terminal** — Draggable tabs with session restore and persistent scrollback
- **Pane splitting** — Split terminal tabs horizontally or vertically
- **Shell integration** — OSC 133 support for bash, zsh, fish, and PowerShell
- **Click-to-edit** — Click anywhere on the current command line to position the cursor (Warp-like behavior)
- **Command history** — Searchable history panel with fuzzy matching and highlight
- **Autocomplete bar** — Smart command suggestions as you type
- **Terminal themes** — Customizable color presets, font families, and background images with blur/dim controls
- **SSH remotes** — Connect to remote hosts directly from the sidebar with built-in SFTP
- **Port forwarding** — Forward remote ports locally without leaving the app
- **Bottom bar vitals** — Real-time context badges showing git branch, dirty state, docker status, background jobs, and system info

### Code Editor
- **Monaco Editor** — Full-featured editing with IntelliSense, go-to-definition, find/replace, and more
- **File explorer** — Tree view with create, rename, delete, drag-drop, and hidden file toggle
- **Tab system** — Open multiple files with drag-to-reorder, pin tabs, and color-coded status indicators
- **Vim mode** — Optional Vim keybindings via monaco-vim
- **Diff viewer** — Side-by-side and inline diff for comparing files or reviewing AI edits
- **Git integration** — Status bar branch indicator, source control panel, commit graph, history view, and issue tracking
- **Remote editing** — Edit files on SSH hosts directly in the Monaco editor

### AI Integration
- **Multiple providers** — OpenAI, Anthropic, Google Gemini, Azure OpenAI, and local models (Ollama, LM Studio)
- **Editor AI panel** — Right-side chat with workspace-scoped sessions, inline code edits with approval/reject flow, and file context awareness
- **Floating AI bubble** — Overlay chat for quick terminal questions with smart quick actions:
  - **Explain Error** — Find and explain the last terminal error
  - **Make Script** — Turn recent commands into a reusable shell script
  - **Summarize** — Recap recent terminal activity
  - **Find Issues** — Scan output for errors and warnings
  - **Suggest Command** — Describe a task, get a command suggestion you can insert, run, or copy
- **Vision support** — Attach images to prompts for models that support vision
- **Model Context Protocol (MCP)** — Browse and install MCP servers from the marketplace for extended AI capabilities
- **Codebase search** — AI-powered search across your workspace files

### DevOps & Tooling
- **Docker** — Container management, image lists, and status monitoring
- **Kubernetes** — Pod and deployment views with parallelized kubectl calls and loading states
- **Terraform** — Infrastructure state and plan visualization
- **CI/CD** — Pipeline status viewer for tracking builds and deployments
- **GitHub Issues** — View and manage issues from connected repositories
- **Jobs** — Background job tracking and management
- **Runbooks / Workflows** — Save and execute reusable command sequences
- **TOTP** — Built-in time-based one-time password manager for 2FA codes
- **Bookmarks** — Save frequently used commands, files, and directories for instant access
- **Cloud Sync** — Synchronize settings and data across devices

### Customization
- **Themes** — Dark/light mode with customizable accent colors
- **Background images** — Set custom wallpapers behind the terminal and editor with opacity, blur, and dim controls
- **AI panel styling** — Independent opacity, blur, dim, and font size controls for both the editor AI panel and floating bubble
- **Animations** — Toggle smooth transitions, frosted glass effects, and neon border glows
- **Fonts** — Choose from multiple monospace font families (JetBrains Mono, Fira Code, Cascadia Code, Space Grotesk, Source Code Pro, MesloLGS NF)
- **Tailwind v4** — Modern utility-first styling with CSS variables for theming

### Navigation & Productivity
- **Command palette** — Quick file switcher (`Ctrl/Cmd+P`) and AI command palette (`Ctrl/Cmd+Shift+P`)
- **Quick switcher** — Fuzzy-find files, commands, and actions instantly
- **Snippets** — Save and insert reusable code snippets
- **Clipboard manager** — History of copied items with quick access dropdown
- **Notes** — Built-in markdown notes panel for quick scratchpad usage
- **Tailscale** — Direct integration with Tailscale for secure remote access
- **Crash reporting** — Optional Sentry integration for automatic error tracking

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
| `Cmd/Ctrl + Shift + W` | Close terminal tab |
| `Cmd/Ctrl + T` | New terminal tab |
| `Cmd/Ctrl + Tab` | Next terminal tab |
| `Cmd/Ctrl + Shift + Tab` | Previous terminal tab |
| `Cmd/Ctrl + S` | Save current file |
| `Cmd/Ctrl + O` | Open file |
| `Cmd/Ctrl + Shift + A` | Toggle AI chat bubble |
| `Cmd/Ctrl + Shift + L` | Toggle AI chat bubble |
| `Ctrl + R` | Search terminal history |

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
- Click-to-edit on the command line

---

## Architecture

Husk is built as a modern desktop application using:

- **Frontend**: React 19 + TypeScript + Tailwind CSS v4 + Vite
- **Backend**: Tauri v2 (Rust) with custom native commands
- **Editor**: Monaco Editor with custom theme and Vim bindings
- **Terminal**: xterm.js with custom addons for OSC 133, search, and fit
- **AI**: AI SDK with support for multiple providers and MCP
- **State**: Zustand-style lightweight stores for UI state
- **File System**: Tauri FS API with SSH/SFTP support for remote files

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
