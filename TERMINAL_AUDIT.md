# Husk Terminal App — Feature Audit

> **Purpose:** Living document tracking every feature, function, and behavior.
> **Rule:** Update this file after any commit that adds, removes, or modifies features.
> **Audit trigger:** Run before/after major refactors to detect regressions.

---

## 1. Terminal Core

### 1.1 PTY Lifecycle
- [x] `pty_spawn` — creates Rust PTY with given cols/rows/cwd
- [x] `pty_kill` — destroys PTY process
- [x] `pty_write` — sends data to PTY stdin
- [x] `pty_resize` — SIGWINCH on col/row change
- [x] `pty://data/{id}` — Tauri event listener for PTY stdout
- [x] `pty://exit/{id}` — Tauri event listener for process exit
- [x] PTY survives React remounts (registry pattern)
- [x] PTY disposed only on actual pane/tab close

### 1.2 xterm.js Instance
- [x] Terminal creation with preferences (font, size, cursor, theme, scrollback)
- [x] `FitAddon` — auto-resize to container
- [x] `SearchAddon` — find in terminal
- [x] `allowProposedApi: true` — enables OSC handlers
- [x] `allowTransparency: true` — for background images
- [x] DOM parking on detach (preserves buffer across remounts)
- [x] Resize debounce (150ms) + max-wait interval (500ms)
- [x] `scrollToBottom()` after fit
- [x] Deduplicated resize (lastCols/lastRows)

### 1.3 OSC Handlers
- [x] **OSC 7** — working directory tracking (`file://host/path`)
- [x] **OSC 133** — shell integration (A=prompt start, B=prompt end, C=preexec, D=exit code)
- [x] **OSC 778** — command text capture (`husk;cmd;...`)
- [x] **OSC 777** — bridge commands (open/preview/notify/diff)

### 1.4 Key Bindings
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

### 1.5 Context Menu (Right-click)
- [x] Copy
- [x] Paste
- [x] Select all
- [x] Clear
- [x] Find…
- [x] History…
- [x] Split right
- [x] Split down
- [x] Close pane (when multi-pane)

### 1.6 Click-to-Position
- [x] Click in command area → move cursor via arrow sequences
- [x] Hover → text cursor indicator
- [x] Respects selection (doesn't clear if selecting)
- [x] Respects running commands

### 1.7 Autocomplete
- [x] History-based suggestions from shell history
- [x] Triggered on every keystroke (50ms debounce)
- [x] Shows only at end of input, on prompt line
- [x] Tab to accept, ArrowUp/Down to navigate, Escape to dismiss
- [x] Positioned at cursor location

### 1.8 Search
- [x] Inline search bar (`term-search` CSS class)
- [x] `findNext` / `findPrevious` with `incremental: true`
- [x] `clearDecorations` on close
- [x] Enter = findNext, Shift+Enter = findPrevious
- [x] Escape = close search

### 1.9 History Panel
- [x] Fetches from shell history (sqlite)
- [x] Loading state
- [x] Click to inject command at prompt
- [x] Close button

---

## 2. Pane System

### 2.1 Tree Structure
- [x] Binary tree: leaves = terminals, splits = row/col dividers
- [x] Each leaf has unique `leafId` (auto-increment)
- [x] `focusedId` tracks active leaf per tab
- [x] `tabActive` boolean for active tab

### 2.2 Splitting
- [x] Split right (row)
- [x] Split down (col)
- [x] New leaf inherits cwd from parent
- [x] New leaf gets focus
- [x] Original leaf preserves content (DOM parking)

### 2.3 Closing
- [x] Close button (×) on pane hover (visible only when multi-pane)
- [x] Right-click "Close pane"
- [x] Cannot close last pane in tab

### 2.4 Focus Navigation
- [x] `Cmd+Alt+Arrow` — directional focus
- [x] Click to focus
- [x] Focus follows active tab

### 2.5 Resize
- [x] Drag dividers (col-resize / row-resize cursors)
- [x] Min size enforcement (100px)
- [x] ResizeObserver on each pane

---

## 3. Tab System

### 3.1 Tab Management
- [x] New tab (`+` button)
- [x] Close tab (× on tab)
- [x] Tab title from shell cwd
- [x] Active tab indicator

### 3.2 Session Restore
- [x] Saves open tabs + cwd on quit
- [x] Restores on launch (if enabled in prefs)
- [x] `sessionRestoreEnabled` preference

---

## 4. AI Integration

### 4.1 Terminal Context
- [x] `setActiveTerminalReader` — exposes buffer content (8KB cap, bottom-up)
- [x] `setActiveTerminalRunner` — injects command + Enter
- [x] `setActiveTerminalTyper` — injects text without Enter
- [x] `setActiveTerminalSearchOpener` — opens find dialog
- [x] `setActiveTerminalSearcher` — runs search with query
- [x] `setActiveTerminalCwd` — tracks current directory
- [x] `setActiveTerminalExit` — tracks last command exit code
- [x] `setTerminalTyping` — typing indicator (400ms debounce)
- [x] `setCurrentCommand` / `clearCurrentCommand` — command tracking
- [x] `markCommandStart` — preexec hook
- [x] `setPromptPosition` / `getPromptPosition` — prompt cursor position
- [x] `isCommandRunning` — command execution state

### 4.2 AI Input Interception
- [x] `/ai` command interception
- [x] `setTerminalLineReader` — reads current line
- [x] `setAiPtyWriter` — writes AI output to PTY
- [x] `interceptTerminalInput` — filters/swallows input

### 4.3 AI Floating Bubble
- [x] Opacity, font size, background image settings
- [x] BG blur, dim, opacity controls

### 4.4 Error Assistance
- [x] Toast on command failure
- [x] "Explain" button → opens AI with error context
- [x] `terminalAiErrorAssist` preference

---

## 5. Settings Page

### 5.1 Sections
- [x] About (Manifest) — version, build, links
- [x] General — AI toggle, Editor, Explorer, Terminal
- [x] Appearance — Background, Accent, Effects, Layout, Custom CSS, AI Bubble
- [x] Models — Provider selection, API keys, Local models
- [x] MCP — Server management, marketplace
- [x] Tools — Recommended CLI tools

### 5.2 Editor Preferences (all wired)
- [x] Vim mode
- [x] Cursor blink
- [x] Minimap
- [x] Sticky scroll
- [x] Font size
- [x] Tab size
- [x] Word wrap
- [x] Cursor style
- [x] Line highlight
- [x] **Line numbers** (on/off/relative)
- [x] **Whitespace** (none/boundary/all)
- [x] **Ligatures**
- [x] **Bracket colors**
- [x] **Smooth scroll**
- [x] **Format on paste**

### 5.3 Terminal Preferences (all wired)
- [x] Cursor blink
- [x] Font size
- [x] Scrollback
- [x] Cursor style
- [x] Theme preset
- [x] Font family
- [x] Error assistance

### 5.4 Appearance Preferences (all wired)
- [x] Background image (pick/clear/opacity/blur/dim)
- [x] Accent color (presets + custom picker)
- [x] Animations
- [x] Frosted glass
- [x] Neon border glow
- [x] Panel gaps
- [x] Gap style (none/dots/grid/cross/gradient)
- [x] Panel shadows
- [x] Active panel glow
- [x] Editor wallpaper opacity
- [x] Custom CSS textarea
- [x] AI bubble (opacity, font size, BG blur, BG dim, BG opacity, BG image)

### 5.5 App Preferences (wired, not in settings UI)
- [x] Theme — topbar toggle (sun/moon icon)
- [x] Zoom level — Cmd+Plus/Minus/Zero
- [x] `hasSeenWelcome` — set by welcome dialog

---

## 6. Editor

### 6.1 Monaco Integration
- [x] Monaco editor with theme sync
- [x] Vim mode (via `vimMode` pref)
- [x] All editor preferences applied

---

## 7. File Explorer

### 7.1 Tree View
- [x] Show hidden files (`showHidden` pref)
- [x] File icons
- [x] Click to open in editor

---

## 8. Bridge Commands

### 8.1 OSC 777 Dispatch
- [x] `open` — open file/URL
- [x] `preview` — preview file
- [x] `notify` — system notification
- [x] `diff` — show diff dialog

---

## 9. Registry (Module-Level)

### 9.1 Session Management
- [x] `Map<number, Session>` keyed by `leafId`
- [x] `createSession` — creates xterm + PTY once per leafId
- [x] `attachSession` — moves xterm element into DOM container
- [x] `detachSession` — parks xterm element in hidden div
- [x] `disposeSession` — kills PTY, disposes xterm (only on actual close)
- [x] `getSessionHandle` — safe API for TerminalView

### 9.2 Callbacks
- [x] `onFocus` — pane focus notification
- [x] `onData` — keystroke notification (triggers autocomplete)
- [x] `onKey` — key event interception (autocomplete navigation)
- [x] `onSplit` — split direction notification
- [x] `onFocusDirection` — directional focus notification

---

## 10. Updater

- [x] `checkForUpdates` — manual check button in About
- [x] Tauri updater integration

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
```

---

## Changelog

| Date | Commit | Changes |
|------|--------|---------|
| 2026-06-19 | `798410a` | Added essential editor prefs (line numbers, whitespace, ligatures, bracket colors, smooth scroll, format on paste) |
| 2026-06-19 | `1b47e04` | Restored autocomplete, Cmd+D split, Cmd+Alt+Arrow nav |
| 2026-06-19 | `295c2a5` | Added pane close button (×) |
| 2026-06-19 | `69981ec` | Fixed DOM parking for split content preservation |
| 2026-06-19 | `4de3b8e` | Implemented Option B registry (module-level session map) |
