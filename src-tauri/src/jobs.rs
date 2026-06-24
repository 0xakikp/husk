//! Background jobs: long-running commands (dev servers, `logs -f`, builds)
//! spawned detached from the interactive PTY, with their combined stdout/stderr
//! captured in a bounded ring buffer the UI can tail incrementally.

use std::collections::HashMap;
use std::collections::VecDeque;
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread;
use std::time::SystemTime;

use serde::Serialize;
use shared_child::SharedChild;

const RING_CAP: usize = 4 * 1024 * 1024;

/// Reject commands that contain shell metacharacters used for injection.
/// Defense-in-depth; the real protection is Command::arg().
fn validate_command(command: &str) -> Result<&str, String> {
    if command.contains('`') || command.contains("$(") {
        return Err("Command substitution not allowed in background jobs".to_string());
    }
    Ok(command)
}

/// Byte ring buffer with monotonic offsets, so callers can tail it: each push
/// advances `next_offset` even when old bytes are dropped to stay under `cap`.
struct BoundedRingBuffer {
    buf: VecDeque<u8>,
    cap: usize,
    next_offset: u64,
    dropped: u64,
}

impl BoundedRingBuffer {
    fn new(cap: usize) -> Self {
        Self {
            buf: VecDeque::with_capacity(cap.min(64 * 1024)),
            cap,
            next_offset: 0,
            dropped: 0,
        }
    }

    fn push(&mut self, data: &[u8]) {
        self.next_offset = self.next_offset.saturating_add(data.len() as u64);
        if data.len() >= self.cap {
            let keep_from = data.len() - self.cap;
            self.dropped = self.dropped.saturating_add((self.buf.len() + keep_from) as u64);
            self.buf.clear();
            self.buf.extend(&data[keep_from..]);
            return;
        }
        let overflow = (self.buf.len() + data.len()).saturating_sub(self.cap);
        if overflow > 0 {
            for _ in 0..overflow {
                self.buf.pop_front();
            }
            self.dropped = self.dropped.saturating_add(overflow as u64);
        }
        self.buf.extend(data);
    }

    fn read_from(&self, since: u64) -> (Vec<u8>, u64, u64) {
        let oldest = self.next_offset.saturating_sub(self.buf.len() as u64);
        let start = since.max(oldest);
        let skip = (start - oldest) as usize;
        let bytes: Vec<u8> = self.buf.iter().copied().skip(skip).collect();
        (bytes, self.next_offset, self.dropped)
    }
}

pub struct BackgroundProc {
    command: String,
    cwd: Option<String>,
    started_at_ms: u64,
    child: Arc<SharedChild>,
    buffer: Mutex<BoundedRingBuffer>,
    exited: AtomicBool,
    exit_code: AtomicI32,
    exit_unknown: AtomicBool,
}

#[derive(Serialize)]
pub struct BackgroundLogResponse {
    bytes: String,
    next_offset: u64,
    dropped: u64,
    exited: bool,
    exit_code: Option<i32>,
}

#[derive(Serialize)]
pub struct BackgroundProcInfo {
    handle: u32,
    command: String,
    cwd: Option<String>,
    started_at_ms: u64,
    exited: bool,
    exit_code: Option<i32>,
}

impl BackgroundProc {
    fn read_logs(&self, since: u64) -> BackgroundLogResponse {
        let (bytes, next_offset, dropped) = self
            .buffer
            .lock()
            .map_or_else(|_| (Vec::new(), since, 0), |g| g.read_from(since));
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundLogResponse {
            bytes: String::from_utf8_lossy(&bytes).into_owned(),
            next_offset,
            dropped,
            exited,
            exit_code,
        }
    }

    fn kill(&self) {
        let _ = self.child.kill();
    }

    fn info(&self, handle: u32) -> BackgroundProcInfo {
        let exited = self.exited.load(Ordering::Acquire);
        let exit_code = if exited && !self.exit_unknown.load(Ordering::Acquire) {
            Some(self.exit_code.load(Ordering::Acquire))
        } else {
            None
        };
        BackgroundProcInfo {
            handle,
            command: self.command.clone(),
            cwd: self.cwd.clone(),
            started_at_ms: self.started_at_ms,
            exited,
            exit_code,
        }
    }
}

impl Drop for BackgroundProc {
    fn drop(&mut self) {
        self.kill();
    }
}

fn build_command(command: &str) -> Command {
    #[cfg(windows)]
    {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(command);
        c
    }
    #[cfg(not(windows))]
    {
        // Login shell so PATH includes brew/user bins.
        let mut c = Command::new("sh");
        c.arg("-lc").arg(command);
        c
    }
}

fn spawn(command: String, cwd: Option<String>) -> Result<Arc<BackgroundProc>, String> {
    let trimmed = command.trim().to_string();
    validate_command(&trimmed)?;
    if trimmed.is_empty() {
        return Err("empty command".into());
    }
    if let Some(ref dir) = cwd {
        if !std::path::Path::new(dir).is_dir() {
            return Err(format!("cwd is not a directory: {dir}"));
        }
    }

    let mut cmd = build_command(&trimmed);
    if let Some(ref dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());

    let shared = SharedChild::spawn(&mut cmd).map_err(|e| e.to_string())?;
    let stdout_pipe = shared.take_stdout().ok_or("no stdout pipe")?;
    let stderr_pipe = shared.take_stderr().ok_or("no stderr pipe")?;
    let child = Arc::new(shared);

    let started_at_ms = SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let proc = Arc::new(BackgroundProc {
        command: trimmed,
        cwd,
        started_at_ms,
        child,
        buffer: Mutex::new(BoundedRingBuffer::new(RING_CAP)),
        exited: AtomicBool::new(false),
        exit_code: AtomicI32::new(0),
        exit_unknown: AtomicBool::new(false),
    });

    // Pump stdout + stderr into the ring buffer.
    for pipe in [
        Box::new(stdout_pipe) as Box<dyn Read + Send>,
        Box::new(stderr_pipe) as Box<dyn Read + Send>,
    ] {
        let proc_ref = proc.clone();
        let mut pipe = pipe;
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match pipe.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut g) = proc_ref.buffer.lock() {
                            g.push(&buf[..n]);
                        } else {
                            break;
                        }
                    }
                }
            }
        });
    }

    // Reap and record exit status.
    {
        let proc_ref = proc.clone();
        let child_for_wait = proc.child.clone();
        thread::spawn(move || {
            match child_for_wait.wait() {
                Ok(status) => match status.code() {
                    Some(code) => proc_ref.exit_code.store(code, Ordering::Release),
                    None => proc_ref.exit_unknown.store(true, Ordering::Release),
                },
                Err(_) => proc_ref.exit_unknown.store(true, Ordering::Release),
            }
            proc_ref.exited.store(true, Ordering::Release);
        });
    }

    Ok(proc)
}

#[derive(Default)]
pub struct JobsState {
    procs: RwLock<HashMap<u32, Arc<BackgroundProc>>>,
    next_id: AtomicU32,
}

#[tauri::command]
pub fn shell_bg_spawn(
    state: tauri::State<JobsState>,
    command: String,
    cwd: Option<String>,
) -> Result<u32, String> {
    let proc = spawn(command, cwd)?;
    let id = state.next_id.fetch_add(1, Ordering::Relaxed) + 1;
    state.procs.write().map_err(|e| e.to_string())?.insert(id, proc);
    Ok(id)
}

#[tauri::command]
pub fn shell_bg_logs(
    state: tauri::State<JobsState>,
    handle: u32,
    since_offset: Option<u64>,
) -> Result<BackgroundLogResponse, String> {
    let proc = state
        .procs
        .read()
        .map_err(|e| e.to_string())?
        .get(&handle)
        .cloned()
        .ok_or_else(|| "no background handle".to_string())?;
    Ok(proc.read_logs(since_offset.unwrap_or(0)))
}

#[tauri::command]
pub fn shell_bg_kill(state: tauri::State<JobsState>, handle: u32) -> Result<(), String> {
    if let Some(proc) = state.procs.read().map_err(|e| e.to_string())?.get(&handle).cloned() {
        proc.kill();
    }
    Ok(())
}

/// Remove a handle entirely (kills it via Drop if still running).
#[tauri::command]
pub fn shell_bg_remove(state: tauri::State<JobsState>, handle: u32) -> Result<(), String> {
    state.procs.write().map_err(|e| e.to_string())?.remove(&handle);
    Ok(())
}

#[tauri::command]
pub fn shell_bg_list(state: tauri::State<JobsState>) -> Result<Vec<BackgroundProcInfo>, String> {
    let map = state.procs.read().map_err(|e| e.to_string())?;
    let mut out: Vec<BackgroundProcInfo> = map.iter().map(|(id, p)| p.info(*id)).collect();
    out.sort_by_key(|i| i.handle);
    Ok(out)
}
