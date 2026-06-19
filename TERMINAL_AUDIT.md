# Husk Terminal Feature Audit
# Created before Option B refactor (module-level registry + pool)
# Cross-reference this during/after refactor to verify no features are lost

## Core Terminal Infrastructure
- [ ] xterm.js Terminal instance creation with options
- [ ] Font family from preferences (fontStack)
- [ ] Font size from preferences
- [ ] Cursor blink from preferences
- [ ] Cursor style from preferences
- [ ] Scrollback from preferences
- [ ] allowProposedApi: true
- [ ] allowTransparency: true
- [ ] Theme: terminalTheme + dark/light + background enabled + accentColor

## Addons
- [ ] FitAddon loaded and used
- [ ] SearchAddon loaded and used
- [ ] WebLinksAddon (if present)

## PTY Lifecycle
- [ ] pty_spawn with cols, rows, cwd
- [ ] pty_kill on cleanup
- [ ] pty_write for data
- [ ] pty_resize with dedupe (lastCols/lastRows)
- [ ] Listen to pty://data/{id} for output
- [ ] Listen to pty://exit/{id} for exit
- [ ] disposed flag for StrictMode handling

## Resize Behavior
- [ ] ResizeObserver on container
- [ ] 150ms debounce (snap-on-settle)
- [ ] 500ms max-wait interval for continuous resize
- [ ] Skip fit when container width/height is 0 (inactive tab)
- [ ] term.onResize → pty_resize with dedupe
- [ ] scrollToBottom after fit

## Search
- [ ] Ctrl/Cmd+F opens search bar
- [ ] findNext/findPrevious with query
- [ ] Incremental search
- [ ] clearDecorations on close
- [ ] Escape closes search
- [ ] Enter finds next, Shift+Enter finds previous
- [ ] Auto-focus input when opened

## History
- [ ] Ctrl+R opens history picker
- [ ] Async loading from getShellHistory()
- [ ] Display command list
- [ ] Select command → pty_write (no newline, user can edit)
- [ ] Close button

## Context Menu
- [ ] Right-click opens menu
- [ ] Copy: writeText selection, clearSelection
- [ ] Paste: readText → pty_write
- [ ] Select All: term.selectAll()
- [ ] Clear: term.clear(), focus()
- [ ] Find: opens search
- [ ] History: opens history
- [ ] Split right/down (if onSplit provided)
- [ ] Close pane (if onClose && canClose)
- [ ] Menu clamped to viewport
- [ ] Backdrop click closes menu

## Click-to-Position Cursor
- [ ] Click in command area sends arrow keys to position cursor
- [ ] Uses prompt position (OSC 133 B)
- [ ] Calculates cell width/height from screen element
- [ ] Only works in normal buffer (not alt-screen)
- [ ] Only works when no selection
- [ ] Only works when no command running
- [ ] Mouse hover shows "text" cursor in command area

## OSC Handlers
- [ ] OSC 7: parseOsc7Cwd → cwdRef, setActiveTerminalCwd
- [ ] OSC 133 A: clear prompt position
- [ ] OSC 133 B: set prompt position (cursorY+viewportY, cursorX)
- [ ] OSC 133 C: markCommandStart
- [ ] OSC 133 D: setActiveTerminalExit, clearCurrentCommand
- [ ] OSC 778: husk;cmd; → setCurrentCommand
- [ ] OSC 777: parseBridgeOsc → dispatchBridge

## AI Integration
- [ ] setActiveTerminalReader: returns last 8KB of buffer (bottom-up, reversed)
- [ ] setActiveTerminalRunner: pty_write with \r
- [ ] setActiveTerminalTyper: pty_write text
- [ ] setActiveTerminalSearchOpener: opens search
- [ ] setActiveTerminalSearcher: opens search with query
- [ ] setTerminalLineReader: reads current line at cursor
- [ ] setAiPtyWriter: writes data to PTY
- [ ] interceptTerminalInput: swallows /ai commands
- [ ] markCommandStart: tracks command start
- [ ] setCurrentCommand: tracks command text
- [ ] clearCurrentCommand: clears on exit
- [ ] isCommandRunning: checks if command active
- [ ] setPromptPosition/getPromptPosition: cursor tracking
- [ ] setFocusTerminalFn: exposes focus function

## Autocomplete
- [ ] useAutocomplete hook
- [ ] scheduleCheck on data input
- [ ] accept: fills suggestion
- [ ] navigate: up/down through suggestions
- [ ] dismiss: hides bar
- [ ] AutocompleteBar overlay positioned at cursor
- [ ] Tab accepts, ArrowUp/Down navigates, Escape dismisses

## Key Bindings (attachCustomKeyEventHandler)
- [ ] Cmd/Ctrl + F: open search
- [ ] Ctrl + R: open history
- [ ] Cmd/Ctrl + C + hasSelection: copy to clipboard
- [ ] Cmd/Ctrl + V: paste (preventDefault), readText → pty_write
- [ ] Cmd + D: split right (onSplit)
- [ ] Cmd + Shift + D: split down (onSplit)
- [ ] Cmd + Alt + Arrow: focus direction (onFocusDirection)
- [ ] Tab (when autocomplete visible): accept
- [ ] ArrowDown (when autocomplete visible): navigate down
- [ ] ArrowUp (when autocomplete visible): navigate up
- [ ] Escape (when autocomplete visible): dismiss

## Split/Pane System
- [ ] Binary tree: leaf | split (row/col with ratio)
- [ ] newLeaf(initialCwd)
- [ ] splitPane(node, leafId, dir, makeLeaf)
- [ ] removePane(node, leafId) → collapses to sibling
- [ ] setRatio(node, splitId, ratio)
- [ ] firstLeaf(node)
- [ ] leafCount(node)
- [ ] PaneView renders tree recursively
- [ ] SplitView with draggable divider
- [ ] Divider onMouseDown sets ratio
- [ ] TerminalStack: all tabs mounted, display:none for inactive
- [ ] focusLeaf, closeLeaf, focusLeafDirection, ratioLeaf

## Tab Behavior
- [ ] All tabs stay mounted (display:none)
- [ ] PTY survives tab switch
- [ ] Active tab gets focus
- [ ] Inactive tab: skip fit on 0-size container

## Preferences Integration
- [ ] subscribePrefs for live updates
- [ ] fontSize, fontFamily, cursorBlink, cursorStyle, scrollback, theme
- [ ] 90ms debounced refit on preference change

## Cleanup
- [ ] disposed flag for StrictMode
- [ ] pty_kill on unmount
- [ ] resizeObserver.disconnect()
- [ ] clearTimeout(resizeTimer)
- [ ] clearInterval(maxWaitTimer)
- [ ] term.dispose()
- [ ] termRef, searchRef, fitRef, ptyIdRef cleared

## Refs Used
- [ ] containerRef: xterm container div
- [ ] termRef: Terminal instance
- [ ] searchRef: SearchAddon
- [ ] fitRef: FitAddon
- [ ] ptyIdRef: PTY ID number
- [ ] activeRef: boolean for active tab
- [ ] cwdRef: string last cwd
- [ ] hostRef: wrapper div for click handling
- [ ] screenRef: .xterm-screen element

## State
- [ ] searchOpen, query
- [ ] historyOpen, historyEntries, historyLoading
- [ ] menu {x, y}
- [ ] autoState from useAutocomplete

## Props Interface
- [ ] active?: boolean
- [ ] initialCwd?: string
- [ ] onSplit?: (dir: "row" | "col") => void
- [ ] onClose?: () => void
- [ ] canClose?: boolean
- [ ] onFocus?: () => void
- [ ] onFocusDirection?: (dir: "left" | "right" | "up" | "down") => void
