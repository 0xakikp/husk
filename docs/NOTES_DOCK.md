# Notes beside the terminal

Notes open below the terminal by default. This is one workspace-level dock below
the complete split group, not another terminal split. The AI composer keeps its
own column and dimensions. Logs and Kubernetes/Docker details share the dock via
tool tabs, so panels do not stack.

- Open several notes from the sidebar: each gets a switchable tab within Notes.
- Drag the dock's top edge to resize it, or focus the separator and use Up/Down.
- Collapse keeps all drafts. It returns keyboard focus to the terminal.
- Use **Open note in full tab** to promote a note; each promoted note gets a
  normal top-level file tab. **Move note below terminal** returns to the dock.
- The **…** menu chooses the default opening mode. A one-off promotion does not
  change that preference.
- Save using Cmd+S / Ctrl+S. The header and note tabs indicate unsaved changes.
  Closing an unsaved panel note asks you to save first; collapsing is always safe.

The same editor and per-file models are reused when changing views. Unsaved text,
undo history, cursor and scroll position are retained within the current app
session; this is not crash recovery or automatic saving. Only the preferred
opening mode and dock height are persisted, never note contents in localStorage.
Notes remain local even while browsing SSH files.

If the window or a vertical split leaves too little height, the dock collapses
to its header. The full-tab action remains available. Resizing the window larger
does not automatically expand the dock or rearrange terminal splits.

## Manual desktop checks

1. Open two notes, edit both without saving, switch between them, collapse and
   expand, promote each to a full tab, then return below the terminal. Verify
   both drafts, selection, scroll and undo remain intact.
2. Save a note, edit again, switch notes, undo back to the saved content, and
   check the save indicator. Verify a failed save stays unsaved.
3. Test horizontal, vertical and uneven terminal splits. Resize the window and
   the dock; confirm every terminal stays mounted and the AI composer does not
   shrink. In cramped layouts, open the note in a full tab.
4. Switch Notes → Logs → Kubernetes/Docker → Notes. Verify only one dock appears
   and no note edits are lost. Resource selections stay in their selected context.
5. Select an SSH host, then open a local note from Notes and Cmd+K. Verify it
   still reads/writes the local note. Test a Vault Lens line result after a cold
   editor load.
6. Change the Notes default to full tab and relaunch. Check that a one-off move
   below the terminal leaves the stored default unchanged.

Automated coverage includes dock geometry and keyboard/pointer resizing, editor
model identity and dirty state, asynchronous save/reload guards, visibility and
focus, source-safe routing, note retention/preferences, stable DOM relocation,
and shared-dock integration. Native desktop interaction still merits a smoke test.
