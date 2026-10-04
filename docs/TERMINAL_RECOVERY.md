# Terminal connection and recovery

Terminal failures can occur without laptop sleep. New shells now buffer their
initial output until Husk subscribes and acknowledges attachment, avoiding lost
first prompts and startup exits. The terminal surface mounts immediately; slow
startup (10 seconds without output), launch errors, disconnected output and shell
exit have visible states instead of an unexplained blank pane.

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

Native changes require rebuilding/restarting Husk; frontend hot reload alone is
insufficient. The user's intermittent overnight symptom still needs a real desktop
confirmation after installing the updated native build.
