# Husk

<p align="center">
  <img src="public/logo.png" alt="Husk logo" width="88" />
</p>

<p align="center">
  <strong>A terminal-native workspace for code, context, and calm focus.</strong><br />
  Keep your shell, editor, AI, notes, and operational tools in one place.
</p>

---

Husk is a desktop workspace built for people who spend their day close to a terminal. It does not treat the shell as an afterthought beneath an editor: the terminal is the centre of the application, with the surrounding tools there when they help and out of the way when they do not.

Open a folder, run a command, inspect its output, edit a file, ask a focused question, save a note, or check an integration—without turning your work into a trail of browser tabs and disconnected windows.

## Why Husk

Most developer tools make you choose a primary surface: an editor with a hidden terminal, a terminal with a few panes, or an AI chat that has no real awareness of your working environment. Husk is designed as one workspace instead.

- **The terminal stays first-class.** Tabs, pane splits, searchable history, command context, and live output are part of the main flow.
- **AI belongs beside the work.** It can use the context you deliberately attach, explain terminal output, work with workspace files when permitted, and guide people through Husk itself.
- **The workspace remains yours.** Preferences, project memory, notes, and connection setup are local by default; every powerful integration is visible and configurable.
- **The interface stays quiet.** Husk favours a compact, keyboard-first, terminal-native visual language over a dashboard full of decorative cards.

## What you can do

### Work from the terminal without losing context

- Run multiple terminal tabs, split a tab into panes, and restore sessions and working directories between launches.
- Use shell integration to understand command boundaries, current working directory, exit status, and recent command output.
- Search terminal history and terminal output, get command suggestions, and ask AI to explain a failure or propose a command.
- Open **Beautiful Logs** from `⌘/Ctrl K`: formatted live terminal output appears in a lower inspector split, with filters for all, info, warnings, and errors. It is a focused view of the active terminal—not an endless, separate log archive.
- Read the bottom bar at a glance: current command state, workspace folder, Git branch and status, CPU, memory, system load, battery, and clock.

### Keep code and workspace tools close

- Browse files, open and pin editor tabs, and work in a Monaco-based code editor with find/replace, syntax support, Vim mode, minimap, sticky scroll, line controls, and configurable typography.
- Review diffs and proposed changes without leaving the workspace.
- Use Source Control, workspace bookmarks, clipboard history, quick switching, and the `⌘/Ctrl K` command palette to move through work quickly.
- Store Markdown notes in the **Vault**. Recently opened notes and folders are easy to scan, while the rail stays compact enough to leave open.
- Connect saved SSH hosts, browse with SFTP, and configure port forwarding from the same workspace.

### Use AI with clear boundaries

Husk AI is available as a docked terminal composer and as a dedicated full-screen AI workspace with named sessions. It can include the active terminal, the current file, a selection, attachments, or a particular command result—only when those context chips are enabled.

Every normal Husk AI conversation receives the same product-aware context. This means the selected agent can explain Husk features, point to the right settings area, describe the current model mode accurately, and answer “who are you?” as a Husk AI persona rather than as an anonymous generic chatbot.

Choose the access mode that fits your workflow:

| Mode | Best for | What it can do in Husk |
| --- | --- | --- |
| **API-backed model** | Full workspace assistance | Chat, scoped file tools when enabled, and configured MCP integrations. |
| **Signed-in CLI subscription** | Using an existing CLI plan | Chat, code questions, terminal help, and command suggestions without an API key. It cannot directly call Husk file tools or MCP integrations, but can return guarded workspace-edit proposals when you explicitly enable them. |

Signed-in CLI modes are available for Claude Code, Codex, Gemini CLI, and Kimi Code. API-backed providers include OpenAI, Anthropic, Google, Groq, DeepSeek, OpenRouter, xAI, Mistral, Moonshot, and compatible local endpoints such as LM Studio or Ollama. The configured provider, model, and access mode are always visible in the AI interface.

#### Workspace scope and safe subscription edits

Each AI chat can be given its own workspace folder from the composer header. This is a deliberate per-chat boundary: terminal-originated chats begin with that terminal’s current workspace, while a general chat stays unscoped until you choose a folder. API file tools and selected context stay inside that folder.

For a signed-in CLI subscription, enabling **Reviewable workspace edits** lets the model return structured file-change proposals rather than writing directly. Husk validates the path again in the native layer, renders a compact diff, and lets you apply or discard every change. You can also enable **Auto-apply safe proposals** for the current chat session: Husk considers only small batches of source changes and keeps secrets, configuration, dependency locks, generated output, and protected folders in manual review. Applied subscription changes stay visible below the composer and can be undone while the file remains unchanged.

#### AI that adapts to the person and project

- Select a built-in persona—such as Code, Debug, Architect, or Ask—or create a custom agent with its own instructions.
- Set global instructions, response style, personal memory, default context attachments, and file/MCP tool access in **Settings → Agents**.
- Give an agent an optional model override while retaining a global model default.
- Add workspace-specific project memory for a stack, conventions, or constraints that should follow that project.
- Set an optional display name during first-run setup or later in Settings. It is stored locally and only included with normal AI conversations when set, so replies can be personal without becoming repetitive.

### Connect the tools around your work

- Add custom MCP servers in **Settings → Integrations** without leaving the settings workspace.
- Connect GitHub MCP with a personal access token stored in the OS keychain; start read-only and enable broader access only when you intend to.
- Use Docker, Kubernetes, Terraform, CI/CD, Tailscale, workflows, jobs, bookmarks, and an authenticator from dedicated workspace views where those tools are configured.
- Install and manage command-line helpers through the setup assistant instead of hunting for install commands yourself.

### Make the workspace feel like yours

Husk’s first-run defaults are deliberately opinionated: Iosevka typography, the Husk terminal palette, a frosted workspace, 11px panel gaps, subtle shadows, active-panel glow, neon borders, and a softened AI composer. Every part is adjustable later.

- Switch terminal theme, font, cursor behaviour, scrollback, editor preferences, and Vim controls.
- Choose wallpapers, folder-based wallpaper cycling, opacity, blur, and background fit.
- Tune panel gaps, animations, frosted glass, shadows, active glow, neon borders, and AI composer appearance independently.
- Start from the **HUSK / READY** boot screen on a clean install, then revisit it any time through `⌘/Ctrl K` → **Welcome to Husk**.

## First five minutes

1. Launch Husk and choose **Open folder** from the boot screen.
2. Open `⌘/Ctrl K` and try **Open beautiful logs**, **Open settings**, or a workspace search.
3. In **Settings → AI & Models**, select an API-backed provider or a signed-in CLI subscription mode.
4. In **Settings → Agents**, choose an agent, set a response style, and decide what context a new AI chat should attach.
5. In a Husk AI chat, choose a workspace folder from the header before attaching files or enabling reviewed subscription edits.
6. If you use integrations, add them in **Settings → Integrations**. Husk explains there when the selected model mode cannot use connected tools.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘/Ctrl K` | Open the command palette |
| `⌘/Ctrl B` | Toggle the sidebar |
| `⌘/Ctrl F` | Find in terminal output |
| `⌘/Ctrl T` | Create a terminal tab |
| `⌘/Ctrl Shift W` | Close a terminal tab |
| `⌘/Ctrl Tab` / `⌘/Ctrl Shift Tab` | Move to the next / previous tab |
| `⌘/Ctrl 1–9` | Switch to a tab by position |
| `⌘/Ctrl S` | Save the active editor file |
| `⌘/Ctrl Shift B` | Move to the next wallpaper in the chosen folder |
| `Esc` | Close the active dialog or search surface |

The in-app keyboard-shortcuts panel remains the source of truth as shortcuts evolve.

## Privacy and permissions

Husk makes the important boundaries explicit.

- API keys and integration secrets are stored in the operating system keychain rather than in project files.
- Your durable non-secret settings are written atomically to `~/.husk/config.toml`; the previous valid version is retained as `~/.husk/config.toml.bak` during an update.
- Custom agents and edits to built-in agents are readable Markdown files in `~/.husk/agents/`. The default Vault lives in `~/.husk/notes/` unless you choose another notes directory.
- These user-home files are kept when Husk is normally removed and reinstalled. Deleting `~/.husk/` deliberately removes them.
- Chat history, terminal session restoration, project memory, recents, and other transient workspace state remain local application data for now; they are not placed in the readable config or agent files.
- Terminal output, file contents, attachments, project memory, personal memory, and display name can be sent to the selected AI provider when included in an AI request. Review context chips before sending sensitive output.
- File and MCP tool access can be disabled in **Settings → Agents**. API file tools are restricted to the workspace selected by the current chat; the native layer checks the workspace boundary again, including symlink escapes.
- Signed-in CLI subscriptions never receive direct Husk write or MCP access. Their optional reviewed proposals must use a selected workspace. Auto-apply is off by default, lives only for the current app session and workspace, and leaves protected paths in manual review. Undo refuses to overwrite a file that changed after Husk’s edit.

## Run from source

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or later
- [pnpm](https://pnpm.io/) 9 or later
- [Rust](https://www.rust-lang.org/tools/install) stable, plus the platform dependencies required by Tauri

### Development

```bash
git clone https://github.com/0xakikp/husk.git
cd husk
pnpm install
pnpm tauri dev
```

### Production build

```bash
pnpm tauri build
```

The platform bundle is written beneath `src-tauri/target/release/bundle/`.

## Technical overview

Husk is a desktop application built with React, TypeScript, Vite, Tauri, Monaco Editor, xterm.js, and the AI SDK. The technical stack supports the product; the intended experience is a fast, local workspace that keeps terminals, files, AI, and operational tooling in one coherent place.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md), create a focused branch from `main`, test with `pnpm tauri dev`, and use Conventional Commit messages where practical.

## License

[MIT](LICENSE)
