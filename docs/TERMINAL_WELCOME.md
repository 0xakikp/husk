# Fresh-terminal welcome

Fresh local terminals show a compact app-rendered welcome above the shell. It
greets you with **Hi, name**, using Settings → Workspace → profile (not the OS
login name). Blank names fall back to Welcome to HUSK. Short Latin names and digits use colorful block
lettering; long or non-Latin names retain their original text. Colors follow the
terminal theme, with darker tones for light mode.
The compact status group includes platform-appropriate Search and New tab
shortcuts alongside Ctrl+R History, without extra buttons or panels.

The local status appears only after observed local prompt metadata; the working
directory is not displayed. The greeting uses a gentle slant and shares the
terminal's background/vignette, with no divider or separate panel surface. No
shell type is guessed and no diagnostic commands or environment probes are run.
Terminals without supported local prompt metadata simply skip the welcome.

- Typing, pressing Enter, and ordinary commands keep the welcome visible.
  Once its first page fills, the greeting moves upward row-by-row with output
  until it leaves view, rather than abruptly vanishing. Clear removes it
  immediately. Remote/alternate-screen transitions and explicit shell restarts also
  retire it. The dismiss button leaves the shell untouched.
- It does not return when switching tabs, waking the laptop, reattaching the
  terminal, or returning from SSH. Restored sessions retain their existing
  restored-session notice instead.
- The welcome is outside xterm: it is not shell output, scrollback, command
  history, or AI terminal context. Dismissal never clears the terminal.
- Narrow splits use a plain heading; very short splits hide the welcome to
  preserve room for the prompt. No height animation repeatedly resizes the PTY.
- Disable it using **Settings → Workspace → terminal → welcomeBanner**.

## Desktop smoke checks

1. Set a profile name, open a new local tab, and check its slanted lettering,
   local status, and platform-correct Search shortcut. Test blank, long, and
   non-Latin names, dark/light themes, and narrow/short splits.
2. Type, press Enter, and run a short command: the welcome stays. Clear the
   terminal: the welcome disappears. Fill its first page with output: the welcome
   moves up with subsequent lines until it leaves view. Output
   and scrolling/focus still work. Return to the tab: it stays gone.
3. Open SSH, restart a shell explicitly, and restore an app session: no welcome
   appears over the remote/restored shell. No connection or diagnostic is added.
4. Dismiss via the button and type immediately. Disable welcomeBanner, reopen
   the app, and confirm the preference is retained for new tabs.

Automated coverage uses passive metadata and mock native transports; it does
not log in to remote environments. Native desktop smoke testing remains useful.
