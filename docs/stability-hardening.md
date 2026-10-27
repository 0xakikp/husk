# Stability hardening on the 0.8.12 source

The affected installation is on another machine running 0.8.12. This laptop's
older installed application and its logs are not evidence of that incident's
cause. These changes address reproducible code-level risks, not a confirmed
diagnosis of the reported macOS termination.

## Implemented

- **Native shell work:** shell commands and binary discovery now execute off
  the native UI/IPC thread. Eight workers maximum; waiting for capacity expires
  after two seconds without executing the rejected request later. Existing
  subprocess deadlines, output limits and no-shell command policy remain.
- **MCP:** bounded per-server input queues, cancellable async pipe I/O, send
  deadlines and independent stop signals replace global-lock-held writes.
  A timed-out/partially written protocol stream is stopped, never replayed.
  Discovery is time-bounded, while explicitly configured wrappers and paths
  containing spaces remain supported. Close-during-spawn disposes late children;
  stale receives are ignored; final output is drained before reporting exit.
- **Terminal output:** each PTY has a 256 KiB renderer credit window, returned
  only after xterm has parsed its packets. A slow renderer pauses that terminal's
  producer instead of growing an unlimited webview queue. Startup output stays
  bounded at 1 MiB. ACK retries are idempotent and never restart a shell or replay
  commands. Shutdown wakes blocked readers. Existing scrollback limits apply.
- **Beautiful Logs:** completed rows are bounded by count and total UTF-8 bytes;
  partial/oversized lines and escape sequences cannot grow indefinitely. Long
  lines are visibly shortened in this preview, not in the terminal. Updates are
  batched every 80 ms, rows are memoized and timestamp formatting is reused.
- **AI replies:** text updates are batched at 50 ms with a bounded pending queue;
  tool/error/completion/explicit-stop transitions flush received text first.
  Completed-message parsing/rendering is cached without freezing action handlers
  to an old workspace. Request cancellation and session guards remain in place.
- **Diagnostics:** native reporting uses the real package version instead of
  `0.3.0`, starts disabled until the saved privacy preference is synchronized,
  and honors live opt-out. Native events contain only fixed panic metadata,
  not panic payloads, commands, terminal output, credentials or full paths.
  A single latest-panic record is stored locally. Settings → About Husk →
  Troubleshooting → Copy diagnostics exports build information and that record
  only on request. Reporting already handed to the network before opt-out
  cannot be recalled.

Rust panic hooks do not catch OS kills, WebKit-process crashes, force quits or
all hangs. No panic record does **not** mean no crash occurred. The affected
machine's macOS crash/hang report and incident time are still needed.

## Regression coverage

- Noisy producer / slow renderer (8 MiB), packet order, startup/early exit,
  duplicate/future ACKs, retry after timeout, close while stalled, independent
  PTYs and native capture.
- Real xterm parser callbacks, including an asynchronous OSC handler while the
  terminal is not mounted in a visible DOM.
- Isolated MCP fixture process that never reads stdin, bounded queue saturation,
  independent sessions, cancellation, wake-expired input, final-response races
  and close while spawning/receiving. No real MCP servers or accounts are used.
- Huge/unfinished log lines, split ANSI sequences, batch cancellation on
  unmount/tab switch, token bursts and message cache invalidation.
- Content-free diagnostic records, correct version, corrupt/oversized record
  handling, consent transport gating with a fake sink, and clipboard failures.

## Follow-up scan: separate work, not yet implemented

1. **AI CLI bridge (`src-tauri/src/ai_cli.rs`):** synchronous discovery/start
   commands still do filesystem/process work on the IPC thread. Stdout/stderr
   use unbounded `BufRead::lines`, and emitted events lack consumer flow control.
   A huge unterminated JSON line or very chatty CLI can pressure memory. The exit
   worker joins readers without a deadline; inherited pipes can delay cleanup.
   Next: bounded protocol framing/transport and off-thread lifecycle handling,
   preserving the CLI action-approval boundaries.
2. **Background jobs (`src-tauri/src/jobs.rs`):** removing the registry handle
   relies on `Drop` to stop the process, but reader/waiter threads retain strong
   references. A removed running job can survive. Exit is published before both
   output readers finish, so the last bytes can be missed. Finished jobs retain
   their bounded buffers until removal. Next: explicit stop/reap ownership,
   final-drain coordination and a retention policy.
3. **Other synchronous native operations:** Ports runs `lsof.output()` without
   a deadline; history reads the entire history file; file operations and config
   operations use synchronous IPC; the vitals command initializes `System::new_all`
   despite needing only CPU/memory. Next: bounded background work, bounded reads
   and narrower system refreshes. Network-mounted files need particular care.
4. **Polling:** File Explorer Git status and clipboard polling have no in-flight
   guard; Explorer can also apply an old workspace's late response. Next: serial,
   cancellation-aware polling and stale-result guards. The terminal status-bar
   Git poll already has an in-flight guard; these findings are not universal.

These are source findings with identifiable failure paths, not proof that any
one caused the user's 0.8.12 crash. No installed app was replaced or restarted,
and no user's terminal sessions were terminated during verification.

## Verification results

- Frontend: 203 test files, 2,819 tests passed; two existing tests skipped.
- Native: 157 Rust tests passed, including isolated subprocess/PTY fixtures.
- TypeScript, Rust formatting for changed native files and `git diff --check`
  passed.
- Production Vite build and startup bundle budgets passed (about 235 KiB entry,
  1,497 KiB application shell, no optional-feature preloads).
- Native Tauri release compilation passed offline on this Mac. The existing
  lifetime-style warning in `port_forward.rs` remains; Vite also retains its
  existing large-chunk/mixed-import warnings.
- No signed/notarized installer, release upload or installed-app replacement
  was performed. The native IPC and frontend changes must ship together.

This is automated regression/build verification, not a long-running soak test
on the machine that experienced the crash.
