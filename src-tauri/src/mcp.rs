//! MCP server process bridge.
//!
//! Spawns a validated MCP server with piped stdio and shuttles JSON-RPC lines
//! to the frontend. Output is deliberately bounded: a broken or hostile server
//! cannot grow Husk's memory without limit while the webview is busy.

use std::collections::{HashMap, VecDeque};
use std::process::Stdio;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use tauri::State;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, watch, OwnedSemaphorePermit, Semaphore};

use crate::shell::{resolve_configured_program, run_blocking_command};

const MAX_QUEUED_LINES: usize = 512;
const MAX_QUEUED_BYTES: usize = 4 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 16 * 1024;
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const MAX_INPUT_MESSAGES: usize = 8;
const SEND_TIMEOUT: Duration = Duration::from_secs(2);
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const EXIT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone, Copy)]
struct SendDeadline {
    instant: Instant,
    wall: SystemTime,
}

impl SendDeadline {
    fn after(duration: Duration) -> Self {
        Self {
            instant: Instant::now() + duration,
            wall: SystemTime::now() + duration,
        }
    }

    // Wall time prevents queued messages replaying after a suspended laptop
    // wakes on platforms whose monotonic clock excludes suspend.
    fn remaining(self) -> Duration {
        self.instant.saturating_duration_since(Instant::now()).min(
            self.wall
                .duration_since(SystemTime::now())
                .unwrap_or_default(),
        )
    }
}

struct WriteRequest {
    bytes: Vec<u8>,
    deadline: SendDeadline,
    result: oneshot::Sender<Result<(), String>>,
}

#[derive(Default)]
struct McpQueue {
    lines: VecDeque<String>,
    bytes: usize,
}

impl McpQueue {
    fn push(&mut self, line: String) -> Result<(), &'static str> {
        let bytes = line.len();
        if bytes > MAX_LINE_BYTES {
            return Err("MCP server sent a message larger than 1 MB");
        }
        if self.lines.len() >= MAX_QUEUED_LINES
            || self.bytes.saturating_add(bytes) > MAX_QUEUED_BYTES
        {
            return Err("MCP server produced more output than Husk could safely buffer");
        }
        self.bytes += bytes;
        self.lines.push_back(line);
        Ok(())
    }

    fn drain(&mut self, limit: usize) -> Vec<String> {
        let take = limit.min(self.lines.len());
        let mut drained = Vec::with_capacity(take);
        for _ in 0..take {
            if let Some(line) = self.lines.pop_front() {
                self.bytes = self.bytes.saturating_sub(line.len());
                drained.push(line);
            }
        }
        drained
    }
}

struct McpRuntime {
    process_exited: bool,
    stdout_closed: bool,
    exit_code: Option<i32>,
    error: Option<String>,
    stderr_tail: Vec<u8>,
}

impl Default for McpRuntime {
    fn default() -> Self {
        Self {
            process_exited: false,
            stdout_closed: false,
            exit_code: None,
            error: None,
            stderr_tail: Vec::new(),
        }
    }
}

struct McpSession {
    input: mpsc::Sender<WriteRequest>,
    stop: watch::Sender<bool>,
    process_done: watch::Receiver<bool>,
    recv_queue: Arc<Mutex<McpQueue>>,
    runtime: Arc<Mutex<McpRuntime>>,
    _slot: OwnedSemaphorePermit,
}

impl Drop for McpSession {
    fn drop(&mut self) {
        self.stop.send_replace(true);
    }
}

impl McpSession {
    fn ensure_running(&self) -> Result<(), String> {
        let runtime = self.runtime.lock().map_err(|e| e.to_string())?;
        if *self.stop.borrow()
            || runtime.process_exited
            || runtime.stdout_closed
            || runtime.error.is_some()
        {
            return Err("MCP server is no longer running".into());
        }
        Ok(())
    }

    async fn send(&self, message: String, timeout: Duration) -> Result<(), String> {
        self.ensure_running()?;
        if message.len() > MAX_INPUT_BYTES {
            return Err("MCP input exceeds 1 MB. This message was not sent.".into());
        }
        let deadline = SendDeadline::after(timeout);
        let mut bytes = message.into_bytes();
        bytes.push(b'\n');
        let (result, received) = oneshot::channel();
        self.input
            .try_send(WriteRequest {
                bytes,
                deadline,
                result,
            })
            .map_err(|error| match error {
                mpsc::error::TrySendError::Full(_) => {
                    "MCP input is busy. This message was not queued.".to_string()
                }
                mpsc::error::TrySendError::Closed(_) => {
                    "MCP input is unavailable. This message was not sent.".to_string()
                }
            })?;
        let mut stopped = self.stop.subscribe();
        tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped) => Err("MCP server stopped. Pending input was discarded.".into()),
            result = tokio::time::timeout(deadline.remaining(), received) => match result {
                Ok(Ok(result)) => result,
                Ok(Err(_)) => Err("MCP input worker stopped. Input was not retried.".into()),
                Err(_) => {
                    stop_with_error(&self.runtime, &self.stop, input_timeout());
                    Err(input_timeout().into())
                }
            },
        }
    }
}

#[derive(Default)]
pub struct McpState {
    sessions: Mutex<HashMap<u32, Arc<McpSession>>>,
}

impl McpState {
    fn session(&self, id: u32) -> Result<Arc<McpSession>, String> {
        self.sessions
            .lock()
            .map_err(|e| e.to_string())?
            .get(&id)
            .cloned()
            .ok_or_else(|| "mcp session not found".into())
    }
}

#[derive(Serialize)]
pub struct McpReceive {
    lines: Vec<String>,
    running: bool,
    exit_code: Option<i32>,
    error: Option<String>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static SESSION_SLOTS: OnceLock<Arc<Semaphore>> = OnceLock::new();

fn input_timeout() -> &'static str {
    "MCP input timed out. The server was stopped; unsent input was discarded and will not be replayed."
}

async fn wait_for_stop(stop: &mut watch::Receiver<bool>) {
    while !*stop.borrow_and_update() {
        if stop.changed().await.is_err() {
            return;
        }
    }
}

fn stop_with_error(
    runtime: &Arc<Mutex<McpRuntime>>,
    stop: &watch::Sender<bool>,
    message: impl Into<String>,
) {
    if let Ok(mut state) = runtime.lock() {
        if state.error.is_none() {
            state.error = Some(message.into());
        }
    }
    stop.send_replace(true);
}

fn enqueue_line(
    raw: &[u8],
    queue: &Arc<Mutex<McpQueue>>,
    runtime: &Arc<Mutex<McpRuntime>>,
    stop: &watch::Sender<bool>,
) -> bool {
    let line = match String::from_utf8(raw.to_vec()) {
        Ok(line) => line.trim_end_matches('\r').to_owned(),
        Err(_) => {
            stop_with_error(runtime, stop, "MCP server sent non-UTF-8 output");
            return false;
        }
    };
    if line.trim().is_empty() {
        return true;
    }
    let result = queue
        .lock()
        .map_err(|_| "MCP output queue is unavailable")
        .and_then(|mut q| q.push(line));
    if let Err(message) = result {
        stop_with_error(runtime, stop, message);
        return false;
    }
    true
}

/// Fixed-size reads prevent one unterminated JSON line from allocating without
/// limit before the normal queue limits can be applied.
async fn pump_stdout(
    mut stdout: impl AsyncRead + Unpin,
    queue: Arc<Mutex<McpQueue>>,
    runtime: Arc<Mutex<McpRuntime>>,
    stop: watch::Sender<bool>,
) {
    struct MarkStdoutClosed(Arc<Mutex<McpRuntime>>);
    impl Drop for MarkStdoutClosed {
        fn drop(&mut self) {
            if let Ok(mut state) = self.0.lock() {
                state.stdout_closed = true;
            }
        }
    }
    let _mark_closed = MarkStdoutClosed(Arc::clone(&runtime));
    let mut stopped = stop.subscribe();
    let mut chunk = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        let read = match tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped) => return,
            read = stdout.read(&mut chunk) => read,
        } {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                stop_with_error(
                    &runtime,
                    &stop,
                    format!("Could not read MCP output: {error}"),
                );
                return;
            }
        };
        for &byte in &chunk[..read] {
            if byte == b'\n' {
                if !enqueue_line(&pending, &queue, &runtime, &stop) {
                    return;
                }
                pending.clear();
            } else {
                pending.push(byte);
                if pending.len() > MAX_LINE_BYTES {
                    stop_with_error(
                        &runtime,
                        &stop,
                        "MCP server sent a message larger than 1 MB",
                    );
                    return;
                }
            }
        }
    }
    if !pending.is_empty() {
        let _ = enqueue_line(&pending, &queue, &runtime, &stop);
    }
}

async fn pump_stderr(
    mut stderr: impl AsyncRead + Unpin,
    runtime: Arc<Mutex<McpRuntime>>,
    mut stopped: watch::Receiver<bool>,
) {
    let mut chunk = [0_u8; 4096];
    loop {
        let read = match tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped) => return,
            read = stderr.read(&mut chunk) => read,
        } {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        if let Ok(mut state) = runtime.lock() {
            state.stderr_tail.extend_from_slice(&chunk[..read]);
            if state.stderr_tail.len() > MAX_STDERR_BYTES {
                let excess = state.stderr_tail.len() - MAX_STDERR_BYTES;
                state.stderr_tail.drain(..excess);
            }
        }
    }
}

/// Each server owns one bounded, cancellable writer. A timed-out or partial
/// JSON-RPC line poisons the connection: it must never resume after timeout.
async fn pump_input(
    mut stdin: impl AsyncWrite + Unpin,
    mut queued: mpsc::Receiver<WriteRequest>,
    runtime: Arc<Mutex<McpRuntime>>,
    stop: watch::Sender<bool>,
) {
    let mut stopped = stop.subscribe();
    loop {
        let request = tokio::select! {
            biased;
            _ = wait_for_stop(&mut stopped) => return,
            request = queued.recv() => match request { Some(request) => request, None => return },
        };
        let mut written = 0;
        let result = loop {
            if request.result.is_closed() {
                break Err("MCP input request was cancelled. Pending input was discarded.".into());
            }
            let remaining = request.deadline.remaining();
            if remaining.is_zero() {
                break Err(input_timeout().to_owned());
            }
            if written == request.bytes.len() {
                break Ok(());
            }
            let end = request.bytes.len().min(written + 4096);
            let write = tokio::select! {
                biased;
                _ = wait_for_stop(&mut stopped) => return,
                write = tokio::time::timeout(remaining.min(Duration::from_millis(100)), stdin.write(&request.bytes[written..end])) => write,
            };
            match write {
                Ok(Ok(0)) => break Err("MCP server accepted no input.".into()),
                Ok(Ok(count)) => written += count,
                Ok(Err(error)) if error.kind() == std::io::ErrorKind::Interrupted => {}
                Ok(Err(error)) => break Err(format!("MCP input failed: {error}")),
                Err(_) => continue, // Recheck wall-clock expiry after sleep/wake.
            }
        };
        if let Err(error) = &result {
            stop_with_error(&runtime, &stop, error.clone());
        }
        let failed = result.is_err();
        let _ = request.result.send(result);
        if failed {
            return;
        }
    }
}

async fn monitor_child(
    mut child: Child,
    runtime: Arc<Mutex<McpRuntime>>,
    stop: watch::Sender<bool>,
    done: watch::Sender<bool>,
) {
    let mut stopped = stop.subscribe();
    let status = tokio::select! {
        biased;
        _ = wait_for_stop(&mut stopped) => {
            #[cfg(unix)]
            if let Some(pid) = child.id().filter(|pid| *pid > 0 && *pid <= i32::MAX as u32) {
                // start_session created an isolated process group. Signal it
                // before reaping the child, so the PID cannot have been reused.
                // This also stops wrappers' descendants that retained pipes.
                unsafe { libc::kill(-(pid as libc::pid_t), libc::SIGKILL) };
            }
            if let Err(error) = child.start_kill() {
                stop_with_error(&runtime, &stop, format!("Could not stop MCP server: {error}"));
            }
            match tokio::time::timeout(STOP_TIMEOUT, child.wait()).await {
                Ok(status) => status,
                Err(_) => {
                    stop_with_error(&runtime, &stop, "MCP server did not exit promptly after being stopped.");
                    // kill_on_drop provides a last nonblocking cleanup attempt.
                    return;
                }
            }
        },
        status = child.wait() => status,
    };
    if let Ok(mut state) = runtime.lock() {
        state.process_exited = true;
        match status {
            Ok(status) => {
                state.exit_code = status.code();
                if !status.success() && state.error.is_none() && !*stop.borrow() {
                    // Diagnostics may contain credentials: retain only a hint.
                    let diagnostic_hint = if state.stderr_tail.is_empty() {
                        ""
                    } else {
                        "; the server also wrote diagnostics"
                    };
                    state.error = Some(format!(
                        "MCP server exited with {}{diagnostic_hint}",
                        status
                            .code()
                            .map_or_else(|| "no status".to_owned(), |code| code.to_string())
                    ));
                }
            }
            Err(error) => state.error = Some(format!("Could not monitor MCP server: {error}")),
        }
    }
    done.send_replace(true);
    // Preserve final output on a normal exit, but do not leave readers alive
    // forever if a descendant inherited and retained the server's pipe ends.
    tokio::select! {
        _ = wait_for_stop(&mut stopped) => {},
        _ = tokio::time::sleep(EXIT_DRAIN_TIMEOUT) => {},
    }
    stop.send_replace(true);
}

fn start_session(mut cmd: Command, slot: OwnedSemaphorePermit) -> Result<Arc<McpSession>, String> {
    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    let mut child = cmd
        .spawn()
        .map_err(|error| format!("Could not spawn MCP server: {error}"))?;
    let stdout = child.stdout.take().ok_or("no stdout pipe")?;
    let stderr = child.stderr.take().ok_or("no stderr pipe")?;
    let stdin = child.stdin.take().ok_or("no stdin pipe")?;
    let runtime = Arc::new(Mutex::new(McpRuntime::default()));
    let recv_queue = Arc::new(Mutex::new(McpQueue::default()));
    let (stop, _) = watch::channel(false);
    let (done, process_done) = watch::channel(false);
    let (input, queued) = mpsc::channel(MAX_INPUT_MESSAGES);
    tokio::spawn(pump_stdout(
        stdout,
        recv_queue.clone(),
        runtime.clone(),
        stop.clone(),
    ));
    tokio::spawn(pump_stderr(stderr, runtime.clone(), stop.subscribe()));
    tokio::spawn(pump_input(stdin, queued, runtime.clone(), stop.clone()));
    tokio::spawn(monitor_child(child, runtime.clone(), stop.clone(), done));
    Ok(Arc::new(McpSession {
        input,
        stop,
        process_done,
        recv_queue,
        runtime,
        _slot: slot,
    }))
}

#[tauri::command]
pub async fn mcp_spawn(
    state: State<'_, McpState>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let slot = SESSION_SLOTS
        .get_or_init(|| Arc::new(Semaphore::new(32)))
        .clone()
        .try_acquire_owned()
        .map_err(|_| {
            "Too many MCP servers are active. Close one before starting another.".to_string()
        })?;
    // Reuse Husk's timeout-bounded lookup off the native IPC thread. MCP is a
    // user-configured executable, so keep wrapper/path support separate from
    // the stricter AI command policy. Arguments are never interpolated.
    let resolved = run_blocking_command(move || resolve_configured_program(&command)).await?;
    let mut cmd = Command::new(resolved);
    cmd.args(&args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(vars) = env {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    let session = start_session(cmd, slot)?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .insert(id, session);
    Ok(id)
}

#[tauri::command]
pub async fn mcp_send(state: State<'_, McpState>, id: u32, message: String) -> Result<(), String> {
    state.session(id)?.send(message, SEND_TIMEOUT).await
}

#[tauri::command]
pub fn mcp_recv(
    state: State<'_, McpState>,
    id: u32,
    limit: Option<usize>,
) -> Result<McpReceive, String> {
    let session = state.session(id)?;
    receive(&session, limit.unwrap_or(50).clamp(1, 200))
}

fn receive(session: &McpSession, limit: usize) -> Result<McpReceive, String> {
    // Observe completion before draining the queue. If the reader closes
    // between a drain and a later runtime check, a newly queued final response
    // could otherwise be stranded behind a false `running` result.
    let runtime = session.runtime.lock().map_err(|e| e.to_string())?;
    let (lines, pending) = {
        let mut queue = session.recv_queue.lock().map_err(|e| e.to_string())?;
        let lines = queue.drain(limit);
        (lines, !queue.lines.is_empty())
    };
    Ok(McpReceive {
        lines,
        /* Wait until both the process and stdout reader are finished so its
        final JSON-RPC response cannot be lost in an exit/read race. */
        // A failed stop/reap must also surface its recorded error after the
        // cancelled stdout task closes, rather than polling "running" forever.
        running: pending
            || !(runtime.stdout_closed
                && (runtime.process_exited || (runtime.error.is_some() && *session.stop.borrow()))),
        exit_code: runtime.exit_code,
        error: runtime.error.clone(),
    })
}

#[tauri::command]
pub async fn mcp_kill(state: State<'_, McpState>, id: u32) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned();
    let Some(session) = session else {
        return Ok(());
    };
    session.stop.send_replace(true);
    let mut done = session.process_done.clone();
    tokio::time::timeout(STOP_TIMEOUT + Duration::from_millis(100), async {
        while !*done.borrow_and_update() {
            done.changed()
                .await
                .map_err(|_| "MCP cleanup worker stopped before confirming exit.".to_string())?;
        }
        Ok::<_, String>(())
    })
    .await
    .map_err(|_| "MCP server cleanup timed out. Close can be retried.".to_string())??;
    state
        .sessions
        .lock()
        .map_err(|e| e.to_string())?
        .remove(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_session() -> (Arc<McpSession>, mpsc::Receiver<WriteRequest>) {
        let (input, queued) = mpsc::channel(MAX_INPUT_MESSAGES);
        let (stop, _) = watch::channel(false);
        let (_, process_done) = watch::channel(false);
        let slot = Arc::new(Semaphore::new(1)).try_acquire_owned().unwrap();
        (
            Arc::new(McpSession {
                input,
                stop,
                process_done,
                recv_queue: Arc::new(Mutex::new(McpQueue::default())),
                runtime: Arc::new(Mutex::new(McpRuntime::default())),
                _slot: slot,
            }),
            queued,
        )
    }

    #[test]
    fn stuck_input_times_out_stops_session_and_never_replays() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (session, queued) = fixture_session();
            let (writer, mut peer) = tokio::io::duplex(8);
            let task = tokio::spawn(pump_input(
                writer,
                queued,
                session.runtime.clone(),
                session.stop.clone(),
            ));
            let error = session
                .send("x".repeat(512), Duration::from_millis(30))
                .await
                .unwrap_err();
            assert!(
                error.contains("stopped") || error.contains("timed out"),
                "{error}"
            );
            tokio::time::timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap();
            let mut written = Vec::new();
            peer.read_to_end(&mut written).await.unwrap();
            assert!(written.len() <= 8);
            assert!(!written.ends_with(b"\n"));
            assert!(session
                .send("must-not-run".into(), SEND_TIMEOUT)
                .await
                .is_err());
            assert!(*session.stop.borrow());
        });
    }

    #[test]
    fn explicit_stop_cancels_blocked_writer_without_waiting_for_pipe() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (session, queued) = fixture_session();
            let (writer, _peer) = tokio::io::duplex(1);
            let task = tokio::spawn(pump_input(
                writer,
                queued,
                session.runtime.clone(),
                session.stop.clone(),
            ));
            let sending = tokio::spawn({
                let session = session.clone();
                async move {
                    session
                        .send("blocked".into(), Duration::from_secs(10))
                        .await
                }
            });
            tokio::time::sleep(Duration::from_millis(10)).await;
            session.stop.send_replace(true);
            assert!(tokio::time::timeout(Duration::from_millis(200), sending)
                .await
                .unwrap()
                .unwrap()
                .is_err());
            tokio::time::timeout(Duration::from_millis(200), task)
                .await
                .unwrap()
                .unwrap();
        });
    }

    #[test]
    fn saturated_input_queue_rejects_instead_of_accumulating_work() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (session, _queued) = fixture_session();
            for _ in 0..MAX_INPUT_MESSAGES {
                let (result, _) = oneshot::channel();
                session
                    .input
                    .try_send(WriteRequest {
                        bytes: vec![b'x'],
                        deadline: SendDeadline::after(SEND_TIMEOUT),
                        result,
                    })
                    .unwrap();
            }
            assert!(session
                .send("overflow".into(), SEND_TIMEOUT)
                .await
                .unwrap_err()
                .contains("not queued"));
            assert!(!*session.stop.borrow());
            assert!(session
                .send("x".repeat(MAX_INPUT_BYTES + 1), SEND_TIMEOUT)
                .await
                .unwrap_err()
                .contains("exceeds"));
        });
    }

    #[test]
    fn expired_wall_clock_message_is_not_written_after_wake() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (session, queued) = fixture_session();
            let (writer, mut peer) = tokio::io::duplex(1024);
            let (result, received) = oneshot::channel();
            session
                .input
                .try_send(WriteRequest {
                    bytes: b"must-not-run\n".to_vec(),
                    deadline: SendDeadline {
                        instant: Instant::now() + Duration::from_secs(30),
                        wall: SystemTime::now() - Duration::from_secs(1),
                    },
                    result,
                })
                .unwrap();
            pump_input(
                writer,
                queued,
                session.runtime.clone(),
                session.stop.clone(),
            )
            .await;
            assert!(received.await.unwrap().unwrap_err().contains("timed out"));
            let mut bytes = Vec::new();
            peer.read_to_end(&mut bytes).await.unwrap();
            assert!(bytes.is_empty());
        });
    }

    #[test]
    fn cancelled_send_is_not_started_later() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let (session, queued) = fixture_session();
            let (writer, mut peer) = tokio::io::duplex(1024);
            let (result, received) = oneshot::channel();
            session
                .input
                .try_send(WriteRequest {
                    bytes: b"must-not-run\n".to_vec(),
                    deadline: SendDeadline::after(SEND_TIMEOUT),
                    result,
                })
                .unwrap();
            drop(received);
            pump_input(
                writer,
                queued,
                session.runtime.clone(),
                session.stop.clone(),
            )
            .await;
            let mut bytes = Vec::new();
            peer.read_to_end(&mut bytes).await.unwrap();
            assert!(bytes.is_empty());
            assert!(*session.stop.borrow());
        });
    }

    #[test]
    fn stalled_server_does_not_hold_registry_or_other_server_input() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let state = McpState::default();
            let (blocked, blocked_queue) = fixture_session();
            let (healthy, healthy_queue) = fixture_session();
            let (blocked_writer, _blocked_reader) = tokio::io::duplex(1);
            let (healthy_writer, mut healthy_reader) = tokio::io::duplex(1024);
            tokio::spawn(pump_input(
                blocked_writer,
                blocked_queue,
                blocked.runtime.clone(),
                blocked.stop.clone(),
            ));
            tokio::spawn(pump_input(
                healthy_writer,
                healthy_queue,
                healthy.runtime.clone(),
                healthy.stop.clone(),
            ));
            state.sessions.lock().unwrap().insert(1, blocked.clone());
            state.sessions.lock().unwrap().insert(2, healthy.clone());
            let send =
                tokio::spawn(async move { blocked.send("blocked".into(), SEND_TIMEOUT).await });
            tokio::time::sleep(Duration::from_millis(10)).await;
            tokio::time::timeout(
                Duration::from_millis(200),
                state
                    .session(2)
                    .unwrap()
                    .send("healthy".into(), SEND_TIMEOUT),
            )
            .await
            .unwrap()
            .unwrap();
            let mut bytes = [0_u8; 8];
            healthy_reader.read_exact(&mut bytes).await.unwrap();
            assert_eq!(&bytes, b"healthy\n");
            state.session(1).unwrap().stop.send_replace(true);
            assert!(send.await.unwrap().is_err());
        });
    }

    #[test]
    fn final_output_remains_running_until_all_queued_responses_are_drained() {
        let (session, _queued) = fixture_session();
        {
            let mut runtime = session.runtime.lock().unwrap();
            runtime.process_exited = true;
            runtime.stdout_closed = true;
        }
        session
            .recv_queue
            .lock()
            .unwrap()
            .push("first".into())
            .unwrap();
        session
            .recv_queue
            .lock()
            .unwrap()
            .push("last".into())
            .unwrap();
        let first = receive(&session, 1).unwrap();
        assert!(first.running);
        assert_eq!(first.lines, vec!["first"]);
        let last = receive(&session, 1).unwrap();
        assert!(!last.running);
        assert_eq!(last.lines, vec!["last"]);
    }

    #[test]
    fn concurrent_reader_close_never_strands_a_final_response() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            for _ in 0..100 {
                let (session, _queued) = fixture_session();
                session.runtime.lock().unwrap().process_exited = true;
                let (mut writer, reader) = tokio::io::duplex(1024);
                let pump = tokio::spawn(pump_stdout(
                    reader,
                    session.recv_queue.clone(),
                    session.runtime.clone(),
                    session.stop.clone(),
                ));
                writer.write_all(b"first\nlast\n").await.unwrap();
                drop(writer);
                let lines = tokio::time::timeout(Duration::from_secs(1), async {
                    let mut lines = Vec::new();
                    loop {
                        let received = receive(&session, 1).unwrap();
                        lines.extend(received.lines);
                        if !received.running {
                            break lines;
                        }
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
                pump.await.unwrap();
                assert_eq!(lines, vec!["first", "last"]);
            }
        });
    }

    #[test]
    fn failed_cleanup_surfaces_an_error_instead_of_polling_running_forever() {
        let (session, _queued) = fixture_session();
        {
            let mut runtime = session.runtime.lock().unwrap();
            runtime.stdout_closed = true;
            runtime.error = Some("MCP server did not exit promptly after being stopped.".into());
        }
        session.stop.send_replace(true);
        let received = receive(&session, 50).unwrap();
        assert!(!received.running);
        assert!(received.error.unwrap().contains("did not exit promptly"));
        assert_eq!(received.exit_code, None);
    }

    #[test]
    fn mcp_process_fixture() {
        if std::env::var_os("HUSK_MCP_TEST_NO_READ").is_some() {
            std::thread::sleep(Duration::from_secs(30));
        }
    }

    #[test]
    fn real_stalled_fixture_process_is_stopped_when_input_times_out() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut cmd = Command::new(std::env::current_exe().unwrap());
            cmd.args(["--exact", "mcp::tests::mcp_process_fixture", "--nocapture"])
                .env("HUSK_MCP_TEST_NO_READ", "1");
            let slot = Arc::new(Semaphore::new(1)).try_acquire_owned().unwrap();
            let session = start_session(cmd, slot).unwrap();
            assert!(session
                .send("x".repeat(MAX_INPUT_BYTES), Duration::from_millis(100))
                .await
                .is_err());
            let mut done = session.process_done.clone();
            tokio::time::timeout(Duration::from_secs(2), async {
                while !*done.borrow_and_update() {
                    done.changed().await.unwrap();
                }
            })
            .await
            .unwrap();
            assert!(session.runtime.lock().unwrap().process_exited);
        });
    }

    #[test]
    fn queue_drain_releases_its_byte_budget() {
        let mut queue = McpQueue::default();
        queue.push("first".to_owned()).unwrap();
        queue.push("second".to_owned()).unwrap();
        assert_eq!(queue.bytes, 11);
        assert_eq!(queue.drain(1), vec!["first"]);
        assert_eq!(queue.bytes, 6);
        assert_eq!(queue.drain(20), vec!["second"]);
        assert_eq!(queue.bytes, 0);
    }

    #[test]
    fn queue_rejects_excess_messages_without_dropping_old_responses() {
        let mut queue = McpQueue::default();
        for index in 0..MAX_QUEUED_LINES {
            queue.push(index.to_string()).unwrap();
        }
        assert!(queue.push("overflow".to_owned()).is_err());
        assert_eq!(queue.lines.len(), MAX_QUEUED_LINES);
        assert_eq!(queue.lines.front().map(String::as_str), Some("0"));
    }

    #[test]
    fn queue_rejects_oversized_single_message() {
        let mut queue = McpQueue::default();
        assert!(queue.push("x".repeat(MAX_LINE_BYTES + 1)).is_err());
        assert!(queue.lines.is_empty());
    }
}
