# Husk Terminal App — Comprehensive Feature Audit

> **Purpose:** Living document tracking every feature, function, and behavior.
> **Rule:** Update this file after any commit that adds, removes, or modifies features.
> **Audit trigger:** Run before/after major refactors to detect regressions.
> **Last updated:** 2026-06-19

---

## Table of Contents

1. [Application Shell](#1-application-shell)
2. [Terminal Core](#2-terminal-core)
3. [Pane System](#3-pane-system)
4. [Tab System](#4-tab-system)
5. [AI Integration](#5-ai-integration)
6. [Settings & Preferences](#6-settings--preferences)
7. [Editor](#7-editor)
8. [File Explorer](#8-file-explorer)
9. [Git Integration](#9-git-integration)
10. [SFTP / Remote Connections](#10-sftp--remote-connections)
11. [Command Palette](#11-command-palette)
12. [Bridge Commands (OSC 777)](#12-bridge-commands-osc-777)
13. [Docker Integration](#13-docker-integration)
14. [Kubernetes Integration](#14-kubernetes-integration)
15. [Terraform Integration](#15-terraform-integration)
16. [CI/CD Integration](#16-cicd-integration)
17. [Snippets](#17-snippets)
18. [TOTP / 2FA](#18-totp--2fa)
19. [Clipboard Manager](#19-clipboard-manager)
20. [Jobs / Processes](#20-jobs--processes)
21. [MCP (Model Context Protocol)](#21-mcp-model-context-protocol)
22. [Tools Hub](#22-tools-hub)
23. [Updater](#23-updater)
24. [Shortcuts & Key Bindings](#24-shortcuts--key-bindings)
25. [UI Components](#25-ui-components)
26. [System Vitals](#26-system-vitals)
27. [Session Persistence](#27-session-persistence)
28. [Registry Architecture](#28-registry-architecture)

---

## 1. Application Shell

### 1.1 Layout
- [x] **Title bar** — macOS-style traffic light buttons (close/minimize/maximize)
- [x] **Tab bar** — horizontal tab strip with active indicator
- [x] **Toolbar** — action icons (new tab, split, refresh, etc.)
- [x] **Sidebar** — collapsible file explorer (left)
- [x] **Main area** — terminal/editor panels
- [x] **Status bar** — system info, vitals, path (bottom)
- [x] **Background image** — optional blurred background (dark mode only)
- [x] **Panel gaps** — configurable spacing between panels
- [x] **Frosted glass effect** — optional blur on panels
- [x] **Neon border glow** — optional glow effect on active panel
- [x] **Panel shadows** — optional drop shadows
- [x] **Active panel glow** — highlight on focused panel

### 1.2 Theme System
- [x] **Dark/Light toggle** — sun/moon icon in top bar
- [x] **Accent color** — customizable (presets + custom picker)
- [x] **Custom CSS** — user-defined stylesheet injection
- [x] **Zoom level** — Cmd/Ctrl+Plus/Minus/Zero
- [x] **Animations** — toggle on/off

### 1.3 Window Management
- [x] **Tauri window controls** — native frame or custom
- [x] **Window focus tracking** — `windowFocus.ts`
- [x] **Welcome dialog** — first-run experience
- [x] **Settings window** — separate settings dialog

---

## 2. Terminal Core

### 2.1 PTY Lifecycle (Rust Backend)
- [x] `pty_spawn` — creates Rust PTY with cols/rows/cwd
- [x] `pty_kill` — destroys PTY process
- [x] `pty_write` — sends data to PTY stdin
- [x] `pty_resize` — SIGWINCH on col/row change
- [x] `pty://data/{id}` — Tauri event listener for PTY stdout
- [x] `pty://exit/{id}` — Tauri event listener for process exit
- [x] PTY survives React remounts (registry pattern)
- [x] PTY disposed only on actual pane/tab close
- [x] **Session ID generation** — unique ID per leaf
- [x] **CWD tracking** — current working directory via OSC 7

### 2.2 xterm.js Integration
- [x] Terminal creation with preferences (font, size, cursor, theme, scrollback)
- [x] `FitAddon` — auto-resize to container
- [x] `SearchAddon` — find in terminal
- [x] `allowProposedApi: true` — enables OSC handlers
- [x] `allowTransparency: true` — for background images
- [x] **DOM parking on detach** — preserves buffer across remounts
- [x] **Resize debounce** — 150ms timeout + 500ms max-wait interval
- [x] `scrollToBottom()` after fit
- [x] **Deduplicated resize** — lastCols/lastRows tracking
- [x] **Font family** — configurable (monospace fallback)
- [x] **Cursor blink** — configurable
- [x] **Cursor style** — block/line/bar
- [x] **Scrollback** — configurable lines
- [x] **Theme preset** — multiple built-in themes

### 2.3 OSC Handlers
- [x] **OSC 7** — working directory tracking (`file://host/path`)
- [x] **OSC 133** — shell integration (A=prompt start, B=prompt end, C=preexec, D=exit code)
- [x] **OSC 778** — command text capture (`husk;cmd;...`)
- [x] **OSC 777** — bridge commands (open/preview/notify/diff)
- [x] **OSC 133;A** — prompt start marker
- [x] **OSC 133;B** — prompt end marker
- [x] **OSC 133;C** — preexec (command start)
- [x] **OSC 133;D** — exit code (command end)

### 2.4 Key Bindings (Terminal)
- [x] `Cmd/Ctrl + F` — open find-in-terminal
- [x] `Ctrl + R` — open history picker (intercepted, not shell reverse-i-search)
- [x] `Cmd/Ctrl + C` — copy selection to clipboard
- [x] `Cmd/Ctrl + V` — paste from clipboard
- [x] `Cmd + D` — split right
- [x] `Cmd + Shift + D` — split down
- [x] `Cmd + Alt + Arrow` — navigate focus between panes
- [x] `Tab` — accept autocomplete suggestion
- [x] `ArrowUp/Down` — navigate autocomplete suggestions
- [x] `Escape` — dismiss autocomplete
- [x] `Ctrl + L` — clear terminal (shell integration)

### 2.5 Context Menu (Right-click on Terminal)
- [x] **Copy** — copy selection
- [x] **Paste** — paste from clipboard
- [x] **Select all** — select entire buffer
- [x] **Clear** — clear terminal
- [x] **Find…** — open search bar
- [x] **History…** — open history panel
- [x] **Split right** — create new pane right
- [x] **Split down** — create new pane below
- [x] **Close pane** — close current pane (when multi-pane)

### 2.6 Click-to-Position
- [x] Click in command area → move cursor via arrow sequences
- [x] Hover → text cursor indicator
- [x] Respects selection (doesn't clear if selecting)
- [x] Respects running commands (no-op while command running)

### 2.7 Autocomplete System
- [x] **History-based suggestions** — from shell history (sqlite)
- [x] **Trigger** — on every keystroke (50ms debounce)
- [x] **Positioning** — at cursor location
- [x] **Visibility** — only at end of input, on prompt line
- [x] **Tab to accept** — insert suggestion
- [x] **ArrowUp/Down to navigate** — cycle suggestions
- [x] **Escape to dismiss** — hide dropdown
- [x] **Visual indicator** — green checkmark when valid
- [x] **State management** — `useAutocomplete` hook

### 2.8 Search System
- [x] **Inline search bar** — `term-search` CSS class
- [x] `findNext` / `findPrevious` — with `incremental: true`
- [x] `clearDecorations` — on close
- [x] **Enter** — findNext
- [x] **Shift+Enter** — findPrevious
- [x] **Escape** — close search
- [x] **Case sensitivity** — optional
- [x] **Regex support** — optional

### 2.9 History Panel
- [x] **Fetches from shell history** — sqlite database
- [x] **Loading state** — spinner while loading
- [x] **Click to inject** — command at prompt
- [x] **Close button** — dismiss panel
- [x] **Search/filter** — filter history items
- [x] **Time grouping** — grouped by date

### 2.10 Terminal Bottom Bar
- [x] **Command info** — current command display
- [x] **Exit code** — last command status
- [x] **CWD display** — current directory
- [x] **Typing indicator** — shows when typing
- [x] **AI status** — AI thinking indicator

---

## 3. Pane System

### 3.1 Tree Structure
- [x] **Binary tree** — leaves = terminals, splits = row/col dividers
- [x] **Unique leaf IDs** — auto-increment `paneSeq`
- [x] **Focused leaf tracking** — `focusedId` per tab
- [x] **Tab active flag** — `tabActive` boolean
- [x] **Pane types** — `leaf` | `split` (row/col)

### 3.2 Splitting
- [x] **Split right** — horizontal split (row direction)
- [x] **Split down** — vertical split (col direction)
- [x] **New leaf inherits cwd** — from parent terminal
- [x] **New leaf gets focus** — automatically focused
- [x] **Original leaf preserves content** — DOM parking
- [x] **Ratio tracking** — split position (0.0-1.0)

### 3.3 Closing
- [x] **Close button (×)** — on pane hover (visible only when multi-pane)
- [x] **Right-click "Close pane"** — context menu option
- [x] **Cannot close last pane** — single pane protected
- [x] **Parent split collapses** — to sibling on close

### 3.4 Focus Navigation
- [x] `Cmd+Alt+Arrow` — directional focus (left/right/up/down)
- [x] **Click to focus** — mouse focus
- [x] **Focus follows active tab** — tab switch = focus update
- [x] **Focus indicator** — visual border on focused pane

### 3.5 Resize
- [x] **Drag dividers** — col-resize / row-resize cursors
- [x] **Min size enforcement** — 100px minimum
- [x] **ResizeObserver** — on each pane container
- [x] **Ratio persistence** — saved in pane tree
- [x] **Recursive resize** — updates all children

### 3.6 Pane Utilities
- [x] `newLeaf()` — create new leaf node
- [x] `splitPane()` — split a leaf into two
- [x] `removePane()` — remove leaf, collapse parent
- [x] `setRatio()` — update split ratio
- [x] `firstLeaf()` — get first leaf ID
- [x] `leafCount()` — count leaves in tree
- [x] `leafIds()` — get all leaf IDs

---

## 4. Tab System

### 4.1 Tab Management
- [x] **New tab** — `+` button in tab bar
- [x] **Close tab** — × on tab (hover)
- [x] **Tab title** — from shell cwd (auto-updating)
- [x] **Active tab indicator** — green underline/background
- [x] **Tab color** — user-assignable colors
- [x] **Rename tab** — double-click to edit
- [x] **Tab count** — unlimited (practical limit)

### 4.2 Tab State
- [x] **Tab ID** — unique number
- [x] **Title** — auto or manual
- [x] **Root pane** — binary tree of panes
- [x] **Focused leaf** — which pane has focus
- [x] **Renamed flag** — manual title set
- [x] **Color** — visual grouping
- [x] **SFTP host** — per-tab remote connection
- [x] **SFTP open** — whether SFTP panel is visible

### 4.3 Tab Switching
- [x] **Click tab** — switch to tab
- [x] `Ctrl+Tab` — next tab
- [x] `Ctrl+Shift+Tab` — previous tab
- [x] `Cmd+1-9` — jump to tab by index
- [x] **Quick switcher** — fuzzy find tabs
- [x] **SFTP restoration** — restores SFTP view on switch back

### 4.4 Tab Persistence
- [x] **Session save** — on quit
- [x] **Session restore** — on launch (if enabled)
- [x] **CWD preservation** — restore working directory
- [x] **Title preservation** — manual titles restored
- [x] **Color preservation** — tab colors restored
- [x] **SFTP state** — host and open state restored
- [x] **Pane tree** — full pane structure restored

---

## 5. AI Integration

### 5.1 Terminal Context APIs
- [x] `setActiveTerminalReader` — buffer content (8KB cap, bottom-up)
- [x] `setActiveTerminalRunner` — inject command + Enter
- [x] `setActiveTerminalTyper` — inject text without Enter
- [x] `setActiveTerminalSearchOpener` — open find dialog
- [x] `setActiveTerminalSearcher` — run search with query
- [x] `setActiveTerminalCwd` — current directory tracking
- [x] `setActiveTerminalExit` — last command exit code
- [x] `setTerminalTyping` — typing indicator (400ms debounce)
- [x] `setCurrentCommand` / `clearCurrentCommand` — command tracking
- [x] `markCommandStart` — preexec hook
- [x] `setPromptPosition` / `getPromptPosition` — prompt cursor position
- [x] `isCommandRunning` — command execution state
- [x] `useTerminalContextSize` — context size management

### 5.2 AI Input Interception
- [x] `/ai` command interception — routes to AI
- [x] `setTerminalLineReader` — reads current line
- [x] `setAiPtyWriter` — writes AI output to PTY
- [x] `interceptTerminalInput` — filters/swallows input
- [x] `terminalInput.ts` — input handling utilities

### 5.3 AI Floating Bubble
- [x] **Toggle visibility** — show/hide bubble
- [x] **Opacity setting** — configurable transparency
- [x] **Font size** — independent from terminal
- [x] **Background image** — optional
- [x] **BG blur** — configurable
- [x] **BG dim** — darkening
- [x] **BG opacity** — background transparency
- [x] **Session store** — per-tab chat history
- [x] **Chat interface** — message input/output
- [x] **Attached files** — file context
- [x] **Thinking indicator** — AI processing state

### 5.4 AI Agents
- [x] **Agent system** — configurable AI personas
- [x] `getActiveAgent()` — current agent
- [x] `setActiveAgent()` — switch agent
- [x] `useAgents()` — list all agents
- [x] **DEFAULT_AGENT** — fallback agent

### 5.5 AI Assist Dialogs
- [x] **SuggestDialog** — command suggestion
- [x] **ExplainDialog** — error explanation
- [x] **Toast on failure** — command error notification
- [x] **"Explain" button** — opens AI with error context
- [x] `terminalAiErrorAssist` — preference toggle

### 5.6 AI Client
- [x] **streamChat** — streaming chat API
- [x] **generateOnce** — single response
- [x] **ChatMessage** — message type
- [x] **ChatConfig** — configuration
- [x] **Provider support** — multiple AI providers

### 5.7 AI Models
- [x] **Model registry** — `MODELS` array
- [x] **ModelInfo** — model metadata
- [x] **Provider-specific models** — grouped by provider
- [x] **Local models** — Ollama/local support
- [x] **Model selection** — UI picker

### 5.8 AI Store
- [x] **Bubble store** — global bubble state
- [x] **Editor store** — AI editor integration
- [x] **Pending edits** — queued AI edits
- [x] **Codebase search** — indexed codebase search

### 5.9 AI Tools
- [x] **Builtin tools** — `buildBuiltinTools()`
- [x] **Tool merging** — `mergeTools()`
- [x] **Tool definitions** — OpenAI-compatible

---

## 6. Settings & Preferences

### 6.1 Settings Page Sections
- [x] **About (Manifest)** — version, build, links, updater
- [x] **General** — AI toggle, Editor, Explorer, Terminal
- [x] **Appearance** — Background, Accent, Effects, Layout, Custom CSS, AI Bubble
- [x] **Models** — Provider selection, API keys, Local models
- [x] **MCP** — Server management, marketplace
- [x] **Tools** — Recommended CLI tools

### 6.2 Editor Preferences (all wired)
- [x] **Vim mode** — Monaco vim emulation
- [x] **Cursor blink** — toggle
- [x] **Minimap** — code overview
- [x] **Sticky scroll** — context lines
- [x] **Font size** — configurable
- [x] **Tab size** — spaces per tab
- [x] **Word wrap** — on/off
- [x] **Cursor style** — line/block/underline
- [x] **Line highlight** — current line
- [x] **Line numbers** — on/off/relative
- [x] **Whitespace** — none/boundary/all
- [x] **Ligatures** — font ligatures
- [x] **Bracket colors** — rainbow brackets
- [x] **Smooth scroll** — animated scrolling
- [x] **Format on paste** — auto-format

### 6.3 Terminal Preferences (all wired)
- [x] **Cursor blink** — toggle
- [x] **Font size** — configurable
- [x] **Scrollback** — line count
- [x] **Cursor style** — block/line/bar
- [x] **Theme preset** — multiple themes
- [x] **Font family** — monospace selection
- [x] **Error assistance** — AI error help

### 6.4 Appearance Preferences (all wired)
- [x] **Background image** — pick/clear/opacity/blur/dim
- [x] **Accent color** — presets + custom picker
- [x] **Animations** — toggle
- [x] **Frosted glass** — blur effect
- [x] **Neon border glow** — glow effect
- [x] **Panel gaps** — spacing
- [x] **Gap style** — none/dots/grid/cross/gradient
- [x] **Panel shadows** — drop shadows
- [x] **Active panel glow** — focus highlight
- [x] **Editor wallpaper opacity** — editor background
- [x] **Custom CSS** — textarea for user styles
- [x] **AI bubble** — opacity, font size, BG blur, BG dim, BG opacity, BG image

### 6.5 App Preferences (wired, not all in settings UI)
- [x] **Theme** — topbar toggle (sun/moon)
- [x] **Zoom level** — Cmd+Plus/Minus/Zero
- [x] `hasSeenWelcome` — welcome dialog flag
- [x] **Session restore** — on/off
- [x] **Show hidden files** — explorer toggle

### 6.6 Preference Storage
- [x] **LocalStorage** — persistent storage
- [x] **Type-safe** — TypeScript interfaces
- [x] **Defaults** — sensible defaults
- [x] **Migration** — version handling

---

## 7. Editor

### 7.1 Monaco Integration
- [x] **Monaco editor** — full VS Code editor
- [x] **Theme sync** — matches app theme
- [x] **Vim mode** — via `vimMode` pref
- [x] **All preferences applied** — live updates
- [x] **Language detection** — from file extension
- [x] **Syntax highlighting** — language-specific

### 7.2 Editor Area
- [x] **Tabbed editor** — multiple files
- [x] **File tabs** — path + name
- [x] **Active file** — current editing
- [x] **Close file** — × on tab
- [x] **Dirty indicator** — unsaved changes
- [x] **Auto-save** — optional

### 7.3 Editor Store
- [x] **Dirty tracking** — `dirtyStore.ts`
- [x] **Apply AI edit** — `registerEditorApplyEdit()`
- [x] **Get selection** — `registerEditorGetSelection()`
- [x] **Get file** — `registerEditorFile()`

---

## 8. File Explorer

### 8.1 Tree View
- [x] **Show hidden files** — `showHidden` pref
- [x] **File icons** — type-based icons
- [x] **Click to open** — in editor
- [x] **Directory expansion** — collapse/expand
- [x] **Context menu** — right-click options

### 8.2 File Operations
- [x] **New file** — create new
- [x] **New folder** — create directory
- [x] **Rename** — rename file/folder
- [x] **Delete** — move to trash
- [x] **Refresh** — reload directory

### 8.3 Icon System
- [x] **Icon resolver** — `iconResolver.ts`
- [x] **File type detection** — extension-based
- [x] **Custom icons** — for common file types

---

## 9. Git Integration

### 9.1 Git Client
- [x] **Git operations** — `git/client.ts`
- [x] **Status** — working tree status
- [x] **Diff** — file changes
- [x] **Log** — commit history
- [x] **Branch** — branch list

### 9.2 Git Graph Panel
- [x] **Visual graph** — commit history graph
- [x] **Branch lines** — color-coded branches
- [x] **Commit details** — message, author, date
- [x] **Click to checkout** — switch branches
- [x] **Close button** — dismiss panel

### 9.3 Issues Panel
- [x] **GitHub issues** — fetch from repo
- [x] **Issue list** — title, number, status
- [x] **Filter** — open/closed/all
- [x] **Close button** — dismiss panel

### 9.4 Source Control Panel
- [x] **Changed files** — unstaged/staged
- [x] **Diff view** — inline diff
- [x] **Stage/unstage** — git add/remove
- [x] **Commit** — message + commit
- [x] **Push/pull** — remote operations

### 9.5 Git History Dialog
- [x] **Commit history** — full log
- [x] **File history** — per-file log
- [x] **Blame** — line annotations

### 9.6 GitHub Issues Dialog
- [x] **Issue search** — query GitHub
- [x] **Issue details** — full issue view
- [x] **Create issue** — new issue form

---

## 10. SFTP / Remote Connections

### 10.1 Remotes View
- [x] **Host list** — saved connections
- [x] **Add host** — new connection
- [x] **Edit host** — modify connection
- [x] **Delete host** — remove connection
- [x] **Connect** — open SFTP session

### 10.2 SFTP View
- [x] **File list** — remote directory listing
- [x] **Navigation** — breadcrumbs, up/down
- [x] **Upload** — local to remote
- [x] **Download** — remote to local
- [x] **Delete** — remote file delete
- [x] **Rename** — remote file rename
- [x] **New folder** — create directory
- [x] **Permissions** — chmod
- [x] **Details panel** — file info
- [x] **Close button** — close SFTP view

### 10.3 Connection Store
- [x] **Host config** — hostname, port, user, key
- [x] **SSH key support** — private key auth
- [x] **Password auth** — password support
- [x] **Connection state** — connected/disconnected
- [x] **Per-tab SFTP** — each tab has own connection

### 10.4 SFTP API
- [x] **List directory** — `sftpApi.ts`
- [x] **Read file** — download
- [x] **Write file** — upload
- [x] **Delete** — remove
- [x] **Rename** — move
- [x] **Mkdir** — create directory
- [x] **Stat** — file info

---

## 11. Command Palette

### 11.1 Command System
- [x] **Fuzzy search** — filter commands
- [x] **Categories** — grouped by type
- [x] **Keyboard shortcuts** — displayed hints
- [x] **Recent commands** — history

### 11.2 Built-in Commands
- [x] **New terminal tab** — `Ctrl/Cmd+T`
- [x] **Close terminal tab** — `Ctrl/Cmd+Shift+W`
- [x] **Next terminal tab** — `Ctrl/Cmd+Tab`
- [x] **Previous terminal tab** — `Ctrl/Cmd+Shift+Tab`
- [x] **Toggle theme** — dark/light
- [x] **Open settings** — settings page
- [x] **Open AI bubble** — `Ctrl/Cmd+Shift+A`
- [x] **Open command palette** — `Ctrl/Cmd+Shift+P`
- [x] **Open file** — quick open
- [x] **Go to tab** — tab switcher

### 11.3 History
- [x] **Command history** — `command-palette/history.ts`
- [x] **Recent first** — sorted by recency
- [x] **Persistence** — saved across sessions

---

## 12. Bridge Commands (OSC 777)

### 12.1 OSC 777 Dispatch
- [x] `open` — open file/URL
- [x] `preview` — preview file
- [x] `notify` — system notification
- [x] `diff` — show diff dialog

### 12.2 Bridge Handler
- [x] **Parse OSC 777** — `bridge.ts`
- [x] **Dispatch commands** — route to handlers
- [x] **Error handling** — graceful failures

---

## 13. Docker Integration

### 13.1 Docker View
- [x] **Container list** — running/stopped
- [x] **Image list** — local images
- [x] **Container actions** — start/stop/remove
- [x] **Logs** — container logs
- [x] **Exec** — run command in container

### 13.2 Docker Client
- [x] **API client** — `docker/client.ts`
- [x] **Container ops** — CRUD operations
- [x] **Image ops** — pull/remove
- [x] **Volume ops** — manage volumes
- [x] **Network ops** — manage networks

---

## 14. Kubernetes Integration

### 14.1 Kubernetes View
- [x] **Pod list** — namespace pods
- [x] **Deployment list** — deployments
- [x] **Service list** — services
- [x] **ConfigMap/Secret** — configuration
- [x] **Logs** — pod logs
- [x] **Exec** — run command in pod

### 14.2 Kubernetes Client
- [x] **API client** — `kubernetes/client.ts`
- [x] **Resource ops** — CRUD
- [x] **Context switching** — kubeconfig contexts
- [x] **Namespace** — namespace selection

---

## 15. Terraform Integration

### 15.1 Terraform View
- [x] **Resource list** — managed resources
- [x] **Plan** — terraform plan
- [x] **Apply** — terraform apply
- [x] **State** — state file view

---

## 16. CI/CD Integration

### 16.1 CI/CD Dialog
- [x] **Pipeline list** — CI pipelines
- [x] **Build status** — pass/fail/pending
- [x] **Logs** — build logs
- [x] **Trigger** — manual trigger

---

## 17. Snippets

### 17.1 Snippets Dialog
- [x] **Snippet list** — saved snippets
- [x] **Search** — filter snippets
- [x] **Insert** — at cursor
- [x] **Edit** — modify snippet
- [x] **Delete** — remove snippet

### 17.2 Snippets Store
- [x] **Storage** — `snippets/store.ts`
- [x] **Categories** — group by type
- [x] **Variables** — template variables

### 17.3 Snippets Dropdown
- [x] **Quick insert** — dropdown menu
- [x] **Recent** — recently used

---

## 18. TOTP / 2FA

### 18.1 TOTP Dialog
- [x] **TOTP list** — saved codes
- [x] **Add TOTP** — new secret
- [x] **Copy code** — to clipboard
- [x] **Auto-refresh** — 30-second timer

### 18.2 TOTP Store
- [x] **Storage** — `totp/store.ts`
- [x] **Encryption** — secure storage
- [x] **Timer** — `useTotpTimer()`

---

## 19. Clipboard Manager

### 19.1 Clipboard Dropdown
- [x] **History** — clipboard history
- [x] **Search** — filter items
- [x] **Paste** — at cursor
- [x] **Clear** — clear history

### 19.2 Clipboard Store
- [x] **Storage** — `clipboard/store.ts`
- [x] **Limit** — max items
- [x] **Listener** — `useClipboardListener()`

---

## 20. Jobs / Processes

### 20.1 Jobs Dialog
- [x] **Process list** — running processes
- [x] **Kill** — terminate process
- [x] **Status** — running/stopped

### 20.2 Jobs Client
- [x] **API** — `jobs/client.ts`
- [x] **Process ops** — list/kill

---

## 21. MCP (Model Context Protocol)

### 21.1 MCP Section
- [x] **Server list** — configured servers
- [x] **Add server** — new MCP server
- [x] **Edit server** — modify config
- [x] **Delete server** — remove
- [x] **Enable/disable** — toggle

### 21.2 MCP Marketplace
- [x] **Marketplace dialog** — `McpMarketplaceDialog.tsx`
- [x] **Server catalog** — available servers
- [x] **Install** — one-click install
- [x] **Search** — filter servers

### 21.3 MCP Client
- [x] **Client** — `mcp/client.ts`
- [x] **Transport** — `mcp/transport.ts`
- [x] **Tools** — `mcp/tools.ts`
- [x] **Store** — `mcp/store.ts`

---

## 22. Tools Hub

### 22.1 Tools Hub Dialog
- [x] **Tool list** — recommended tools
- [x] **Categories** — grouped by type
- [x] **Install** — install command
- [x] **Search** — filter tools

### 22.2 Tools Hub View
- [x] **Integration view** — `ToolsHubView.tsx`
- [x] **Status** — installed/not installed

### 22.3 Integrations View
- [x] **Integration list** — `IntegrationsView.tsx`
- [x] **Configure** — setup integration

---

## 23. Updater

### 23.1 Update Check
- [x] **Manual check** — button in About
- [x] **Tauri updater** — integration
- [x] **Auto-check** — on startup (optional)
- [x] **Download** — background download
- [x] **Install** — restart to install

---

## 24. Shortcuts & Key Bindings

### 24.1 Global Shortcuts
- [x] `Cmd/Ctrl + T` — new tab
- [x] `Cmd/Ctrl + Shift + W` — close tab
- [x] `Cmd/Ctrl + Tab` — next tab
- [x] `Cmd/Ctrl + Shift + Tab` — previous tab
- [x] `Cmd/Ctrl + 1-9` — jump to tab
- [x] `Cmd/Ctrl + Shift + P` — command palette
- [x] `Cmd/Ctrl + Shift + A` — AI bubble
- [x] `Cmd/Ctrl + Plus` — zoom in
- [x] `Cmd/Ctrl + Minus` — zoom out
- [x] `Cmd/Ctrl + 0` — reset zoom

### 24.2 Terminal Shortcuts
- [x] `Cmd/Ctrl + F` — find in terminal
- [x] `Ctrl + R` — history picker
- [x] `Cmd + D` — split right
- [x] `Cmd + Shift + D` — split down
- [x] `Cmd + Alt + Arrow` — focus navigation
- [x] `Tab` — accept autocomplete
- [x] `ArrowUp/Down` — navigate autocomplete
- [x] `Escape` — dismiss autocomplete

### 24.3 Shortcuts Dialog
- [x] **Shortcuts dialog** — `ShortcutsDialog.tsx`
- [x] **List all shortcuts** — searchable
- [x] **Categories** — grouped by context

---

## 25. UI Components

### 25.1 shadcn/ui Components
- [x] Alert — `alert.tsx`
- [x] Alert Dialog — `alert-dialog.tsx`
- [x] Badge — `badge.tsx`
- [x] Breadcrumb — `breadcrumb.tsx`
- [x] Button — `button.tsx`
- [x] Button Group — `button-group.tsx`
- [x] Card — `card.tsx`
- [x] Checkbox — `checkbox.tsx`
- [x] Collapsible — `collapsible.tsx`
- [x] Command — `command.tsx`
- [x] Context Menu — `context-menu.tsx`
- [x] Dialog — `dialog.tsx`
- [x] Dropdown Menu — `dropdown-menu.tsx`
- [x] Hover Card — `hover-card.tsx`
- [x] Input — `input.tsx`
- [x] Input Group — `input-group.tsx`
- [x] Item — `item.tsx`
- [x] Kbd — `kbd.tsx` (keyboard key display)
- [x] Label — `label.tsx`
- [x] Menubar — `menubar.tsx`
- [x] Popover — `popover.tsx`
- [x] Progress — `progress.tsx`
- [x] Radio Group — `radio-group.tsx`
- [x] Resizable — `resizable.tsx`
- [x] Scroll Area — `scroll-area.tsx`
- [x] Select — `select.tsx`
- [x] Separator — `separator.tsx`
- [x] Sheet — `sheet.tsx`
- [x] Skeleton — `skeleton.tsx`
- [x] Slider — `slider.tsx`
- [x] Spinner — `spinner.tsx`
- [x] Switch — `switch.tsx`
- [x] Tabs — `tabs.tsx`
- [x] Textarea — `textarea.tsx`
- [x] Toggle — `toggle.tsx`
- [x] Toggle Group — `toggle-group.tsx`
- [x] Tooltip — `tooltip.tsx`

### 25.2 Custom Components
- [x] DialogLayer — `DialogLayer.tsx`
- [x] ErrorBoundary — `ErrorBoundary.tsx`
- [x] Modal — `Modal.tsx`
- [x] QuickSwitcher — `switcher/QuickSwitcher.tsx`
- [x] SidebarRail — `sidebar/SidebarRail.tsx`
- [x] ToastContainer — `toast/ToastContainer.tsx`
- [x] StatusBar — `statusbar/StatusBar.tsx`
- [x] PathBar — `header/PathBar.tsx`
- [x] WorkspacePath — `header/WorkspacePath.tsx`

---

## 26. System Vitals

### 26.1 Vitals Display
- [x] **CPU usage** — percentage
- [x] **Memory usage** — used/total
- [x] **Battery** — percentage + status
- [x] **Network** — up/down speed
- [x] **Time** — current time

### 26.2 Vitals Implementation
- [x] **useSystemVitals** — `terminal/vitals/useSystemVitals.ts`
- [x] **useVitals** — `terminal/vitals/useVitals.ts`
- [x] **VitalStrip** — `terminal/vitals/VitalStrip.tsx`
- [x] **Types** — `terminal/vitals/types.ts`

---

## 27. Session Persistence

### 27.1 Save/Restore
- [x] **Session key** — `huskv2.session.v1`
- [x] **Tabs** — all open tabs
- [x] **Active tab** — which tab was active
- [x] **CWD** — working directory per tab
- [x] **Title** — manual titles
- [x] **Color** — tab colors
- [x] **SFTP state** — host and open flag
- [x] **Pane tree** — full split structure
- [x] **Auto-save** — on every change
- [x] **Restore on launch** — if enabled

### 27.2 Implementation
- [x] **loadSession** — `useTerminalTabs.ts`
- [x] **saveSession** — `useTerminalTabs.ts`
- [x] **getFirstLeafCwd** — extract CWD from pane tree
- [x] **makeTab** — recreate tab from saved data

---

## 28. Registry Architecture

### 28.1 Session Registry
- [x] **Module-level Map** — `Map<number, Session>` keyed by `leafId`
- [x] **createSession** — creates xterm + PTY once per leafId
- [x] **attachSession** — moves xterm element into DOM container
- [x] **detachSession** — parks xterm element in hidden div
- [x] **disposeSession** — kills PTY, disposes xterm (only on actual close)
- [x] **getSessionHandle** — safe API for TerminalView

### 28.2 Session Lifecycle
- [x] **Create** — on first mount of leaf
- [x] **Attach** — on mount (move element to container)
- [x] **Detach** — on unmount (move to hidden parking div)
- [x] **Dispose** — on pane close (kill PTY, dispose xterm)
- [x] **Reattach** — on remount (reuse existing session)

### 28.3 Callbacks
- [x] `onFocus` — pane focus notification
- [x] `onData` — keystroke notification (triggers autocomplete)
- [x] `onKey` — key event interception (autocomplete navigation)
- [x] `onSplit` — split direction notification
- [x] `onFocusDirection` — directional focus notification

### 28.4 State Management
- [x] **Typing state** — `isTyping` flag
- [x] **Current command** — command text tracking
- [x] **Prompt position** — cursor at prompt
- [x] **Command running** — execution state
- [x] **Last exit code** — command result

---

## Audit Checklist (Run Before/After Major Changes)

```
□ Build passes (pnpm tsc --noEmit)
□ All preferences have UI controls or external exposure
□ No "TODO/FIXME" in settings code
□ All imports resolve
□ Terminal content preserved on split
□ Autocomplete triggers on keystroke
□ Key bindings work (Cmd+F, Ctrl+R, Cmd+D, Cmd+Alt+Arrow)
□ Context menu shows all items
□ Close button visible on multi-pane
□ Session restore works
□ SFTP restores on tab switch
□ AI bubble opens/closes
□ Settings page loads all sections
□ Editor opens files
□ File explorer shows tree
□ Git panels load
□ Command palette opens
□ Shortcuts dialog shows
□ System vitals display
□ Background image applies
□ Theme toggle works
□ Zoom in/out/reset works
```

---

## Changelog

| Date | Commit | Changes |
|------|--------|---------|
| 2026-06-19 | `1b9279d` | Fix: per-tab SFTP state, restore SFTP on tab switch |
| 2026-06-19 | `7582488` | Fix: SFTP view layout, list + details only |
| 2026-06-19 | `70865a9` | Fix: SFTP view layout improvements |
| 2026-06-19 | `e39fd20` | Docs: document husk command scope — LOCAL ONLY |
| 2026-06-19 | `798410a` | Added essential editor prefs (line numbers, whitespace, ligatures, bracket colors, smooth scroll, format on paste) |
| 2026-06-19 | `1b47e04` | Restored autocomplete, Cmd+D split, Cmd+Alt+Arrow nav |
| 2026-06-19 | `295c2a5` | Added pane close button (×) |
| 2026-06-19 | `69981ec` | Fixed DOM parking for split content preservation |
| 2026-06-19 | `4de3b8e` | Implemented Option B registry (module-level session map) |
