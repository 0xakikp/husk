# Startup welcome

Husk shows its workspace welcome once per main-app launch, including after a
restart. It does not reopen on new tabs, shell restarts, laptop wake, window
focus, or preference updates. The separate Settings window does not show it.

- Returning users get a personalized greeting and **Continue workspace**. This
  dismisses the welcome without changing tabs, splits, or running commands.
- First-time users see the optional name field and **Open folder**. Returning
  users can change their name under **Personalize your greeting**.
- **Show on startup** can be disabled in the popup or under **Settings →
  Workspace → startup → showWelcomeOnStartup**. It defaults on for new and
  existing installations. This is independent of session restore and the
  fresh-terminal greeting banner.
- The command palette's **Welcome to Husk** action always opens it manually.
- The current workspace path and terminal tab count describe local app state,
  not whether a shell/SSH session is connected. Continue never replays commands.
- The folder picker only opens on request; cancellation leaves the welcome
  available. Ask Husk is hidden when AI is disabled. Opening the welcome does
  not send an AI request.

## Manual desktop check

1. Quit and relaunch Husk with startup welcome enabled. Confirm it appears once
   and that Continue leaves the restored tab/split layout unchanged.
2. Type in the terminal after continuing. Open another tab, blur/refocus the
   window, and sleep/wake the laptop: the popup must not reappear.
3. Disable Show on startup, dismiss, and relaunch. Confirm it stays hidden;
   open Welcome to Husk from the palette to re-enable it.
4. Cancel the native folder picker, then pick a folder. Only the successful
   explicit selection should change the workspace and dismiss the popup.
5. Check Escape, close, keyboard Tab navigation, and a short/narrow window.
   Focus stays inside while open, the heading starts in view, and overflowing
   content scrolls without hiding the footer controls.

Automated coverage: `src/welcome/WelcomeDialog.test.tsx`,
`src/welcome/useStartupWelcome.test.tsx`, and
`src/settings/preferences.test.ts`.
