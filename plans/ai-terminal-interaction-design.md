# AI via Terminal — Design Options (Visual Walkthrough)

## Option A — Terminal Inline AI (`/ai` commands)

### How it looks
```
~/projects/huskv2 (main) $ /ai explain this repo's structure

AI ▸ Reading project structure...
AI ▸ This is a Tauri v2 desktop app with React + TypeScript frontend.
     Key directories:
     • src/          — React UI components, hooks, stores
     • src-tauri/    — Rust backend, PTY, shell integration
     • src/ai/       — AI streaming client, providers, agents
     • src/git/      — Git operations via Tauri commands
     Run `tree -L 2` if you want the full layout.

~/projects/huskv2 (main) $ █
```

### How it feels
- **No UI chrome whatsoever.** The terminal IS the chat.
- You type `/ai` just like you'd type `ls` or `git status`. It feels like a shell command.
- AI responses appear as "virtual" terminal output — green `AI ▸` prefix, wrapped text, code blocks rendered with terminal-native styling (maybe indented with box-drawing characters).
- **Context is automatic.** The AI sees your cwd, last 20 commands, and any selected text without you pasting anything.
- The floating bubble turns into a **mode indicator** — green glow = AI mode active, gray = normal shell.
- Press `Ctrl+C` or type `exit` to drop back to the shell.

### Interaction flow
1. User types `/ai how do I fix this error?`
2. Shell-integration script intercepts the line before it hits the PTY
3. The line is sent to AI along with terminal context (last output, cwd)
4. Response streams character-by-character into the terminal buffer
5. User sees it as if a very fast typist is explaining things

---

## Option B — Docked Bottom Input Bar

### How it looks
```
┌──────────────────────────────────────────┐
│ ~/projects/huskv2 $ git status           │
│ On branch main                           │
│ nothing to commit, working tree clean    │
│                                          │
│ [terminal continues here...]             │
│                                          │
├──────────────────────────────────────────┤
│ 💬 how do I squash the last 3 commits?   │
└──────────────────────────────────────────┘
```

After hitting Enter:
```
┌──────────────────────────────────────────┐
│ ~/projects/huskv2 $ git status           │
│ On branch main                           │
│ nothing to commit, working tree clean    │
│                                          │
│ ──── AI ▸ ────                           │
│ Q: how do I squash the last 3 commits?   │
│ A: Use interactive rebase:               │
│    git rebase -i HEAD~3                  │
│    Then mark commits as `squash` or `s`. │
│ ──── /AI ────                            │
│                                          │
│ ~/projects/huskv2 $ █                    │
└──────────────────────────────────────────┘
```

### How it feels
- Like an inline comment thread inside your terminal scrollback.
- The bottom bar only appears when you click the floating bubble (or hit a hotkey like `Cmd+Shift+A`).
- Type your question, hit Enter → the bar slides away and the response is "pasted" into the terminal buffer as formatted text.
- Responses are **persistent** — they stay in your scrollback. Scroll up to see previous AI answers.
- The bar auto-hides after 5 seconds of inactivity, but you can summon it again instantly.

### Visual details
- Bar height: 36px, matches terminal font size
- Left edge: small `💬` or `AI` label in green
- Input field: transparent background, white text, no border
- Bottom border: 1px green line when focused, gray when idle
- Position: absolute bottom of the terminal pane (not floating)

---

## Option C — Terminal Split-Pane Chat

### How it looks
```
┌──────────────────────────────────────────┐
│ ~/projects/huskv2 $ ls                   │
│ src  package.json  README.md             │
│                                          │
│ ~/projects/huskv2 $ █                    │
│                                          │
│ [65% height — normal terminal]           │
├──────────────────────────────────────────┤ ─ splitter (draggable)
│ AI Chat                                  │
│ ──────────────────────────────────────── │
│ User: explain the build system           │
│                                          │
│ AI: This uses Vite for the frontend and  │
│     Cargo/Tauri for the backend.         │
│     Key scripts:                         │
│     • pnpm dev     — start dev server    │
│     • pnpm build   — production build    │
│     • pnpm tauri dev — full Tauri dev    │
│                                          │
│ [Run in terminal] [Copy]                 │
│                                          │
│ 💬 explain the build system        [Send]│
└──────────────────────────────────────────┘
```

### How it feels
- Like having a coworker sitting next to you — terminal on top, chat below.
- The split is **clearly part of the terminal pane**, not a separate floating window.
- Drag the splitter to resize (more terminal, less chat, or vice versa).
- Every AI response that contains a command shows a `[Run in terminal]` button — click it and the command is typed into the top terminal (but not executed, so you can review first).
- Close the split with `Escape`, clicking the bubble, or dragging the splitter to 0%.

### Visual details
- Top pane: your normal terminal, unchanged
- Bottom pane: clean chat UI with message bubbles
- User messages: right-aligned, dark gray background
- AI messages: left-aligned, slightly lighter background
- Code blocks: monospaced, with a small "▶ Run" button in the top-right corner
- Input bar at bottom: single-line, green send button

---

## Option D — xterm.js Native Overlays

### How it looks
```
~/projects/huskv2 (main) $ /ai optimize this

[User selected text in editor: "const x = Array.from({length: 1000}).map(...)"]

┌─ AI Suggestion ───────────────────────┐
│  Use a for-loop instead — 3× faster:  │
│                                       │
│  const out = [];                      │
│  for (let i = 0; i < 1000; i++) {     │
│    out.push(...);                     │
│  }                                    │
│                                       │
│  [Apply to Editor]  [Run Benchmark]   │
└───────────────────────────────────────┘

~/projects/huskv2 (main) $ █
```

### How it feels
- The AI response is a **native UI element floating inside the terminal canvas** at the exact line where your cursor is.
- It looks like a tooltip or card embedded in the text flow.
- Scroll the terminal → the overlay scrolls with it (it's anchored to a specific buffer line).
- Clickable buttons inside the overlay: `[Apply to Editor]`, `[Run Benchmark]`, `[Copy]`.
- After you interact, the overlay collapses to a small `✓` indicator on that line.

### Technical note
- Uses xterm.js `registerMarker()` + `registerDecoration({ width: 60 })` with an HTML overlay
- The overlay is a React portal rendered into an absolutely-positioned div that xterm.js manages
- This is the most "integrated" look but requires the most custom rendering code

---

## Recommendation

| Option | Terminal Feel | Rich Formatting | Implementation Effort | Best For |
|--------|-------------|-----------------|----------------------|----------|
| A | ⭐⭐⭐⭐⭐ | ⭐⭐ | Medium | Power users who live in the shell |
| B | ⭐⭐⭐⭐ | ⭐⭐⭐ | Low | Fastest win, keeps scrollback history |
| C | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | Medium | Users who want persistent chat context |
| D | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | High | Maximum visual polish, command shortcuts |

**If husk v1 has a strong "terminal-first" identity → Option A or B.**
**If users often have long AI conversations → Option C.**
