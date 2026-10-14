# Terminal splits

Split terminals have independent rounded frames with 6px gutters. A compact
header labels each pane `Terminal 1`, `Terminal 2`, etc. in layout order. The
active pane has an accent border and an `Active` label. These are pane labels,
not claims about the shell's host or connection status.

- Click a pane label to focus its terminal, including an already-active pane.
- Close controls appear on hover or keyboard focus; touch devices show them.
- Drag the short center grip to resize. Double-click it to balance that split.
- Tab to a grip and use Left/Right or Up/Down arrows to resize by 2 percentage
  points (Shift: 10). Home/End use the 15%/85% limits; Enter balances the split.
- Single-terminal tabs retain their existing layout without pane headers.

Pane chrome is outside xterm. It does not send commands, probe remote hosts,
or enter shell history. Resizing and focus changes reuse existing terminal
components and sessions. Only the close action closes a terminal.

## Manual checks in Husk

1. Create a side-by-side split and stack another terminal inside one half.
2. Click labels and type into each pane; check the active frame follows focus.
3. Drag both grips, then resize repeatedly using the keyboard and balance them.
4. Open terminal history, autocomplete, and a context menu near a split edge;
   check overlays retain their viewport positioning.
5. Check a narrow window, light/dark themes, and a wallpaper. Close back to one
   pane; ensure its header disappears and remaining scrollback is preserved.
