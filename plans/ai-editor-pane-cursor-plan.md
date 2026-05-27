# AI Editor Pane — Cursor-Like Enhancement Plan

## Current State Summary

The AI Editor Pane already has a solid foundation:
- Chat sessions with workspace-scoped persistence
- Quick actions (Explain, Refactor, Fix, Test, Docs, Review)
- Streaming responses with code block rendering
- Code edit blocks with Accept/Reject per change
- Agent selector (Coder, Architect, Debugger, etc.)
- Session history dropdown

## Requested Features

### 1. Model Dropdown — Show Only Providers with Keys
**Problem:** The provider `<select>` in `AiEditorPane.tsx` is `disabled`. Users can't switch models on the fly.

**Solution:**
- Replace the disabled provider select with a working model dropdown
- Show only providers that have API keys configured (read from `useKey`)
- Group models by provider, show key status
- Persist per-session model override (falls back to global Settings default)
- Visual indicator: green dot for available, grey for missing key

**Files:** `AiEditorPane.tsx`, `useAiEditorChat.ts`

---

### 2. Shift + Drag-and-Drop Image Attachment
**Problem:** No image support in the editor AI pane.

**Solution:**
- On `shift + dragover` in the AI pane input area, show a "Drop image to attach" overlay
- On drop, read image file, convert to base64 data URI
- Show image as a thumbnail chip above the input (like Slack/Discord)
- Send image as a user message with the image data
- **Note:** Only vision-capable models support images (Claude, GPT-4o, Gemini). Show a warning if the selected model doesn't support vision.

**Files:** `AiEditorPane.tsx`, `useAiEditorChat.ts`, `types.ts`

---

## Additional Cursor-Like Features (Ranked by Impact)

### 3. @-mention File Picker in Input
**What:** Type `@` in the input to get a file picker dropdown.
**Why:** Cursor lets you explicitly attach files as context. Currently all open files are auto-included, which wastes tokens.
**UX:**
- `@` triggers dropdown showing: open files → recent files → all workspace files
- Selected files appear as removable chips above input
- If no files manually attached, active file is still auto-included (backward compat)

**Files:** `AiEditorPane.tsx`, `context.ts`, `types.ts`

---

### 4. Copy Code Button on Code Blocks
**What:** Each ```` ``` ```` block gets a "Copy" button in the top-right.
**Why:** Basic quality-of-life. Currently users have to manually select code.
**Implementation:** Add a small copy icon button that uses `navigator.clipboard.writeText()` + toast.

**Files:** `AiEditorPane.tsx` (`FormattedMessage` component)

---

### 5. "Run in Terminal" / "Paste to Terminal" on Shell Code Blocks
**What:** For ```` ```bash ```` / ```` ```sh ```` blocks, show action buttons:
- **Copy** — clipboard
- **Paste to Terminal** — drops at prompt without executing
- **Run** — executes immediately (with confirmation for destructive commands)
**Why:** Eliminates copy-paste friction when AI suggests terminal commands.

**Files:** `AiEditorPane.tsx`, reuse existing `runInActiveTerminal()` / `typeInActiveTerminal()`

---

### 6. Selected Text from Editor as Context
**What:** If the user has text selected in the Monaco editor before sending a message, include that selection in the prompt.
**Why:** "Explain this function", "Refactor this block" — the selection is the actual target.
**Implementation:**
- Read Monaco editor selection via `editorRef` store
- Include as `--- Selected text (lines N-M) ---` in context block
- If selection exists, quick actions auto-apply to selected text

**Files:** `context.ts`, `editorContext.ts`, `useAiEditorChat.ts`

---

### 7. Message Edit / Regenerate
**What:** Hover on a user message → "Edit" pencil icon. Clicking lets you modify the message and resend the conversation from that point (truncating after).
**Why:** Fix typos or refine prompts without losing the conversation thread.

**Files:** `sessionStore.ts`, `useAiEditorChat.ts`, `AiEditorPane.tsx`

---

### 8. Stop Generation Button
**What:** Visible stop button (square icon) while streaming is active.
**Why:** Currently `abortRef` exists but there's no UI to trigger it.

**Files:** `AiEditorPane.tsx`

---

### 9. Vision Model Detection
**What:** When image attachments exist, warn if the selected model doesn't support vision. Auto-suggest switching to a vision model.
**Vision-capable models:** Claude Sonnet/Opus, GPT-4o, Gemini 2.5 Pro/Flash

**Files:** `AiEditorPane.tsx`, `models.ts`

---

### 10. File Tree as Context (Truncated)
**What:** Include a truncated project file tree in context so AI knows project structure.
**Why:** "Where is the auth middleware defined?" — AI needs to know file names.
**Implementation:** Walk workspace root, list first 100 files, include as `--- Project files ---`.

**Files:** `context.ts`

---

## Implementation Priority

| Priority | Feature | Effort | Impact |
|----------|---------|--------|--------|
| P0 | Model dropdown with key-filtered providers | Medium | High |
| P0 | Shift+drag-drop image attachment | Medium | High |
| P1 | Copy code button on blocks | Low | Medium |
| P1 | Stop generation button | Low | Medium |
| P1 | Selected text context | Medium | High |
| P2 | @-mention file picker | High | High |
| P2 | Run/Paste to Terminal on shell blocks | Medium | Medium |
| P2 | Message edit/regenerate | Medium | Medium |
| P3 | Vision model detection | Low | Low |
| P3 | File tree context | Low | Medium |

## Data Model Changes

```typescript
// In types.ts — extend EditorChatMessage
export type EditorChatMessage = ChatMessage & {
  id: string;
  /** Optional image attachment (base64 data URI) */
  image?: string;
};

// Per-session model override
export interface ChatSession {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: EditorChatMessage[];
  attachedFiles: string[];
  /** Model override for this session. If null, uses global Settings default. */
  modelOverride?: { providerId: string; model: string };
}
```

## Architecture Sketch

```mermaid
flowchart TB
    subgraph Pane[AiEditorPane.tsx]
        Header[Header with model + agent dropdowns]
        SessionUI[Session history / new chat]
        Messages[Message list with code blocks]
        Input[Input area with @mention + image drop]
    end

    subgraph Hook[useAiEditorChat.ts]
        Send[send()] --> Context[buildEditorContext]
        Context --> Stream[streamChat]
        Stream --> Delta[onDelta updates]
    end

    subgraph Context[context.ts]
        ActiveFile[Active file content]
        Selection[Selected text from Monaco]
        OpenFiles[Open files list]
        Attached[Explicitly attached files]
        Tree[Project file tree]
    end

    Input -->|@mention| Attached
    Input -->|shift+drop| Image[Image base64]
    Image -->|vision model?| Send
    Monaco -->|selection| Selection
    Context -->|formatted prompt| Send
```
