# AI Editor Pane Enhancement Plan

## Overview
Add chat session persistence, file attachment, terminal integration, copy-to-clipboard, and a project-scoped session manager to the AI editor pane.

---

## 1. Chat Session Persistence & Project-Scoped Sessions

### Problem
Chat history is lost when the panel is closed because messages live only in React state.

### Solution: Workspace-Scoped Session Store

**Storage model:**
```
localStorage key: "huskv2.ai.sessions.<workspaceHash>"
```

**Data shape:**
```ts
interface ChatSession {
  id: string;           // uuid
  title: string;        // auto-generated from first user message or "New Chat"
  createdAt: number;    // timestamp
  updatedAt: number;    // timestamp
  messages: EditorChatMessage[];
  attachedFiles: string[]; // paths of explicitly attached files
}

interface SessionStore {
  activeSessionId: string | null;
  sessions: ChatSession[];
}
```

**Session lifecycle:**
1. When AI panel opens for the first time in a workspace:
   - Show a "Start new chat" empty state
   - OR list previous sessions in a sidebar
2. When user sends first message:
   - Auto-create a session titled from the first 30 chars of the message
3. Every message updates `updatedAt` and persists to localStorage
4. Switching sessions loads that chat history instantly

**UI:**
- Header gets a "Chat history" icon (clock/↺) that opens a dropdown/sheet
- Dropdown lists sessions: title + relative timestamp ("2h ago")
- Each item has: "Continue", "Rename", "Delete"
- "New chat" button at the top of the dropdown
- Session title can be edited inline (pencil icon)

---

## 2. File Attachment / Multi-File Context

### Problem
Currently ALL open files are auto-included in context. This wastes tokens and includes irrelevant files.

### Solution: Explicit @-mention File Picker

**UX:**
- In the input box, user types `@` → a file picker dropdown appears
- Dropdown shows: open files first, then recent files, then all files in workspace
- Selected files appear as chips above the input (like Slack mentions)
- Each chip has an X to remove
- If no files attached, the active file is still auto-included (backward compatible)

**Data model:**
```ts
interface EditorContext {
  activeFile: { path, name, content, language } | null;
  attachedFiles: AttachedFile[]; // NEW
  openFiles: string[];           // for reference only
}

interface AttachedFile {
  path: string;
  name: string;
  content: string;
  language: string;
}
```

**Context formatting:**
```
Attached files: file1.ts, file2.rs
--- Active file: main.ts (typescript) ---
<content>
--- Attached: file2.rs (rust) ---
<content>
--- end ---
```

---

## 3. Terminal Integration from AI Pane

### Problem
When AI suggests a shell command, the user has to manually copy/paste it into the terminal.

### Solution: "Run in Terminal" Actions

**For any code block the AI outputs:**
- Detect if it's a shell command (```bash, ```sh, or no lang but looks like a command)
- Add action buttons on hover:
  - "Copy" (clipboard icon)
  - "Paste to Terminal" (terminal icon) — drops at prompt without executing
  - "Run" (play icon) — executes immediately

**Safety:**
- For destructive commands (rm, dd, etc.), show a confirmation toast
- Use existing [`runInActiveTerminal()`](src/ai/terminalContext.ts:24) and [`typeInActiveTerminal()`](src/ai/terminalContext.ts:38)

**UI placement:**
- Inline buttons appear on the right side of code blocks on hover
- Also available as a context menu on any assistant message

---

## 4. Copy-to-Clipboard for AI Responses

### Solution
- Each assistant message gets a copy button in its header (top-right)
- Also: right-click/long-press on any message → "Copy text"
- Code blocks already have copy buttons (implement inline)

**Implementation:**
- Use `navigator.clipboard.writeText()`
- Show toast: "Copied to clipboard"

---

## Implementation Order

| Priority | Feature | Files to change |
|----------|---------|-----------------|
| 1 | Session store + persistence | `ai/editor/sessionStore.ts`, `AiEditorPane.tsx` |
| 2 | Session UI (switcher, new chat, rename, delete) | `AiEditorPane.tsx` |
| 3 | File attachment (@ picker) | `ai/editor/context.ts`, `AiEditorPane.tsx` |
| 4 | Copy-to-clipboard | `AiEditorPane.tsx` (FormattedMessage) |
| 5 | Terminal actions on code blocks | `AiEditorPane.tsx` (FormattedMessage) |
