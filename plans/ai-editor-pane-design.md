# AI Editor Pane — Design Document

## Goal
Add a right-side AI chat pane to huskv2 so developers can edit code, refactor, generate, and review changes without leaving the terminal. The pane appears only when editing files and provides an AI IDE experience comparable to Cursor/Copilot.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Sidebar  │  Editor Area              │  AI Editor Pane     │
│           │  (Monaco)                 │  (right panel)      │
│           │                           │                     │
│  Files    │  ┌─────────────────────┐  │  ┌───────────────┐  │
│  Git      │  │  const x = 1;       │  │  │ [model▼]     │  │
│  ...      │  │  // AI suggests     │  │  │ [agent▼]     │  │
│           │  │  // change here     │  │  ├───────────────┤  │
│           │  └─────────────────────┘  │  │ User: refactor  │  │
│           │                           │  │ AI: here's the  │  │
│           │  Diff preview (inline)    │  │    new code...  │  │
│           │  [Accept] [Reject]        │  │                 │  │
│           │                           │  │ [input          │  │
│           │                           │  │  area...      ] │  │
└─────────────────────────────────────────────────────────────┘
```

## Core Features

### 1. Right-Side Pane (collapsible, resizable)
- Appears only when `activeKind === "file"` (editor is visible)
- Collapsible via toggle button or `⌘/Ctrl+Shift+L` shortcut
- Width stored in localStorage (default 320px, min 260, max 500)
- Resizable via drag handle on left edge

### 2. Chat Interface
- Message history with streaming responses
- Code blocks rendered with syntax highlighting (shiki or highlight.js)
- Auto-scroll to bottom on new messages
- Context: current file content + selected text + project file tree

### 3. Model & Agent Selector
- Dropdown showing all configured providers from Settings → Models
- Shows which models have API keys configured (grey out others)
- Agent selector (same agents from existing AI panel)
- "Add key" quick-link if no key is set

### 4. Code Editing with Approval Flow

**4a. AI suggests edits → Show Inline Diff**
- AI response contains structured edit blocks (search/replace format)
- Monaco inline diff decorators show green (add) / red (remove) highlights
- Inline Accept/Reject buttons per change block
- Or: "Accept All" / "Reject All" buttons

**4b. Alternative: Diff Panel**
- If inline diff is too complex, show a split diff view below the chat
- Monaco diff editor (already exists in DiffDialog.tsx)
- Shows proposed vs current side-by-side

### 5. Context Awareness

The AI receives this context with every message:

```typescript
interface EditorContext {
  activeFile: { path: string; name: string; content: string; language: string };
  selectedText: string | null;      // If user selected text before asking
  projectTree: string[];            // Top-level file list (first 50 items)
  openFiles: string[];              // Currently open file paths
  cursorPosition: { line: number; column: number };
}
```

### 6. Actions Menu (quick prompts)

Pre-built prompts accessible via `/` in the input or quick-action buttons:
- `/explain` — Explain the current file or selection
- `/refactor` — Refactor selected code
- `/fix` — Fix errors in the current file
- `/generate` — Generate code from description
- `/test` — Generate tests for current file
- `/docs` — Generate JSDoc/docstrings
- `/review` — Code review of current file

## File Structure

```
src/ai/editor/
├── AiEditorPane.tsx          # Main right-side panel component
├── AiChat.tsx                # Chat messages + input area
├── CodeBlock.tsx             # Syntax-highlighted code display
├── ModelSelector.tsx         # Provider/model dropdown
├── AgentSelector.tsx         # Agent dropdown
├── QuickActions.tsx          # /command buttons
├── InlineDiffManager.ts      # Monaco inline diff decorators
├── diffParser.ts             # Parse AI search/replace blocks
├── context.ts                # Build editor context for AI
├── types.ts                  # Shared types
└── useAiEditorChat.ts        # Chat state + streaming hook
```

## Data Flow

```
User types in AiEditorPane
  ↓
useAiEditorChat.buildContext() → reads active file from Monaco model
  ↓
streamChat() with system prompt + context
  ↓
AI responds with text (may contain ```code blocks or <search><replace> tags)
  ↓
If edit blocks detected → InlineDiffManager shows decorators in Monaco
  ↓
User clicks Accept/Reject → InlineDiffManager applies or dismisses
```

## Integration Points

### App.tsx
- Add `aiPaneOpen` state + `aiPaneWidth` state
- Render `<AiEditorPane>` next to EditorArea when `activeKind === "file"` and `aiPaneOpen`
- Add sidebar rail icon for AI (or reuse existing AI sidebar slot)
- Keyboard shortcut `⌘/Ctrl+Shift+L` to toggle pane

### EditorArea.tsx
- Export `editorRef` via a store (like terminal context) so AiEditorPane can:
  - Read current file content
  - Read selected text
  - Apply edits to the model
  - Show inline decorations

### AiPanel.tsx (existing terminal AI)
- Keep as-is. Terminal AI and Editor AI are separate contexts.
- Future: could share model/agent selection state via a shared store.

## Edit Format (AI → Editor)

The AI returns edits in a structured format that the parser can extract:

```xml
<edit path="src/App.tsx">
<search>
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
</search>
<replace>
  const [aiPaneOpen, setAiPaneOpen] = useState(true);
  const [aiPaneWidth, setAiPaneWidth] = useState(320);
</replace>
</edit>
```

Or simpler markdown-style:
```
FILE: src/App.tsx
<<<<<<< SEARCH
  const [aiPaneOpen, setAiPaneOpen] = useState(false);
=======
  const [aiPaneOpen, setAiPaneOpen] = useState(true);
  const [aiPaneWidth, setAiPaneWidth] = useState(320);
>>>>>>> REPLACE
```

## System Prompt for Editor AI

```
You are husk, an expert code editor assistant. You help developers write, refactor, and understand code.

When suggesting code changes, ALWAYS use this exact format:

FILE: <relative-path>
<<<<<<< SEARCH
<exact existing code>
=======
<new code>
>>>>>>> REPLACE

Rules:
- Only change what the user asked for. Do not modify unrelated code.
- SEARCH blocks must match the existing file EXACTLY (including whitespace).
- If you need to explain, write prose OUTSIDE the FILE blocks.
- If no file changes are needed, just answer normally.
```

## Implementation Phases

### Phase 1: Basic Pane
- Create `AiEditorPane.tsx` with chat UI
- Integrate into App.tsx layout (right side, collapsible)
- Wire model selector to existing providers
- Basic streaming chat with context (current file content)

### Phase 2: Inline Diff
- Create `diffParser.ts` to extract search/replace blocks
- Create `InlineDiffManager.ts` for Monaco decorations
- Add Accept/Reject buttons per change block
- Wire to EditorArea's Monaco instance

### Phase 3: Polish
- Quick actions menu (/explain, /refactor, etc.)
- Selected text context
- Project tree context
- Keyboard shortcuts
- Persist pane width + open state
