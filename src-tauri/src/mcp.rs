//! MCP server process bridge.
//!
//! Spawns a validated MCP server with piped stdio and shuttles JSON-RPC lines
//! to the frontend. Output is deliberately bounded: a broken or hostile server
//! cannot grow Husk's memory without limit while the webview is busy.

use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use serde::Serialize;
use shared_child::SharedChild;
use tauri::State;

use crate::shell::validate_program;

const MAX_QUEUED_LINES: usize = 512;
const MAX_QUEUED_BYTES: usize = 4 * 1024 * 1024;
const MAX_LINE_BYTES: usize = 1024 * 1024;
const MAX_STDERR_BYTES: usize = 16 * 1024;

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
        if self.lines.len() >= MAX_QUEUED_LINES || self.bytes.saturating_add(bytes) > MAX_QUEUED_BYTES {
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
    child: Arc<SharedChild>,
    stdin: Arc<Mutex<std::process::ChildStdin>>,
    recv_queue: Arc<Mutex<McpQueue>>,
    runtime: Arc<Mutex<McpRuntime>>,
}

#[derive(Default)]
pub struct McpState {
    sessions: Mutex<HashMap<u32, McpSession>>,
}

#[derive(Serialize)]
pub struct McpReceive {
    lines: Vec<String>,
    running: bool,
    exit_code: Option<i32>,
    error: Option<String>,
}

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

fn resolve_command(command: &str) -> Result<String, String> {
    if Path::new(command).is_absolute() {
        return Ok(command.to_string());
    }
    let script = format!("command -v {}", shell_quote(command));
    let output = Command::new("sh")
        .arg("-lc")
        .arg(&script)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("command not found: {command}"));
    }
    let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if resolved.is_empty() {
        return Err(format!("command not found: {command}"));
    }
    Ok(resolved)
}

fn stop_with_error(runtime: &Arc<Mutex<McpRuntime>>, child: &Arc<SharedChild>, message: impl Into<String>) {
    if let Ok(mut state) = runtime.lock() {
        if state.error.is_none() {
            state.error = Some(message.into());
        }
    }
    let _ = child.kill();
}

fn enqueue_line(
    raw: &[u8],
    queue: &Arc<Mutex<McpQueue>>,
    runtime: &Arc<Mutex<McpRuntime>>,
    child: &Arc<SharedChild>,
) -> bool {
    let line = match String::from_utf8(raw.to_vec()) {
        Ok(line) => line.trim_end_matches('\r').to_owned(),
        Err(_) => {
            stop_with_error(runtime, child, "MCP server sent non-UTF-8 output");
            return false;
        }
    };
    if line.trim().is_empty() {
        return true;
    }
    let result = queue.lock().map_err(|_| "MCP output queue is unavailable").and_then(|mut q| q.push(line));
    if let Err(message) = result {
        stop_with_error(runtime, child, message);
        return false;
    }
    true
}

/// Fixed-size reads prevent one unterminated JSON line from allocating without
/// limit before the normal queue limits can be applied.
fn pump_stdout(
    mut stdout: impl Read,
    queue: Arc<Mutex<McpQueue>>,
    runtime: Arc<Mutex<McpRuntime>>,
    child: Arc<SharedChild>,
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
    let mut chunk = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        let read = match stdout.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => read,
            Err(error) => {
                stop_with_error(&runtime, &child, format!("Could not read MCP output: {error}"));
                return;
            }
        };
        for &byte in &chunk[..read] {
            if byte == b'\n' {
                if !enqueue_line(&pending, &queue, &runtime, &child) {
                    return;
                }
                pending.clear();
            } else {
                pending.push(byte);
                if pending.len() > MAX_LINE_BYTES {
                    stop_with_error(&runtime, &child, "MCP server sent a message larger than 1 MB");
                    return;
                }
            }
        }
    }
    if !pending.is_empty() {
        let _ = enqueue_line(&pending, &queue, &runtime, &child);
    }
}

fn pump_stderr(mut stderr: impl Read, runtime: Arc<Mutex<McpRuntime>>) {
    let mut chunk = [0_u8; 4096];
    loop {
        let read = match stderr.read(&mut chunk) {
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

#[tauri::command]
pub fn mcp_spawn(
    state: State<'_, McpState>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
    cwd: Option<String>,
) -> Result<u32, String> {
    let resolved = resolve_command(&command)?;
    validate_program(&resolved)?;

    let mut cmd = Command::new(&resolved);
    cmd.args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    if let Some(vars) = env {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    let child = SharedChild::spawn(&mut cmd)
        .map_err(|e| format!("failed to spawn '{command}': {e}"))?;
    let stdout = child.take_stdout().ok_or("no stdout pipe")?;
    let stderr = child.take_stderr().ok_or("no stderr pipe")?;
    let stdin = child.take_stdin().ok_or("no stdin pipe")?;
    let child = Arc::new(child);
    let recv_queue = Arc::new(Mutex::new(McpQueue::default()));
    let runtime = Arc::new(Mutex::new(McpRuntime::default()));

    {
        let queue = Arc::clone(&recv_queue);
        let runtime = Arc::clone(&runtime);
        let child = Arc::clone(&child);
        thread::spawn(move || pump_stdout(stdout, queue, runtime, child));
    }
    {
        let runtime = Arc::clone(&runtime);
        thread::spawn(move || pump_stderr(stderr, runtime));
    }
    {
        let runtime = Arc::clone(&runtime);
        let waiter = Arc::clone(&child);
        thread::spawn(move || {
            let status = waiter.wait();
            if let Ok(mut state) = runtime.lock() {
                state.process_exited = true;
                match status {
                    Ok(status) => {
                        state.exit_code = status.code();
                        if !status.success() && state.error.is_none() {
                            /* stderr can contain credentials echoed by a broken
                               integration. Monitor and bound it, but do not send
                               its raw contents into the webview or AI context. */
                            let diagnostic_hint = if state.stderr_tail.is_empty() {
                                ""
                            } else {
                                "; the server also wrote diagnostics"
                            };
                            state.error = Some(format!(
                                "MCP server exited with {}{diagnostic_hint}",
                                status.code().map_or_else(|| "no status".to_owned(), |code| code.to_string())
                            ));
                        }
                    }
                    Err(error) => state.error = Some(format!("Could not monitor MCP server: {error}")),
                }
            }
        });
    }

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    state.sessions.lock().map_err(|e| e.to_string())?.insert(
        id,
        McpSession {
            child,
            stdin: Arc::new(Mutex::new(stdin)),
            recv_queue,
            runtime,
        },
    );
    Ok(id)
}

#[tauri::command]
pub fn mcp_send(state: State<'_, McpState>, id: u32, message: String) -> Result<(), String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("mcp session not found")?;
    let runtime = session.runtime.lock().map_err(|e| e.to_string())?;
    if runtime.process_exited || runtime.stdout_closed || runtime.error.is_some() {
        return Err("MCP server is no longer running".to_owned());
    }
    drop(runtime);
    let mut stdin = session.stdin.lock().map_err(|e| e.to_string())?;
    writeln!(stdin, "{message}").map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn mcp_recv(
    state: State<'_, McpState>,
    id: u32,
    limit: Option<usize>,
) -> Result<McpReceive, String> {
    let sessions = state.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions.get(&id).ok_or("mcp session not found")?;
    let lines = session
        .recv_queue
        .lock()
        .map_err(|e| e.to_string())?
        .drain(limit.unwrap_or(50).clamp(1, 200));
    let runtime = session.runtime.lock().map_err(|e| e.to_string())?;
    Ok(McpReceive {
        lines,
        /* Wait until both the process and stdout reader are finished so its
           final JSON-RPC response cannot be lost in an exit/read race. */
        running: !(runtime.process_exited && runtime.stdout_closed),
        exit_code: runtime.exit_code,
        error: runtime.error.clone(),
    })
}

#[tauri::command]
pub fn mcp_kill(state: State<'_, McpState>, id: u32) -> Result<(), String> {
    if let Some(session) = state.sessions.lock().map_err(|e| e.to_string())?.remove(&id) {
        let _ = session.child.kill();
        let _ = session.child.wait();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

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
