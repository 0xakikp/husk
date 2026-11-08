# Terminal history and clearing

Husk distinguishes a live shell, its visible output, and a restored layout. Waking a sleeping Mac normally keeps the same shell and in-memory scrollback. Quitting or restarting creates a fresh shell; commands and processes are never replayed.

## Clear without losing your work

- A normal shell's full-screen clear preserves the previous page and scrollback. Scroll up to see earlier work, within the configured line limit.
- Right-click **Clear screen** asks a verified interactive shell to redraw using Ctrl+L. It does not submit or replace your draft. This action is unavailable during running commands, full-screen apps, or when Husk cannot verify a shell prompt.
- Right-click **Erase scrollback…** and confirm to delete that pane's saved snapshot and in-memory scrollback. The current cursor line and the shell's own command history remain. This cannot be undone.
- Full-screen applications retain their alternate-screen semantics. Explicit terminal resets still reset the live buffer. Husk does not override shell aliases or install a replacement `clear` command.

The default live scrollback is 10,000 lines for new/default configurations. Existing explicit settings are preserved. This is a bounded history, not an unlimited log.

## Opt-in restoration across launches

Search Settings for **Restore terminal history**. It is off by default and separate from **Restore session**, which restores the pane layout. Both are needed to see saved output in its original panes after launch.

Enabling recording allows current and future normal-buffer output to be saved locally in the application's IndexedDB storage. It is plain text, **not encrypted by Husk**, and may contain credentials or confidential information you printed. It is not included in settings backups, uploaded, or sent to AI by this recording feature. The recording-consent toggle is excluded from settings import/export; enable it on each device deliberately.

Limits:

- Up to 10,000 visual rows or 1 MiB per pane, and 20 MiB total (at most 256 snapshots). The oldest snapshots are removed to stay within the total limit.
- Inactive snapshots expire seven days after their last save by default, configurable from 1–30 days. Expiration is checked on archive access and hourly while recording is enabled in an open app. Closed apps cannot run background cleanup.
- Output is periodically checkpointed, approximately every five seconds while it changes. Husk also attempts a save when hidden and awaits terminal-history saves during normal window close. A crash, forced quit, or power loss can lose the latest uncommitted output.
- Restored output is historical plain text; original visual rows remain separate. Colors, interactive links, full-screen application frames, shell variables, remote connections, prompt metadata, and running jobs are not restored.

Restored text appears above a **New shell · commands are not replayed** boundary. It is sanitized and loaded before live terminal action handlers are installed. It cannot execute saved commands, trigger Husk bridge actions, or restore a stale SSH identity. A failed restore does not overwrite the saved snapshot; the fresh shell can still start and a warning is shown.

Turning recording off deletes saved snapshots. **Delete saved terminal history** in Settings deletes all snapshots without clearing the live terminals or shell command histories. Existing visible rows are excluded from subsequent recording after deletion; new output can still be saved when recording remains enabled. Closing a pane removes its snapshot. Deletions invalidate queued snapshots, including writes from other windows.

This feature cannot recover output that was never saved by an earlier version. Ctrl+R may still show commands retained by your shell, but shell history does not contain their output.

## Release checks

Use a disposable workspace and harmless sample output, not real secrets:

1. Fill several pages, type `clear`, and scroll up. Repeat Ctrl+L and right-click Clear screen, including an unsubmitted multiline draft. Confirm nothing executes.
2. Run an alternate-screen application, redraw, resize, then exit. Its frames must not become archived shell history. Verify Clear screen is unavailable while a foreground job is running.
3. Enable recording, produce sample output in two tabs and split panes, quit normally, and reopen. Each pane should show only its own saved output above a fresh shell. Verify commands do not rerun and remote state is not fabricated.
4. Delete one pane's scrollback; then delete all saved history from a separate Settings window while output is arriving. Neither pending saves nor a subsequent restart may resurrect deleted output.
5. Disable recording during a delayed restore. No delayed text may appear or be saved. Check default-off behavior and settings import/export consent isolation.
6. Simulate full/unavailable storage and interrupted writes. Show a warning, keep the terminal usable, and prevent normal close from silently claiming a failed final save succeeded. Verify retention, byte limits, and malformed snapshot rejection.

Automated tests use real xterm buffers and isolated fake IndexedDB stores. Packaged macOS sleep/shutdown and native-close smoke checks remain necessary before release.
