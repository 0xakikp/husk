//! PTY lifecycle, bounded input and one output reader per terminal.
//! Registry locks protect lookups only: a stalled tab cannot lock every tab.

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize};
use serde::Serialize;
use std::collections::{HashMap, VecDeque};
use std::io::{self, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime};
use tauri::{AppHandle, Emitter, State};

const INPUT_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_INPUT_BYTES: usize = 256 * 1024;
const INPUT_QUEUE_SIZE: usize = 32;
const MAX_PENDING_OUTPUT: usize = 1024 * 1024;
const MAX_CAPTURE_BYTES: usize = 4 * 1024 * 1024;
const IO_POLL: Duration = Duration::from_millis(100);

/// Some monotonic clocks exclude laptop suspend. Either clock expiring cancels
/// queued input, so an overnight wake cannot replay yesterday's keystrokes.
#[derive(Clone, Copy)]
struct Deadline {
    instant: Instant,
    wall: SystemTime,
}
impl Deadline {
    fn after(duration: Duration) -> Self {
        Self {
            instant: Instant::now() + duration,
            wall: SystemTime::now() + duration,
        }
    }
    fn remaining(&self) -> Duration {
        self.instant.saturating_duration_since(Instant::now()).min(
            self.wall
                .duration_since(SystemTime::now())
                .unwrap_or_default(),
        )
    }
    fn limited_to(&self, duration: Duration) -> Self {
        Self::after(self.remaining().min(duration))
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum SessionPhase {
    Running,
    Exited,
    Disconnected,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PtyStatus {
    state: SessionPhase,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
}
impl PtyStatus {
    fn running() -> Self {
        Self {
            state: SessionPhase::Running,
            message: None,
        }
    }
    fn disconnected(message: impl Into<String>) -> Self {
        Self {
            state: SessionPhase::Disconnected,
            message: Some(message.into()),
        }
    }
}
enum PtyEvent {
    Data(Vec<u8>),
    Status(PtyStatus),
}
type EventSink = Arc<dyn Fn(PtyEvent) -> Result<(), String> + Send + Sync>;

#[derive(Default)]
struct OutputState {
    attached: bool,
    pending: VecDeque<Vec<u8>>,
    bytes: usize,
}
struct WriteRequest {
    data: Vec<u8>,
    deadline: Deadline,
    result: mpsc::SyncSender<Result<(), String>>,
}
struct CaptureProgress {
    bytes: Vec<u8>,
    complete: bool,
    error: Option<String>,
}
struct Capture {
    marker: Vec<u8>,
    progress: Mutex<CaptureProgress>,
    changed: Condvar,
}
impl Capture {
    fn new(marker: Vec<u8>) -> Self {
        Self {
            marker,
            progress: Mutex::new(CaptureProgress {
                bytes: Vec::new(),
                complete: false,
                error: None,
            }),
            changed: Condvar::new(),
        }
    }
    fn feed(&self, bytes: &[u8]) {
        let mut progress = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        if progress.complete || progress.error.is_some() {
            return;
        }
        if progress.bytes.len().saturating_add(bytes.len()) > MAX_CAPTURE_BYTES {
            progress.error = Some(
                "Terminal capture exceeded 4 MiB. Use SFTP for larger files; nothing was retried."
                    .into(),
            );
        } else {
            let start = progress
                .bytes
                .len()
                .saturating_sub(self.marker.len().saturating_sub(1));
            progress.bytes.extend_from_slice(bytes);
            if let Some(offset) = progress.bytes[start..]
                .windows(self.marker.len())
                .position(|part| part == self.marker)
            {
                progress.bytes.truncate(start + offset);
                progress.complete = true;
            }
        }
        self.changed.notify_all();
    }
    fn fail(&self, message: &str) {
        let mut progress = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        if !progress.complete && progress.error.is_none() {
            progress.error = Some(message.into());
        }
        self.changed.notify_all();
    }
    fn wait(&self, deadline: Deadline) -> Result<String, String> {
        let mut progress = self.progress.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            if let Some(error) = &progress.error {
                return Err(error.clone());
            }
            if progress.complete {
                return Ok(strip_kubeconfig_metadata(&String::from_utf8_lossy(
                    &progress.bytes,
                )));
            }
            let remaining = deadline.remaining();
            if remaining.is_zero() {
                return Err("Terminal capture timed out. The command may still be running; nothing was retried.".into());
            }
            progress = self
                .changed
                .wait_timeout(progress, remaining.min(IO_POLL))
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }
}

struct PtySession {
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    writes: mpsc::SyncSender<WriteRequest>,
    status: Mutex<PtyStatus>,
    closed: AtomicBool,
    output: Mutex<OutputState>,
    attached: Condvar,
    capture: Mutex<Option<Arc<Capture>>>,
    emit: EventSink,
}
impl PtySession {
    fn status(&self) -> PtyStatus {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    fn set_status(&self, status: PtyStatus) {
        {
            let mut current = self.status.lock().unwrap_or_else(|e| e.into_inner());
            // A reader EOF racing child.wait must not replace a confirmed exit.
            if current.state == SessionPhase::Exited || *current == status {
                return;
            }
            *current = status.clone();
        }
        if let Some(capture) = self
            .capture
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            capture.fail(
                status
                    .message
                    .as_deref()
                    .unwrap_or("The terminal is no longer connected."),
            );
        }
        let output = self.output.lock().unwrap_or_else(|e| e.into_inner());
        if output.attached {
            let _ = (self.emit)(PtyEvent::Status(status));
        }
    }
    fn publish(&self, bytes: &[u8]) -> bool {
        if let Some(capture) = self
            .capture
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            capture.feed(bytes);
        }
        let mut output = self.output.lock().unwrap_or_else(|e| e.into_inner());
        // Pause just this reader until attach rather than drop prompt bytes.
        while !output.attached
            && output.bytes + bytes.len() > MAX_PENDING_OUTPUT
            && !self.closed.load(Ordering::Acquire)
        {
            output = self
                .attached
                .wait_timeout(output, IO_POLL)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        if self.closed.load(Ordering::Acquire) {
            return false;
        }
        if output.attached {
            if let Err(error) = (self.emit)(PtyEvent::Data(bytes.to_vec())) {
                drop(output);
                self.set_status(PtyStatus::disconnected(format!(
                    "Terminal output delivery failed: {error}"
                )));
                return false;
            }
        } else {
            output.bytes += bytes.len();
            output.pending.push_back(bytes.to_vec());
        }
        true
    }
    fn attach(&self) -> Result<PtyStatus, String> {
        let mut output = self.output.lock().unwrap_or_else(|e| e.into_inner());
        if !output.attached {
            // Serialize initial drain with new bytes, but never registry locks.
            while let Some(bytes) = output.pending.pop_front() {
                output.bytes -= bytes.len();
                (self.emit)(PtyEvent::Data(bytes))?;
            }
            output.attached = true;
            self.attached.notify_all();
        }
        Ok(self.status())
    }
    fn ensure_running(&self) -> Result<(), String> {
        let status = self.status();
        if self.closed.load(Ordering::Acquire) || status.state != SessionPhase::Running {
            return Err(status
                .message
                .unwrap_or_else(|| "The terminal is no longer connected.".into()));
        }
        Ok(())
    }
    fn enqueue(
        &self,
        data: Vec<u8>,
        deadline: Deadline,
    ) -> Result<mpsc::Receiver<Result<(), String>>, String> {
        self.ensure_running()?;
        if data.len() > MAX_INPUT_BYTES {
            return Err("Terminal input exceeds 256 KiB. Split the paste into smaller parts; nothing was sent.".into());
        }
        let (result, received) = mpsc::sync_channel(1);
        self.writes
            .try_send(WriteRequest {
                data,
                deadline,
                result,
            })
            .map_err(|error| match error {
                mpsc::TrySendError::Full(_) => {
                    "Terminal input is busy. This input was not sent or queued for later."
                        .to_string()
                }
                mpsc::TrySendError::Disconnected(_) => {
                    "Terminal input is unavailable. This input was not sent.".to_string()
                }
            })?;
        Ok(received)
    }
    fn close(&self) -> Result<(), String> {
        let exited = self.status().state == SessionPhase::Exited;
        self.closed.store(true, Ordering::Release);
        self.attached.notify_all();
        self.set_status(PtyStatus::disconnected("Terminal closed."));
        // Only explicit close/restart reaches this path, never status or wake.
        if !exited {
            self.killer
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .kill()
                .map_err(|error| format!("Could not stop the previous shell: {error}"))?;
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct PtyState {
    sessions: Arc<Mutex<HashMap<u32, Arc<PtySession>>>>,
}
impl PtyState {
    fn session(&self, id: u32) -> Result<Arc<PtySession>, String> {
        self.sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .get(&id)
            .cloned()
            .ok_or_else(|| "PTY session not found. Open a new terminal.".into())
    }
}
static NEXT_ID: AtomicU32 = AtomicU32::new(1);
static NEXT_CAPTURE: AtomicU64 = AtomicU64::new(1);

/// Unix fd clones share O_NONBLOCK. Both reader and writer handle WouldBlock.
/// The poll-only fd is separately owned to prevent fd-reuse races on close.
struct PtyIo {
    #[cfg(unix)]
    fd: std::os::fd::OwnedFd,
}
impl PtyIo {
    fn new(master: &dyn MasterPty) -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::fd::FromRawFd;
            let raw = master.as_raw_fd().ok_or("PTY descriptor is unavailable")?;
            // SAFETY: master owns a live fd; dup returns a separately owned fd.
            let duplicated = unsafe { libc::dup(raw) };
            if duplicated == -1 {
                return Err(io::Error::last_os_error().to_string());
            }
            let fd = unsafe { std::os::fd::OwnedFd::from_raw_fd(duplicated) };
            let flags = unsafe { libc::fcntl(duplicated, libc::F_GETFL) };
            if flags == -1
                || unsafe { libc::fcntl(duplicated, libc::F_SETFL, flags | libc::O_NONBLOCK) } == -1
            {
                return Err(io::Error::last_os_error().to_string());
            }
            if unsafe { libc::fcntl(duplicated, libc::F_SETFD, libc::FD_CLOEXEC) } == -1 {
                return Err(io::Error::last_os_error().to_string());
            }
            Ok(Self { fd })
        }
        #[cfg(not(unix))]
        {
            let _ = master;
            Ok(Self {})
        }
    }
    fn wait(&self, writable: bool, duration: Duration) -> io::Result<()> {
        #[cfg(unix)]
        {
            use std::os::fd::AsRawFd;
            let mut descriptor = libc::pollfd {
                fd: self.fd.as_raw_fd(),
                events: if writable {
                    libc::POLLOUT
                } else {
                    libc::POLLIN
                },
                revents: 0,
            };
            let result = unsafe {
                libc::poll(
                    &mut descriptor,
                    1,
                    (duration.as_millis().min(i32::MAX as u128) as i32).max(1),
                )
            };
            if result < 0 {
                return Err(io::Error::last_os_error());
            }
            if descriptor.revents & libc::POLLNVAL != 0 {
                return Err(io::Error::new(
                    io::ErrorKind::BrokenPipe,
                    "PTY descriptor closed",
                ));
            }
            Ok(())
        }
        #[cfg(not(unix))]
        {
            let _ = writable;
            thread::sleep(duration.min(IO_POLL));
            Ok(())
        }
    }
}

fn input_timeout() -> String {
    "Terminal input timed out. Some input may have been sent; remaining input was discarded and will not be replayed. Check the prompt before typing again.".into()
}
fn write_bounded(
    writer: &mut dyn Write,
    data: &[u8],
    deadline: Deadline,
    closed: &AtomicBool,
    mut wait: impl FnMut(Duration) -> io::Result<()>,
) -> Result<(), String> {
    let mut written = 0;
    loop {
        if closed.load(Ordering::Acquire) {
            return Err("Terminal closed. Remaining input was discarded.".into());
        }
        let remaining = deadline.remaining();
        if remaining.is_zero() {
            return Err(input_timeout());
        }
        let result = if written < data.len() {
            writer
                .write(&data[written..data.len().min(written + 4096)])
                .and_then(|count| {
                    if count == 0 {
                        return Err(io::Error::new(
                            io::ErrorKind::WriteZero,
                            "PTY accepted no input",
                        ));
                    }
                    written += count;
                    Ok(false)
                })
        } else {
            writer.flush().map(|_| true)
        };
        match result {
            Ok(true) => return Ok(()),
            Ok(false) => {}
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if let Err(error) = wait(remaining.min(IO_POLL)) {
                    if error.kind() != io::ErrorKind::Interrupted {
                        return Err(format!(
                            "Terminal input failed: {error}. Remaining input was discarded."
                        ));
                    }
                }
            }
            Err(error) => {
                return Err(format!(
                    "Terminal input failed: {error}. Remaining input was discarded."
                ))
            }
        }
    }
}
fn await_write(
    received: mpsc::Receiver<Result<(), String>>,
    deadline: Deadline,
) -> Result<(), String> {
    loop {
        let remaining = deadline.remaining();
        if remaining.is_zero() {
            return Err(input_timeout());
        }
        match received.recv_timeout(remaining.min(IO_POLL)) {
            Ok(result) => return result,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("Terminal input worker disconnected. Input was not retried.".into())
            }
        }
    }
}
fn read_stream(reader: &mut dyn Read, session: &PtySession, io: &PtyIo) {
    let mut buffer = [0u8; 8192];
    while !session.closed.load(Ordering::Acquire) {
        match reader.read(&mut buffer) {
            Ok(0) => {
                session.set_status(PtyStatus::disconnected(
                    "Terminal output ended; checking whether the shell exited.",
                ));
                return;
            }
            Ok(count) => {
                if !session.publish(&buffer[..count]) {
                    return;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => {
                if let Err(error) = io.wait(false, IO_POLL) {
                    if error.kind() != io::ErrorKind::Interrupted {
                        session.set_status(PtyStatus::disconnected(format!(
                            "Terminal output failed: {error}"
                        )));
                        return;
                    }
                }
            }
            Err(error) => {
                session.set_status(PtyStatus::disconnected(format!(
                    "Terminal output failed: {error}"
                )));
                return;
            }
        }
    }
}

fn spawn_session(
    command: CommandBuilder,
    cols: u16,
    rows: u16,
    emit: EventSink,
) -> Result<Arc<PtySession>, String> {
    let PtyPair { master, slave } = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(1),
            cols: cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;
    let io = Arc::new(PtyIo::new(master.as_ref())?);
    let mut reader = master.try_clone_reader().map_err(|e| e.to_string())?;
    let mut writer = master.take_writer().map_err(|e| e.to_string())?;
    let mut child = slave.spawn_command(command).map_err(|e| e.to_string())?;
    drop(slave);
    let (writes, queued) = mpsc::sync_channel::<WriteRequest>(INPUT_QUEUE_SIZE);
    let session = Arc::new(PtySession {
        master: Mutex::new(master),
        killer: Mutex::new(child.clone_killer()),
        writes,
        status: Mutex::new(PtyStatus::running()),
        closed: AtomicBool::new(false),
        output: Mutex::new(OutputState::default()),
        attached: Condvar::new(),
        capture: Mutex::new(None),
        emit,
    });
    let input_session = Arc::downgrade(&session);
    let input_io = io.clone();
    thread::spawn(move || loop {
        let Some(session) = input_session.upgrade() else {
            break;
        };
        if session.closed.load(Ordering::Acquire) {
            break;
        }
        drop(session);
        let request = match queued.recv_timeout(IO_POLL) {
            Ok(request) => request,
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        };
        let Some(session) = input_session.upgrade() else {
            break;
        };
        let result = session.ensure_running().and_then(|_| {
            write_bounded(
                writer.as_mut(),
                &request.data,
                request.deadline,
                &session.closed,
                |duration| input_io.wait(true, duration),
            )
        });
        let _ = request.result.send(result);
    });
    let reader_session = session.clone();
    thread::spawn(move || {
        read_stream(reader.as_mut(), &reader_session, &io);
    });
    let child_session = session.clone();
    thread::spawn(move || {
        let status = match child.wait() {
            Ok(exit) => PtyStatus {
                state: SessionPhase::Exited,
                message: Some(format!("Shell exited (code {}).", exit.exit_code())),
            },
            Err(error) => {
                PtyStatus::disconnected(format!("Could not determine shell status: {error}"))
            }
        };
        child_session.set_status(status);
    });
    Ok(session)
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    state: State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
) -> Result<u32, String> {
    let sessions = state.sessions.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let emit: EventSink = Arc::new(move |event| match event {
            PtyEvent::Data(bytes) => app
                .emit(&format!("pty://data/{id}"), bytes)
                .map_err(|e| e.to_string()),
            PtyEvent::Status(status) => app
                .emit(&format!("pty://exit/{id}"), status)
                .map_err(|e| e.to_string()),
        });
        let session = spawn_session(crate::shell_init::build_command(cwd)?, cols, rows, emit)?;
        sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, session);
        Ok(id)
    })
    .await
    .map_err(|e| format!("Could not start terminal worker: {e}"))?
}
/// Subscribe in JS first, then attach: initial prompt bytes cannot be lost.
#[tauri::command]
pub async fn pty_attach(state: State<'_, PtyState>, id: u32) -> Result<PtyStatus, String> {
    let session = state.session(id)?;
    tauri::async_runtime::spawn_blocking(move || session.attach())
        .await
        .map_err(|e| format!("Could not attach terminal: {e}"))?
}
/// Read-only: never writes a probe, restarts a shell or kills work on wake.
#[tauri::command]
pub fn pty_status(state: State<'_, PtyState>, id: u32) -> PtyStatus {
    state
        .session(id)
        .map(|session| session.status())
        .unwrap_or_else(PtyStatus::disconnected)
}
#[tauri::command]
pub async fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
    let session = state.session(id)?;
    if session
        .capture
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .is_some()
    {
        return Err("A terminal file capture is in progress. This input was not sent.".into());
    }
    let deadline = Deadline::after(INPUT_TIMEOUT);
    let received = session.enqueue(data.into_bytes(), deadline)?;
    tauri::async_runtime::spawn_blocking(move || await_write(received, deadline))
        .await
        .map_err(|e| format!("Terminal input worker failed: {e}"))?
}
#[tauri::command]
pub async fn pty_resize(
    state: State<'_, PtyState>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let session = state.session(id)?;
    tauri::async_runtime::spawn_blocking(move || {
        session.ensure_running()?;
        session
            .master
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .resize(PtySize {
                rows: rows.max(1),
                cols: cols.max(1),
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Could not resize terminal: {e}"))?
}
#[tauri::command]
pub async fn pty_kill(state: State<'_, PtyState>, id: u32) -> Result<(), String> {
    let session = state
        .sessions
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(&id)
        .cloned();
    if let Some(session) = session {
        tauri::async_runtime::spawn_blocking(move || session.close())
            .await
            .map_err(|e| format!("Could not close terminal: {e}"))??;
        // Retain the session on failure so explicit retry can still reach its
        // killer; never start a replacement while silently abandoning it.
        state
            .sessions
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }
    Ok(())
}
fn capture_command(
    session: &PtySession,
    command: String,
    timeout: Duration,
) -> Result<String, String> {
    session.ensure_running()?;
    let deadline = Deadline::after(timeout);
    let token = NEXT_CAPTURE.fetch_add(1, Ordering::Relaxed);
    // Unknown OSCs are ignored by xterm. Escaped source cannot impersonate the
    // actual marker. This printf syntax also works in fish, unlike "$?".
    let marker = format!("\u{1b}]780;husk-capture;{token}\u{7}");
    let capture = Arc::new(Capture::new(marker.into_bytes()));
    {
        let mut current = session.capture.lock().unwrap_or_else(|e| e.into_inner());
        if current.is_some() {
            return Err("A terminal capture is already in progress.".into());
        }
        *current = Some(capture.clone());
    }
    let result = (|| {
        let data =
            format!("{command}\nprintf '\\033]780;husk-capture;{token}\\007'\n").into_bytes();
        let write_deadline = deadline.limited_to(INPUT_TIMEOUT);
        let received = session.enqueue(data, write_deadline)?;
        await_write(received, write_deadline)?;
        capture.wait(deadline)
    })();
    *session.capture.lock().unwrap_or_else(|e| e.into_inner()) = None;
    result
}
/// Legacy bridge subscribes to the normal reader; no competing read or drain.
#[tauri::command]
pub async fn pty_capture(
    state: State<'_, PtyState>,
    id: u32,
    command: String,
    timeout_ms: u64,
) -> Result<String, String> {
    let session = state.session(id)?;
    let timeout = Duration::from_millis(timeout_ms.clamp(50, 30_000));
    tauri::async_runtime::spawn_blocking(move || capture_command(&session, command, timeout))
        .await
        .map_err(|e| format!("Terminal capture failed: {e}"))?
}

/// Private prompt metadata must never become copied files or AI context.
fn strip_kubeconfig_metadata(mut text: &str) -> String {
    let mut public = String::with_capacity(text.len());
    loop {
        let next = ["\u{1b}]779;", "\u{9d}779;"]
            .into_iter()
            .filter_map(|prefix| text.find(prefix).map(|start| (start, prefix.len())))
            .min_by_key(|(start, _)| *start);
        let Some((start, prefix_len)) = next else {
            public.push_str(text);
            return public;
        };
        public.push_str(&text[..start]);
        let private = &text[start + prefix_len..];
        let end = ["\u{7}", "\u{9c}", "\u{1b}\\"]
            .into_iter()
            .filter_map(|marker| private.find(marker).map(|end| (end, marker.len())))
            .min_by_key(|(end, _)| *end);
        let Some((end, marker_len)) = end else {
            return public;
        };
        text = &private[end + marker_len..];
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug)]
    struct FakeKiller;
    impl ChildKiller for FakeKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self)
        }
    }
    #[cfg(unix)]
    fn fixture() -> (
        Arc<PtySession>,
        mpsc::Receiver<WriteRequest>,
        Box<dyn portable_pty::SlavePty + Send>,
        PtyIo,
        mpsc::Receiver<PtyEvent>,
    ) {
        // An isolated PTY only: no user's shell, startup file, cluster or host.
        let PtyPair { master, slave } = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .unwrap();
        let io = PtyIo::new(master.as_ref()).unwrap();
        let (writes, queued) = mpsc::sync_channel(INPUT_QUEUE_SIZE);
        let (events, received) = mpsc::channel();
        let session = Arc::new(PtySession {
            master: Mutex::new(master),
            killer: Mutex::new(Box::new(FakeKiller)),
            writes,
            status: Mutex::new(PtyStatus::running()),
            closed: AtomicBool::new(false),
            output: Mutex::new(OutputState::default()),
            attached: Condvar::new(),
            capture: Mutex::new(None),
            emit: Arc::new(move |event| events.send(event).map_err(|e| e.to_string())),
        });
        (session, queued, slave, io, received)
    }
    struct BlockedWriter;
    impl Write for BlockedWriter {
        fn write(&mut self, _: &[u8]) -> io::Result<usize> {
            Err(io::ErrorKind::WouldBlock.into())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn process_fixture() {
        if std::env::var("HUSK_PTY_FIXTURE").as_deref() != Ok("1") {
            return;
        }
        println!("HUSK_FIXTURE_PROMPT");
        io::stdout().flush().unwrap();
        let mut line = String::new();
        loop {
            line.clear();
            if io::stdin().read_line(&mut line).unwrap() == 0 || line.trim() == "exit" {
                break;
            }
            println!("HUSK_FIXTURE_ECHO:{}", line.trim());
            io::stdout().flush().unwrap();
        }
    }

    #[test]
    fn real_pty_startup_handshake_and_typing_work_without_any_shell_config() {
        let mut command = CommandBuilder::new(std::env::current_exe().unwrap());
        command.args([
            "--exact",
            "pty::tests::process_fixture",
            "--nocapture",
            "--test-threads=1",
        ]);
        command.env("HUSK_PTY_FIXTURE", "1");
        let (sent, events) = mpsc::channel();
        let session = spawn_session(
            command,
            80,
            24,
            Arc::new(move |event| sent.send(event).map_err(|e| e.to_string())),
        )
        .unwrap();
        struct Cleanup(Arc<PtySession>);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                let _ = self.0.close();
            }
        }
        let _cleanup = Cleanup(session.clone());
        let start = Instant::now();
        while session.output.lock().unwrap().bytes == 0 && start.elapsed() < Duration::from_secs(3)
        {
            thread::sleep(Duration::from_millis(10));
        }
        assert!(
            events.try_recv().is_err(),
            "no startup bytes are emitted before attachment"
        );
        assert_eq!(session.attach().unwrap().state, SessionPhase::Running);
        let wait_text = |needle: &str| {
            let deadline = Instant::now() + Duration::from_secs(3);
            let mut text = String::new();
            while !text.contains(needle) {
                match events
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .unwrap()
                {
                    PtyEvent::Data(bytes) => text.push_str(&String::from_utf8_lossy(&bytes)),
                    PtyEvent::Status(status) => panic!("unexpected fixture status: {status:?}"),
                }
            }
        };
        wait_text("HUSK_FIXTURE_PROMPT");
        let deadline = Deadline::after(INPUT_TIMEOUT);
        let result = session.enqueue(b"hello\n".to_vec(), deadline).unwrap();
        await_write(result, deadline).unwrap();
        wait_text("HUSK_FIXTURE_ECHO:hello");
    }

    #[test]
    fn writes_expire_without_waiting_forever_or_replaying_after_suspend() {
        let closed = AtomicBool::new(false);
        let start = Instant::now();
        let result = write_bounded(
            &mut BlockedWriter,
            b"fixture",
            Deadline::after(Duration::from_millis(30)),
            &closed,
            |duration| {
                thread::sleep(duration);
                Ok(())
            },
        );
        assert!(result.unwrap_err().contains("will not be replayed"));
        assert!(start.elapsed() < Duration::from_secs(1));
        // Simulate a suspend-excluding monotonic clock: wall expiry still wins.
        let deadline = Deadline {
            instant: Instant::now() + Duration::from_secs(60),
            wall: SystemTime::now() - Duration::from_secs(1),
        };
        let mut writer = Vec::new();
        assert!(
            write_bounded(&mut writer, b"must not send", deadline, &closed, |_| Ok(())).is_err()
        );
        assert!(writer.is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn stalled_input_does_not_hold_the_registry_or_other_sessions() {
        let (first, _queued, _slave, _io, _events) = fixture();
        let (second, _queued2, _slave2, _io2, _events2) = fixture();
        let state = PtyState::default();
        state.sessions.lock().unwrap().insert(1, first);
        state.sessions.lock().unwrap().insert(2, second);
        let session = state.session(1).unwrap();
        let (started, ready) = mpsc::channel();
        let worker = thread::spawn(move || {
            write_bounded(
                &mut BlockedWriter,
                b"fixture",
                Deadline::after(Duration::from_millis(100)),
                &session.closed,
                |duration| {
                    let _ = started.send(());
                    thread::sleep(duration);
                    Ok(())
                },
            )
        });
        ready.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(state.sessions.try_lock().is_ok());
        assert_eq!(state.session(2).unwrap().status(), PtyStatus::running());
        assert!(state
            .session(2)
            .unwrap()
            .enqueue(b"other".to_vec(), Deadline::after(INPUT_TIMEOUT))
            .is_ok());
        state
            .sessions
            .lock()
            .unwrap()
            .remove(&1)
            .unwrap()
            .close()
            .unwrap();
        assert!(worker.join().unwrap().is_err());
    }

    #[cfg(unix)]
    #[test]
    fn initial_prompt_and_exit_are_retained_until_attach_in_order() {
        let (session, _queued, _slave, _io, events) = fixture();
        assert!(session.publish(b"first"));
        assert!(session.publish(b" prompt"));
        session.set_status(PtyStatus {
            state: SessionPhase::Exited,
            message: Some("fixture exit".into()),
        });
        assert!(events.try_recv().is_err());
        assert_eq!(session.attach().unwrap().state, SessionPhase::Exited);
        match events.try_recv().unwrap() {
            PtyEvent::Data(bytes) => assert_eq!(bytes, b"first"),
            _ => panic!("expected data"),
        }
        match events.try_recv().unwrap() {
            PtyEvent::Data(bytes) => assert_eq!(bytes, b" prompt"),
            _ => panic!("expected data"),
        }
        session.attach().unwrap();
        assert!(events.try_recv().is_err());
        session.set_status(PtyStatus::disconnected("late reader EOF"));
        assert_eq!(session.status().state, SessionPhase::Exited);
    }

    #[cfg(unix)]
    #[test]
    fn interrupted_reads_keep_streaming_and_fatal_errors_are_not_shell_exits() {
        struct InterruptedReader(u8);
        impl Read for InterruptedReader {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                self.0 += 1;
                match self.0 {
                    1 => Err(io::ErrorKind::Interrupted.into()),
                    2 => {
                        buffer[..6].copy_from_slice(b"prompt");
                        Ok(6)
                    }
                    _ => Err(io::ErrorKind::BrokenPipe.into()),
                }
            }
        }
        let (session, _queued, _slave, io, events) = fixture();
        session.attach().unwrap();
        read_stream(&mut InterruptedReader(0), &session, &io);
        match events.try_recv().unwrap() {
            PtyEvent::Data(bytes) => assert_eq!(bytes, b"prompt"),
            _ => panic!("expected prompt after interruption"),
        }
        assert_eq!(session.status().state, SessionPhase::Disconnected);
        assert!(!session.closed.load(Ordering::Acquire));
    }

    #[test]
    fn capture_is_bounded_and_accepts_a_marker_split_between_reads() {
        let capture = Capture::new(b"DONE".to_vec());
        capture.feed(b"fixture\x1b]779;private\x07DO");
        capture.feed(b"NEignored tail");
        assert_eq!(
            capture
                .wait(Deadline::after(Duration::from_millis(20)))
                .unwrap(),
            "fixture"
        );
        let timed = Capture::new(b"DONE".to_vec());
        assert!(timed
            .wait(Deadline::after(Duration::from_millis(20)))
            .unwrap_err()
            .contains("timed out"));
        let oversized = Capture::new(b"DONE".to_vec());
        oversized.feed(&vec![b'x'; MAX_CAPTURE_BYTES + 1]);
        assert!(oversized
            .wait(Deadline::after(Duration::from_millis(20)))
            .unwrap_err()
            .contains("4 MiB"));
    }

    #[cfg(unix)]
    #[test]
    fn capture_uses_normal_output_and_timeout_releases_its_subscription() {
        let (session, queued, _slave, _io, events) = fixture();
        session.attach().unwrap();
        let capture_session = session.clone();
        let capture = thread::spawn(move || {
            capture_command(
                &capture_session,
                "fixture".into(),
                Duration::from_millis(500),
            )
        });
        let request = queued.recv_timeout(Duration::from_secs(1)).unwrap();
        request.result.send(Ok(())).unwrap();
        let marker = session
            .capture
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .marker
            .clone();
        assert!(session.publish(b"file bytes"));
        assert!(session.publish(&marker));
        assert_eq!(capture.join().unwrap().unwrap(), "file bytes");
        assert!(matches!(events.try_recv().unwrap(), PtyEvent::Data(_)));
        assert!(session.capture.lock().unwrap().is_none());
        let capture_session = session.clone();
        let capture = thread::spawn(move || {
            capture_command(
                &capture_session,
                "fixture".into(),
                Duration::from_millis(50),
            )
        });
        queued
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .result
            .send(Ok(()))
            .unwrap();
        assert!(capture.join().unwrap().is_err());
        assert!(session.capture.lock().unwrap().is_none());
        assert_eq!(session.status(), PtyStatus::running());
        assert!(session
            .enqueue(b"next input".to_vec(), Deadline::after(INPUT_TIMEOUT))
            .is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn queue_and_input_sizes_are_bounded_and_closed_ids_fail() {
        let (session, _queued, _slave, _io, _events) = fixture();
        assert!(session
            .enqueue(vec![0; MAX_INPUT_BYTES + 1], Deadline::after(INPUT_TIMEOUT))
            .is_err());
        for _ in 0..INPUT_QUEUE_SIZE {
            session
                .enqueue(vec![b'x'], Deadline::after(INPUT_TIMEOUT))
                .unwrap();
        }
        assert!(session
            .enqueue(vec![b'x'], Deadline::after(INPUT_TIMEOUT))
            .unwrap_err()
            .contains("not sent"));
        session.close().unwrap();
        assert!(session
            .enqueue(vec![b'x'], Deadline::after(INPUT_TIMEOUT))
            .is_err());
        assert!(PtyState::default().session(999).is_err());
    }

    #[test]
    fn captures_exclude_private_kubeconfig_osc() {
        assert_eq!(strip_kubeconfig_metadata("before\u{1b}]779;husk;kubeconfig;1;value;/private/config\u{1b}\\after\u{1b}]133;B\u{1b}\\"), "beforeafter\u{1b}]133;B\u{1b}\\");
        assert_eq!(
            strip_kubeconfig_metadata("a\u{9d}779;private\u{9c}b\u{1b}]779;private\u{7}c"),
            "abc"
        );
        assert_eq!(
            strip_kubeconfig_metadata("visible\u{1b}]779;unfinished/private"),
            "visible"
        );
    }
}
