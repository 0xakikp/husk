# Terminal connection and recovery

Terminal failures can occur without laptop sleep. New shells now buffer their
initial output until Husk subscribes and acknowledges attachment, avoiding lost
first prompts and startup exits. The terminal surface mounts immediately; slow
startup (10 seconds without output), launch errors, disconnected output and shell
exit have visible states instead of an unexplained blank pane.

New-tab UI actions call the tab creator without forwarding click events. Launch
directories are checked at runtime before entering pane state and again before
native IPC, including explicit restarts. Only nonempty strings without NUL bytes
are accepted; invalid objects fall back to a valid directory or the native default
without being coerced or serialized. This prevents the cyclic-JSON startup error
and the related failure to save tab layouts. Real rendered-button tests cover the
click boundary, and hook tests verify that a miswired caller still cannot store
an event as its directory.

Each terminal has its own bounded input queue and worker. Registry locks are held
only for session lookup/insertion/removal, never while writing, reading, closing
or resizing a terminal. Unix PTYs use nonblocking I/O with a two-second input
deadline. Both wall-clock and monotonic expiry are checked, because suspend need
not advance every monotonic clock. Failed/expired queued input is discarded, not
replayed. Partial writes are reported explicitly; inspect the prompt before
typing again. A native input call is limited to 256 KiB and 32 queued calls; the
frontend also caps pending input at 256 KiB. Windows uses a separate worker per
terminal so a blocked OS write does not lock other tabs; Windows native desktop
backpressure/suspend testing remains a release check.

One reader owns each PTY output stream. Interrupted reads retry; a real reader
failure is distinct from a confirmed shell exit. Startup buffering is capped at
1 MiB with backpressure on that terminal only. Legacy `husk cp` capture subscribes
to this same reader rather than competing for bytes or blocking a global lock.
It has a 4 MiB output cap and a maximum 30-second deadline, and incomplete capture
is an error. Its internal completion markers and kubeconfig metadata are excluded
from public output subscribers.

## Returning to Husk

Window focus, restored visibility and a long timer gap trigger a read-only check
of the visible terminal's native session state and a renderer refresh. This does
not prove that the foreground program is responsive, that shell startup finished,
or that a remote connection is healthy. Husk does not send Enter, Ctrl+C or a
shell command as a wake probe. It does not restart processes or reconnect SSH.
Focus is restored only when another input/menu/dialog does not own it.

**Check again** rechecks the same session. **Restart shell…** requires explicit
confirmation that the old shell and its jobs may be terminated. Only after the old
shell closes does Husk start a replacement, retaining xterm scrollback and resetting
terminal display modes. Commands and input are not replayed. If closing fails, no
replacement is started. Closing a tab during startup also closes a late-returning
PTY instead of leaking an orphan shell.

The normal app-close path saves pending chat data, removes its close listener and
uses the existing permitted native close operation. It prevents the SDK's implicit
`window.destroy` path; no new destroy permission is granted. Save/close failures
keep the window open with retry guidance.

## Retrying a failed command

The failure strip's **Retry** is an explicit resubmission, not a diagnosis or an
automatic fix. It requires the same terminal session, folder and SSH identity as
the failure, and a verified empty, idle prompt. It never clears existing input,
changes directories or falls back to another terminal. An unknown prompt is
reported as unverified, not as a claim that the user has typed something.

Prompt boundaries now follow xterm buffer markers through reflow of preceding
output and scrollback trimming instead of retaining fixed row coordinates. A
width change that could truncate existing input invalidates the boundary until
the shell supplies a fresh prompt. Erased/reset prompts and alternate-screen
applications cannot authorize execution. Unicode prompt columns use terminal
cells, and Home before a draft (including spaces) does not make that draft empty.

Retry waits for the native write result and prevents duplicate clicks while it
is pending. Rejected writes retain the failure; late acknowledgements cannot
remove a newer failure. Acceptance means the command was submitted, not that it
succeeded. For example, Git commands still need a Git repository as their working
directory—Retry does not repair an incorrect target folder.

## Ctrl+R history insertion

Selecting a history row inserts one reviewed command without Enter. It does not
clear the screen or replace existing input. If insertion is refused, the picker
keeps the search/selection and shows the reason inline with **Copy command**;
the warning is no longer hidden behind the history overlay. Pending selection
writes are locked against duplicate clicks and Enter presses.

Some shell themes emit OSC 133 `P;k=r` and a second `B` around the right prompt.
For example, Powerlevel10k does this when it inherits `TERM_PROGRAM=WarpTerminal`.
Husk previously mistook that second `B` for the editable input position, producing
“cannot verify an empty shell prompt” after the cursor returned to the left.
The tracker now preserves the left boundary and recognizes only the exact,
unchanged cells within explicitly marked right-prompt text. Unmarked text,
drafts at Home, stale/erased boundaries, incomplete markers, and alternate-screen
applications still cannot authorize insertion. Typing and width changes retire
the decoration evidence. This fix does not guess a prompt from its appearance.

For an older shell that does not emit prompt boundaries, open a new tab in the
updated app. Copy remains available if the shell integration cannot be verified.

## AI Run command and Task mode

AI code-block **Run command** uses the terminal's live connection and prompt
state in both normal chat and Task mode. A busy shell, existing input, unverified
prompt or rejected input queue is reported separately from a missing terminal.
Task events and the sent-command notice are created only after input is accepted
for delivery; this is not a claim that the command completed successfully.

Powerlevel10k can rebuild `PS1` after Husk's prompt hook and remove its ready
marker. Husk enables the theme's supported terminal-shell integration in the
current shell, without editing `.zshrc` or `.p10k.zsh`. Its prompt appearance is
unchanged. Duplicate Husk/theme command marks are processed once, including the
empty-command marks a theme may emit on Enter; private kubeconfig metadata is
not discarded by duplicate completion marks. Plain zsh retains Husk's appended
prompt marker. This bundled-script fix requires rebuilding/restarting Husk and
opening a new terminal tab; frontend hot reload alone does not update shells
already running.

## Verification and release checks

Automated coverage uses local fake transports, bounded writer/reader fixtures and
a real PTY attached to a test executable—not the user's shell, startup files,
credentials or remote hosts. Tests cover first-prompt delivery, typing, interrupted
reads, blocked input isolation, capture deadlines, late responses, no input replay,
explicit restart and the installed SDK's close wrapper with destroy denied.

Before release, run these in a disposable desktop session:

1. Open several tabs rapidly; each should display a prompt and accept typing.
2. Keep a local job running, switch applications, then return. Check that it remains
   the same job and that an AI/search input keeps focus when appropriate.
3. Sleep/wake and minimize/restore Husk with both idle and busy tabs. Verify existing
   tabs and newly opened tabs. Do not use production jobs for this test.
4. End a disposable shell normally. Check the exited notice and explicit restart,
   retained scrollback, and absence of replayed commands.
5. Test a deliberately slow startup in an isolated shell setup. Confirm the slow
   notice appears; cancelling/restarting should not create duplicate shells.
6. Close normally with and without pending chat edits. Verify persistence and no
   `plugin:window|destroy not allowed by ACL` rejection.
7. In a disposable tab, run a harmless failing command such as `false`, resize
   the window/sidebar with the prompt empty, and click Retry. Then type an
   unfinished command, move to its beginning, expand the failure strip and verify
   Retry refuses without changing the input. Repeat with a spaces-only draft.
8. With Powerlevel10k, use Task mode to run an AI shell block from an empty prompt
   after several ordinary commands, empty Enter presses and window resizes.
   Verify one submission and one Task event. With a real draft or a busy shell,
   verify the specific refusal and that neither the draft nor the Task is changed.

Native changes require rebuilding/restarting Husk; frontend hot reload alone is
insufficient. The user's intermittent overnight symptom still needs a real desktop
confirmation after installing the updated native build.
